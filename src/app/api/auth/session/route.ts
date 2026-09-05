import { NextResponse } from "next/server";
import { clearSession, getValidAccessToken, readRefresh, readUser } from "@/lib/bungie/session";

export const dynamic = "force-dynamic";

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
  return NextResponse.json({ authenticated: true, user });
}
