import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getMembershipDataForCurrentUser } from "bungie-api-ts/user";
import { exchangeCode } from "@/lib/bungie/oauth";
import { writeSession, type SessionUser } from "@/lib/bungie/session";
import { createBungieHttp } from "@/lib/bungie/http";
import { APP_URL } from "@/lib/bungie/constants";

export const dynamic = "force-dynamic";

/** Bungie redirects here with `code` + `state`. Exchange tokens server-side. */
export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const code = params.get("code");
  const state = params.get("state");

  const jar = await cookies();
  const expectedState = jar.get("d2_oauth_state")?.value;
  // Deliberate delete-before-validate: the state is single-use and burns whether or not
  // validation passes (expectedState was already captured above).
  jar.delete("d2_oauth_state");

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(`${APP_URL}/?auth=error`);
  }

  try {
    const tokens = await exchangeCode(code);

    // Resolve the user's Destiny memberships for display + later GetProfile calls.
    const http = createBungieHttp(tokens.accessToken);
    const membership = await getMembershipDataForCurrentUser(http);
    const data = membership.Response;
    const memberships = data?.destinyMemberships ?? [];
    const primary =
      memberships.find((m) => m.membershipId === data?.primaryMembershipId) ??
      memberships[0];

    const user: SessionUser = {
      membershipId: tokens.membershipId,
      destinyMembershipId: primary?.membershipId,
      destinyMembershipType: primary?.membershipType,
      displayName:
        data?.bungieNetUser?.uniqueName ??
        (primary
          ? `${primary.bungieGlobalDisplayName}#${primary.bungieGlobalDisplayNameCode}`
          : undefined),
    };

    await writeSession(tokens, user);
    return NextResponse.redirect(`${APP_URL}/?auth=success`);
  } catch (err) {
    // Message only — the full error can carry Bungie response bodies.
    console.error(
      "OAuth callback failed:",
      err instanceof Error ? err.message : "unknown error",
    );
    return NextResponse.redirect(`${APP_URL}/?auth=error`);
  }
}
