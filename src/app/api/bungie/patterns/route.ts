import { NextResponse } from "next/server";
import {
  getDestinyManifest,
  getProfile,
  type DestinyComponentType,
  type DestinyRecordDefinition,
} from "bungie-api-ts/destiny2";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import { createBungieHttp } from "@/lib/bungie/http";
import { bungieErrorResponse, notSignedIn } from "@/lib/bungie/equip-route";
import {
  patternProgress,
  patternRecords,
  type PatternRecord,
  type PatternsResponse,
} from "@/lib/bungie/patterns";
import { getValidAccessToken, readUser } from "@/lib/bungie/session";

// 900 Records: profile-wide and per-character triumph progress, patterns among them.
const COMPONENTS = [900] as DestinyComponentType[];

const REAUTH_MESSAGE = "Bungie needs you to sign in again";

/**
 * Which records are patterns comes from the record table (~8 MB, ~400 KB gzipped), which
 * only this route reads, so it is fetched here rather than joining the client manifest
 * (adding a table there re-downloads the whole manifest for everyone). Kept per server
 * instance as the ~200 pattern records; they change only when Bungie ships new weapons.
 */
const RECORDS_TTL_MS = 60 * 60_000;
let recordsCache: { at: number; value: Promise<PatternRecord[]> } | undefined;

async function fetchPatternRecords(): Promise<PatternRecord[]> {
  const info = (await getDestinyManifest(createBungieHttp())).Response;
  const path = info.jsonWorldComponentContentPaths.en.DestinyRecordDefinition;
  if (!path) throw new Error("Bungie's manifest is missing the record table");
  // Too big for the data cache, and kept in memory above anyway.
  const res = await fetch(`${BUNGIE_IMAGE_BASE}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Bungie manifest table request failed (HTTP ${res.status})`);
  return patternRecords(Object.values((await res.json()) as Record<string, DestinyRecordDefinition>));
}

function loadPatternRecords(): Promise<PatternRecord[]> {
  if (recordsCache && Date.now() - recordsCache.at < RECORDS_TTL_MS) return recordsCache.value;
  const value = fetchPatternRecords();
  recordsCache = { at: Date.now(), value };
  // A failed load isn't kept: the next request tries again.
  value.catch(() => {
    if (recordsCache?.value === value) recordsCache = undefined;
  });
  return value;
}

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
