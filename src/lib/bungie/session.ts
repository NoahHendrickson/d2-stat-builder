import { cookies } from "next/headers";
import { refreshTokens, type BungieTokens } from "./oauth";
import { decodeSigned, encodeSigned, readUnverified } from "./signed-cookie";

/**
 * Session storage via cookies.
 *  - `__Host-d2_refresh` (httpOnly): the 90-day refresh token. Never leaves the server.
 *  - `__Host-d2_access`  (httpOnly): the short-lived access token. Never leaves the
 *                 server — server routes use it for Bungie calls; /api/auth/session
 *                 returns only `{authenticated, user}`.
 *  - `__Host-d2_user`    (httpOnly, HMAC-signed, expiring): identity for server routes.
 *                 Server code trusts its membership ids — for Bungie calls (where Bungie
 *                 re-checks ownership against the token) AND as the owner key of rows in
 *                 our own database (where nothing else would) — so it is signed with
 *                 SESSION_SECRET and carries the refresh token's expiry; an unsigned,
 *                 tampered or expired cookie reads as "no user". The client gets identity
 *                 from /api/auth/session.
 *
 * The `__Host-` prefix makes the browser refuse these cookies unless they are Secure,
 * Path=/ and host-only, so a sibling subdomain (canary lives on noahjh.com) can't plant
 * or overwrite them. Sessions from before the rename still read under the old names
 * until they are next written.
 */

const REFRESH_COOKIE = "__Host-d2_refresh";
const ACCESS_COOKIE = "__Host-d2_access";
const USER_COOKIE = "__Host-d2_user";
/** Single-use CSRF `state` for the OAuth round trip (set by /api/auth/login). */
export const OAUTH_STATE_COOKIE = "__Host-d2_oauth_state";

const OLD_NAMES: Record<string, string> = {
  [REFRESH_COOKIE]: "d2_refresh",
  [ACCESS_COOKIE]: "d2_access",
  [USER_COOKIE]: "d2_user",
};

/** Refresh the access token this long before it actually expires. */
const ACCESS_REFRESH_SKEW_MS = 60_000;

export interface SessionUser {
  membershipId: string; // bungie.net membership id
  destinyMembershipId?: string;
  destinyMembershipType?: number;
  displayName?: string;
  /** Relative Bungie.net profile avatar path (e.g. `/img/profile/avatars/cc13.jpg`). */
  iconPath?: string;
}

/** What the identity cookie signs: the user plus an epoch-ms expiry the server enforces. */
interface SignedUser extends SessionUser {
  exp: number;
}

interface StoredToken {
  token: string;
  expiresAt: number;
}

type CookieJar = Awaited<ReturnType<typeof cookies>>;

function baseCookie(refreshExpiresAt: number) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    expires: new Date(refreshExpiresAt),
  };
}

/** A delete has to repeat Secure + Path=/ or the browser ignores it for `__Host-` names. */
export function deleteCookie(jar: CookieJar, name: string) {
  jar.delete({ name, path: "/", secure: true, httpOnly: true, sameSite: "lax" });
}

/** Once a cookie is written under its new name, drop the pre-rename copy. */
function dropOldName(jar: CookieJar, name: string) {
  const old = OLD_NAMES[name];
  if (old && jar.has(old)) deleteCookie(jar, old);
}

function readCookie(jar: CookieJar, name: string): string | undefined {
  return jar.get(name)?.value ?? jar.get(OLD_NAMES[name])?.value;
}

/**
 * Source secret for the identity cookie's signing key (HKDF-derived in
 * signed-cookie.ts). SESSION_SECRET keeps it apart from the OAuth client secret, so
 * either can be rotated, or leak, without the other. Deploys that haven't set it yet
 * fall back to the client secret; cookies signed under the old key are re-confirmed
 * with Bungie by /api/auth/session rather than signing anyone out.
 */
function signingSecret(): string {
  const secret = process.env.SESSION_SECRET || process.env.BUNGIE_CLIENT_SECRET;
  if (!secret) throw new Error("Missing required env var SESSION_SECRET. See .env.example.");
  return secret;
}

export async function writeSession(tokens: BungieTokens, user: SessionUser) {
  await updateTokens(tokens);
  await writeUser(user, tokens.refreshExpiresAt);
}

/** Rewrite the identity cookie (e.g. after backfilling fields on an existing session). */
export async function writeUser(user: SessionUser, refreshExpiresAt?: number) {
  const expiresAt = refreshExpiresAt ?? (await readRefresh())?.expiresAt;
  if (expiresAt == null) return;
  const jar = await cookies();
  const signed: SignedUser = { ...user, exp: expiresAt };
  jar.set(USER_COOKIE, await encodeSigned(signed, signingSecret()), baseCookie(expiresAt));
  dropOldName(jar, USER_COOKIE);
}

