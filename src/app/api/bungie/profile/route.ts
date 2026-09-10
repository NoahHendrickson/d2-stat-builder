import { NextResponse } from "next/server";
import {
  getProfile,
  type DestinyComponentType,
  type DestinyProfileResponse,
} from "bungie-api-ts/destiny2";
import { BungieHttpError, createBungieHttp } from "@/lib/bungie/http";
import {
  logBungiePlatformError,
  profileErrorMessage,
  shouldClearSessionOnBungieError,
} from "@/lib/bungie/platform-response";
import { clearSession, getValidAccessToken, readUser } from "@/lib/bungie/session";

// 100 Profiles (currentSeasonHash) · 102 Vault · 200 Characters · 201 CharacterInventories
// 202 CharacterProgressions (seasonal artifact unlocks, for saved loadouts)
// 205 CharacterEquipment · 300 ItemInstances · 304 ItemStats · 305 ItemSockets
// 310 ItemReusablePlugs
// 310 is needed for tuning: it exposes each Tier-5 piece's available tuning plugs
// (which reveal its rolled "tuned stat"). It 500'd client-side on the full vault;
// re-added here to test whether the server-to-server call handles the larger payload.
const COMPONENTS = [100, 102, 200, 201, 202, 205, 300, 304, 305, 310] as DestinyComponentType[];

/**
 * Component 202 is the heaviest thing in the profile — every progression, milestone,
 * quest, and checklist per character — and the client reads one field of it: the
 * seasonal artifact. Send only that, so the extra component costs the browser nothing
 * to transfer or parse.
 */
function slimProfile(profile: DestinyProfileResponse): DestinyProfileResponse {
  const progressions = profile.characterProgressions?.data;
  if (!progressions) return profile;
  const data: Record<string, unknown> = {};
  for (const [characterId, c] of Object.entries(progressions)) {
    data[characterId] = { seasonalArtifact: c.seasonalArtifact };
  }
  return {
    ...profile,
    characterProgressions: {
      ...profile.characterProgressions,
      data: data as typeof progressions,
    },
  };
}

/**
 * Server-side proxy for the player's Destiny profile. Runs server-to-server so
 * Bungie's Origin-header check never fires and the access token never leaves the
 * server. Returns the raw DestinyProfileResponse for the client to normalize.
 */
export async function GET() {
  const user = await readUser();
  const token = await getValidAccessToken();
  if (!user?.destinyMembershipId || user.destinyMembershipType == null || !token) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const logContext = {
    destinyMembershipId: user.destinyMembershipId,
    membershipType: user.destinyMembershipType,
  };

  try {
    const http = createBungieHttp(token);
    const res = await getProfile(http, {
      destinyMembershipId: user.destinyMembershipId,
      membershipType: user.destinyMembershipType,
      components: COMPONENTS,
    });

    if (res.Response == null) {
      logBungiePlatformError("GET /api/bungie/profile", res, {
        ...logContext,
        note: "ErrorCode was Success but Response was empty",
      });
      return NextResponse.json(
        { error: "Bungie returned an empty Destiny profile" },
        { status: 502 },
      );
    }

    return NextResponse.json(slimProfile(res.Response));
  } catch (err) {
    // The Bungie client throws for platform errors too — `ErrorCode ≠ 1` in the body,
    // often under an HTTP 200 — so the friendly message and the dead-session check
    // (code 10, AuthenticationInvalid) live here, not on the response object.
    if (err instanceof BungieHttpError && err.code !== undefined) {
      const envelope = {
        ErrorCode: err.code,
        ErrorStatus: err.errorStatus,
        Message: err.bungieMessage,
      };
      logBungiePlatformError("GET /api/bungie/profile", envelope, logContext);
      if (shouldClearSessionOnBungieError(err.code) || err.status === 401) {
        await clearSession();
        return NextResponse.json({ error: profileErrorMessage(envelope) }, { status: 401 });
      }
      return NextResponse.json({ error: profileErrorMessage(envelope) }, { status: 502 });
    }
    // A Bungie 401 means the token looks locally valid but Bungie rejects it — clear the
    // session so the client's session query flips to unauthenticated instead of retrying
    // into a dead token. (403s stay 502: they're API-key/privacy refusals, not expiry —
    // force-logout would be wrong for a server-config problem.)
    if (err instanceof BungieHttpError && err.status === 401) {
      await clearSession();
      return NextResponse.json(
        { error: "Session expired — sign in again" },
        { status: 401 },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Bungie request failed" },
      { status: 502 },
    );
  }
}
