import { NextResponse } from "next/server";
import { getProfile, type DestinyComponentType } from "bungie-api-ts/destiny2";
import { createBungieHttp } from "@/lib/bungie/http";
import { bungieErrorResponse, notSignedIn } from "@/lib/bungie/equip-route";
import { fetchManifestTable, perManifestVersion } from "@/lib/bungie/manifest-tables";
import { patternProgress, patternRecords, type PatternsResponse } from "@/lib/bungie/patterns";
import { getValidAccessToken, readUser } from "@/lib/bungie/session";

// 900 Records: profile-wide and per-character triumph progress, patterns among them.
const COMPONENTS = [900] as DestinyComponentType[];

const REAUTH_MESSAGE = "Bungie needs you to sign in again";

/**
 * Which records are patterns, from the record table (~8 MB, ~400 KB gzipped), kept as
 * the ~200 pattern records. Too big for the data cache, hence `no-store`.
 */
const loadPatternRecords = perManifestVersion(async (paths) =>
  patternRecords(await fetchManifestTable(paths, "DestinyRecordDefinition", { cache: "no-store" })),
);

/** The player's progress on every crafting pattern, by weapon name. */
export async function GET() {
  const user = await readUser();
  const token = await getValidAccessToken();
  if (!user?.destinyMembershipId || user.destinyMembershipType == null || !token) {
    return notSignedIn();
  }

  try {
    const [profile, records] = await Promise.all([
      getProfile(createBungieHttp(token), {
        destinyMembershipId: user.destinyMembershipId,
        membershipType: user.destinyMembershipType,
        components: COMPONENTS,
      }),
      loadPatternRecords(),
    ]);
    const response = profile.Response;
    if (!response?.profileRecords?.data && !response?.characterRecords?.data) {
      return NextResponse.json({ error: "Bungie didn't return your pattern progress" }, { status: 502 });
    }
    return NextResponse.json({
      patterns: patternProgress(records, response.profileRecords?.data, response.characterRecords?.data),
    } satisfies PatternsResponse);
  } catch (err) {
    return bungieErrorResponse(err, REAUTH_MESSAGE);
  }
}
