import { cookies } from "next/headers";
import { refreshTokens, type BungieTokens } from "./oauth";

/**
 * Session storage via cookies.
 *  - `d2_refresh` (httpOnly): the 90-day refresh token. Never leaves the server.
 *  - `d2_access`  (httpOnly): the short-lived access token. Never leaves the server —
 *                 server routes use it for Bungie calls; /api/auth/session returns only
 *                 `{authenticated, user}`.
 *  - `d2_user`    (httpOnly): identity for server routes. Server code trusts its
 *                 destinyMembershipId/Type, so it must not be client-writable;
 *                 the client gets identity from /api/auth/session instead.
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

export async function writeSession(tokens: BungieTokens, user: SessionUser) {
  await updateTokens(tokens);
  const jar = await cookies();
  const opts = baseCookie(tokens.refreshExpiresAt);
  jar.set(USER_COOKIE, JSON.stringify(user), opts);
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
  try {
    return JSON.parse(raw) as SessionUser;
  } catch {
    return null;
  }
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