/** Replace the access + (rotated) refresh tokens after a refresh. */
export async function updateTokens(tokens: BungieTokens) {
  const jar = await cookies();
  const opts = baseCookie(tokens.refreshExpiresAt);
  jar.set(
    REFRESH_COOKIE,
    JSON.stringify({ token: tokens.refreshToken, expiresAt: tokens.refreshExpiresAt }),
    opts,
  );
  jar.set(
    ACCESS_COOKIE,
    JSON.stringify({ token: tokens.accessToken, expiresAt: tokens.accessExpiresAt }),
    opts,
  );
  dropOldName(jar, REFRESH_COOKIE);
  dropOldName(jar, ACCESS_COOKIE);
}

async function readToken(name: string): Promise<StoredToken | null> {
  const raw = readCookie(await cookies(), name);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredToken;
  } catch {
    return null;
  }
}

export const readRefresh = () => readToken(REFRESH_COOKIE);
export const readAccess = () => readToken(ACCESS_COOKIE);

export async function readUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const raw = jar.get(USER_COOKIE)?.value;
  if (!raw) return null;
  // A cookie we can't verify — tampered, signed under an older key or format, or a
  // deploy missing the secret — reads as anonymous rather than throwing out of every
  // route. /api/auth/session re-confirms the older ones with Bungie.
  let signed: SignedUser | null;
  try {
    signed = await decodeSigned<SignedUser>(raw, signingSecret());
  } catch {
    return null;
  }
  if (!signed || typeof signed.membershipId !== "string" || !signed.membershipId) return null;
  const { exp, ...user } = signed;
  if (typeof exp !== "number" || exp <= Date.now()) return null;
  return user;
}

/**
 * The identity cookie as an older build wrote it, or one readUser() won't vouch for:
 * plain JSON, signed without an expiry or under the client secret, or expired. Its ids
 * are forgeable, so only /api/auth/session may act on this, and only after confirming
 * the identity with Bungie. Null when there's no cookie or it doesn't parse.
 */
export async function readUnconfirmedUser(): Promise<SessionUser | null> {
  const raw = readCookie(await cookies(), USER_COOKIE);
  if (!raw) return null;
  let parsed: Partial<SignedUser> | null;
  try {
    parsed = raw.startsWith("{") ? (JSON.parse(raw) as Partial<SignedUser>) : readUnverified(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed.membershipId !== "string" || !parsed.membershipId) return null;
  return {
    membershipId: parsed.membershipId,
    ...(typeof parsed.destinyMembershipId === "string"
      ? { destinyMembershipId: parsed.destinyMembershipId }
      : {}),
    ...(typeof parsed.destinyMembershipType === "number"
      ? { destinyMembershipType: parsed.destinyMembershipType }
      : {}),
    ...(typeof parsed.displayName === "string" ? { displayName: parsed.displayName } : {}),
    ...(typeof parsed.iconPath === "string" ? { iconPath: parsed.iconPath } : {}),
  };
}

export async function clearSession() {
  const jar = await cookies();
  for (const name of [REFRESH_COOKIE, ACCESS_COOKIE, USER_COOKIE]) {
    deleteCookie(jar, name);
    if (jar.has(OLD_NAMES[name])) deleteCookie(jar, OLD_NAMES[name]);
  }
}

/**
 * Returns a valid access token for server-side Bungie calls, refreshing it
 * (and rotating the refresh token) when needed. Returns null when there's no
 * usable session (and clears any leftover cookies).
 */
export async function getValidAccessToken(): Promise<string | null> {
  const refresh = await readRefresh();
  if (!refresh || refresh.expiresAt <= Date.now()) {
    if (refresh) await clearSession();
    return null;
  }

  const access = await readAccess();
  if (access && access.expiresAt - ACCESS_REFRESH_SKEW_MS > Date.now()) {
    return access.token;
  }

  try {
    const tokens = await refreshTokens(refresh.token);
    // Bungie names the token's owner on every refresh: an identity cookie for anyone
    // else doesn't belong with these tokens.
    const user = await readUser();
    if (user && user.membershipId !== tokens.membershipId) {
      await clearSession();
      return null;
    }
    await updateTokens(tokens);
    // The refresh token's life just moved forward; move the identity's with it.
    if (user) await writeUser(user, tokens.refreshExpiresAt);
    return tokens.accessToken;
  } catch {
    await clearSession();
    return null;
  }
}
