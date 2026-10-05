import { NextResponse } from "next/server";
import { getMembershipDataForCurrentUser } from "bungie-api-ts/user";
import { createBungieHttp } from "@/lib/bungie/http";
import {
  clearSession,
  getValidAccessToken,
  readUnconfirmedUser,
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
  const user = (await readUser()) ?? (await confirmUser(token));
  if (user === UNCHECKED) {
    // Bungie couldn't be asked right now. Answer signed-out for this load but keep the
    // cookies, so the next load tries again instead of the outage signing anyone out.
    return NextResponse.json({ authenticated: false });
  }
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

const UNCHECKED = Symbol("unchecked");

/**
 * An identity cookie readUser() won't vouch for — plain JSON from before signing, signed
 * before SESSION_SECRET or expiry existed, or expired — would otherwise sign the user
 * out. Instead, confirm the identity with Bungie once (its ids are forgeable, so they're
 * trusted only after Bungie says the token belongs to them) and rewrite the cookie in
 * the current form. Anything that doesn't line up reads as no session.
 */
async function confirmUser(token: string): Promise<SessionUser | null | typeof UNCHECKED> {
  const legacy = await readUnconfirmedUser();
  if (!legacy) return null;
  let membership;
  try {
    membership = await getMembershipDataForCurrentUser(createBungieHttp(token));
  } catch {
    return UNCHECKED;
  }
  try {
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
