import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { buildAuthorizeUrl } from "@/lib/bungie/oauth";

/** Start the OAuth flow: set a CSRF `state` cookie and redirect to Bungie. */
export async function GET() {
  const state = crypto.randomUUID();
  const jar = await cookies();
  jar.set("d2_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 minutes to complete the round trip
  });
  return NextResponse.redirect(buildAuthorizeUrl(state));
}
