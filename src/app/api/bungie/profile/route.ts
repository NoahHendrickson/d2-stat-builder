import { cookies } from "next/headers";
import { after, NextResponse } from "next/server";
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
import {
  DESTINY_ACCOUNT_NOT_FOUND,
  resolveDestinyAccount,
} from "@/lib/bungie/destiny-account";
import { clearSession, getValidAccessToken, readUser, writeUser } from "@/lib/bungie/session";
import { compressResponse } from "@/lib/http/compress-response";
import {
  HELD_PROFILE_HEADER,
  isNewerMint,
  parseHeldProfile,
  type Minted,
} from "@/lib/armory/profile-mint";
import { getServerContributionStore, SAVE_EVERY_HOURS } from "@/lib/weapons/contribution-store";

// 100 Profiles (currentSeasonHash) · 102 Vault · 103 ProfileCurrencies · 200 Characters · 201 CharacterInventories
// 202 CharacterProgressions (seasonal artifact unlocks, for saved loadouts)
// 205 CharacterEquipment · 300 ItemInstances · 304 ItemStats · 305 ItemSockets
// 310 ItemReusablePlugs
// 310 is needed for tuning: it exposes each Tier-5 piece's available tuning plugs
// (which reveal its rolled "tuned stat"). It 500'd client-side on the full vault;
// re-added here to test whether the server-to-server call handles the larger payload.
// Changing this list or slimProfile changes what a client holds for the same Bungie
// snapshot: bump PROFILE_SHAPE_VERSION (profile-mint.ts) so held copies stop getting 304s.
/**
 * Set once this browser's weapons are saved for perk popularity, holding the Destiny
 * membership id, for SAVE_EVERY_HOURS. The store's own memory of who it saved is per
 * function instance, so without this every new instance a poll lands on wrote again.
 */
const CONTRIBUTED_COOKIE = "d2c-contributed";

const COMPONENTS = [100, 102, 103, 200, 201, 202, 205, 300, 304, 305, 310] as DestinyComponentType[];

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
 * server. Returns the raw DestinyProfileResponse for the client to normalize, compressed
 * here (the uncompressed profile is what filled the Fast Origin Transfer allowance), or a
 * bodiless 304 when the client holds a profile and Bungie has nothing newer (see
 * profile-mint.ts).
 */
export async function GET(request: Request) {
  const held = parseHeldProfile(request.headers.get(HELD_PROFILE_HEADER));
  return compressResponse(request, await loadProfile(held));
}

async function loadProfile(held: Minted | undefined): Promise<Response> {
  let user = await readUser();
  const token = await getValidAccessToken();
  if (!user?.destinyMembershipId || user.destinyMembershipType == null || !token) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const logContext = {
    // Enough to tell accounts apart in the logs without recording the full id.
    destinyMembershipId: `…${user.destinyMembershipId.slice(-4)}`,
    membershipType: user.destinyMembershipType,
  };

  try {
    const http = createBungieHttp(token);
    const load = (destinyMembershipId: string, membershipType: number) =>
      getProfile(http, {
        destinyMembershipId,
        membershipType,
        components: COMPONENTS,
      });
    let res;
    try {
      res = await load(user.destinyMembershipId, user.destinyMembershipType);
    } catch (err) {
      // Sessions from before resolveDestinyAccount can point at a membership with no D2
      // profile. Re-pick from LinkedProfiles once and remember the answer.
      if (!(err instanceof BungieHttpError && err.code === DESTINY_ACCOUNT_NOT_FOUND)) throw err;
      const account = await resolveDestinyAccount(http, user.membershipId).catch(() => undefined);
      if (!account || account.membershipId === user.destinyMembershipId) throw err;
      user = {
        ...user,
        destinyMembershipId: account.membershipId,
        destinyMembershipType: account.membershipType,
      };
      res = await load(account.membershipId, account.membershipType);
      await writeUser(user);
    }

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

    // Same snapshot as the client's, or an older one from Bungie's cache: nothing to send.
    if (held && !isNewerMint(held, res.Response)) {
      return new Response(null, { status: 304 });
    }
    // Their weapons count towards perk popularity (contribution-store.ts), saved
    // after the response so the page never waits on the write.
    const { destinyMembershipId, destinyMembershipType } = user;
    const jar = await cookies();
    const save =
      destinyMembershipId &&
      destinyMembershipType != null &&
      jar.get(CONTRIBUTED_COOKIE)?.value !== destinyMembershipId
        ? getServerContributionStore()?.prepare(destinyMembershipId, destinyMembershipType, res.Response)
        : undefined;
    if (save && destinyMembershipId) {
      // Set before the write lands, so a failed save waits for the cookie to lapse:
      // popularity can miss a player for half a day, the database can't take a retry per poll.
      jar.set(CONTRIBUTED_COOKIE, destinyMembershipId, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/api/bungie/profile",
        maxAge: SAVE_EVERY_HOURS * 3600,
      });
      after(() => save().catch((err: unknown) => console.warn("Couldn't save weapons for perk popularity:", err)));
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
