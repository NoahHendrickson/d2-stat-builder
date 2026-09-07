import { NextResponse } from "next/server";
import { getMembershipDataForCurrentUser } from "bungie-api-ts/user";
import { createBungieHttp } from "@/lib/bungie/http";
import {
  clearSession,
  getValidAccessToken,
  readRefresh,
  readUser,
  writeUser,
  type SessionUser,
} from "@/lib/bungie/session";

/**
 * Reports whether there's a usable session. The access token stays server-side;
 * authenticated Bungie calls go through our own API routes.
 */
export async function GET() {
  const user = await readUser();
  if (!user) {
    // Tokens without a verifiable identity cookie (e.g. a session from before the
    // identity cookie was signed) are dead weight: drop them so the next sign-in is clean.
    if (await readRefresh()) await clearSession();
    return NextResponse.json({ authenticated: false });
  }
  const token = await getValidAccessToken();
  if (!token) {
    return NextResponse.json({ authenticated: false });
  }
  return NextResponse.json({
    authenticated: true,
    user: await userWithIcon(user, token),
  });
}

/** Sessions created before we stored the avatar still need one fetch to pick it up. */
async function userWithIcon(user: SessionUser, token: string): Promise<SessionUser> {
  if (user.iconPath) return user;
  try {
    const membership = await getMembershipDataForCurrentUser(createBungieHttp(token));
    const iconPath = membership.Response?.bungieNetUser?.profilePicturePath;
    if (!iconPath) return user;
    const updated = { ...user, iconPath };
    await writeUser(updated);
    return updated;
  } catch {
    return user;
  }
}
