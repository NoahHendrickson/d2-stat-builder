import { NextResponse } from "next/server";
import { getMembershipDataForCurrentUser } from "bungie-api-ts/user";
import { createBungieHttp } from "@/lib/bungie/http";
import {
  clearSession,
  getValidAccessToken,
  readLegacyUser,
  readUser,
  writeUser,
  type SessionUser,
} from "@/lib/bungie/session";

/**
 * Reports whether there's a usable session. The access token stays server-side;
 * authenticated Bungie calls go through our own API routes.
 */
export async function GET() {
  const token = await getValidAccessToken();
  if (!token) {
    return NextResponse.json({ authenticated: false });
  }
  const user = (await readUser()) ?? (await migrateLegacyUser(token));
  if (!user) {
    // Tokens without a verifiable identity cookie are dead weight: drop them so the
    // next sign-in is clean.
    await clearSession();
    return NextResponse.json({ authenticated: false });
  }
  return NextResponse.json({
    authenticated: true,
    user: await userWithIcon(user, token),
  });
}

/**
 * Sessions from before the identity cookie was signed still carry it as plain JSON.
 * Rather than signing everyone out on deploy, confirm the identity with Bungie once —
 * the plain cookie is forgeable, so its ids are trusted only after Bungie says the
 * token belongs to them — and rewrite the cookie signed. Anything that doesn't line up
 * reads as no session.
 */
async function migrateLegacyUser(token: string): Promise<SessionUser | null> {
  const legacy = await readLegacyUser();
  if (!legacy) return null;
  try {
    const membership = await getMembershipDataForCurrentUser(createBungieHttp(token));
    const bungieNetUser = membership.Response?.bungieNetUser;
    if (bungieNetUser?.membershipId !== legacy.membershipId) return null;
    const destinyOk =
      legacy.destinyMembershipId == null ||
      (membership.Response?.destinyMemberships ?? []).some(
        (m) =>
          m.membershipId === legacy.destinyMembershipId &&
          (legacy.destinyMembershipType == null || m.membershipType === legacy.destinyMembershipType),
      );
    if (!destinyOk) return null;
    const iconPath = legacy.iconPath ?? bungieNetUser.profilePicturePath ?? undefined;
    const user: SessionUser = { ...legacy, ...(iconPath ? { iconPath } : {}) };
    await writeUser(user);
    return user;
  } catch {
    return null;
  }
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
