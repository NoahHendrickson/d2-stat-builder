import { cookies } from "next/headers";
import { refreshTokens, type BungieTokens } from "./oauth";
import { decodeSigned, encodeSigned } from "./signed-cookie";

/**
 * Session storage via cookies.
 *  - `d2_refresh` (httpOnly): the 90-day refresh token. Never leaves the server.
 *  - `d2_access`  (httpOnly): the short-lived access token. Never leaves the server —
 *                 server routes use it for Bungie calls; /api/auth/session returns only
 *                 `{authenticated, user}`.
 *  - `d2_user`    (httpOnly, HMAC-signed): identity for server routes. Server code
 *                 trusts its membership ids — for Bungie calls (where Bungie re-checks
 *                 ownership against the token) AND as the owner key of rows in our own
 *                 database (where nothing else would) — so it is signed with a key
 *                 derived from the client secret; an unsigned or tampered cookie reads
 *                 as "no user". The client gets identity from /api/auth/session.
 */

const REFRESH_COOKIE = "d2_refresh";
const ACCESS_COOKIE = "d2_access";
const USER_COOKIE = "d2_user";

/** Refresh the access token this long before it actually expires. */
const ACCESS_REFRESH_SKEW_MS = 60_000;

export interface SessionUser {
  membershipId: string; // bungie.net membership id
  destinyMembershipId?: string;
  destinyMembershipType?: number;
  displayName?: string;
}

interface StoredToken {
  token: string;
  expiresAt: number;
}

function baseCookie(refreshExpiresAt: number) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    expires: new Date(refreshExpiresAt),
  };
}

/** Signing key for the identity cookie — the confidential OAuth secret, already server-only. */
function cookieSecret(): string {
  const secret = process.env.BUNGIE_CLIENT_SECRET;
  if (!secret) throw new Error("Missing required env var BUNGIE_CLIENT_SECRET. See .env.example.");
  return secret;
}

export async function writeSession(tokens: BungieTokens, user: SessionUser) {
  await updateTokens(tokens);
  const jar = await cookies();
  const opts = baseCookie(tokens.refreshExpiresAt);
  jar.set(USER_COOKIE, await encodeSigned(user, cookieSecret()), opts);
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
}

async function readToken(name: string): Promise<StoredToken | null> {
  const jar = await cookies();
  const raw = jar.get(name)?.value;
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
  // A cookie we can't verify — unsigned (pre-signing sessions), tampered, or a deploy
  // missing the secret — reads as anonymous rather than throwing out of every route.
  let user: SessionUser | null;
  try {
    user = await decodeSigned<SessionUser>(raw, cookieSecret());
  } catch {
    return null;
  }
  if (!user || typeof user.membershipId !== "string" || !user.membershipId) return null;
  return user;
}

export async function clearSession() {
  const jar = await cookies();
  for (const name of [REFRESH_COOKIE, ACCESS_COOKIE, USER_COOKIE]) {
    jar.delete(name);
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
    await updateTokens(tokens);
    return tokens.accessToken;
  } catch {
    await clearSession();
    return null;
  }
}
