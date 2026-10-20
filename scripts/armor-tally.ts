import { getDestinyManifest, getDestinyManifestSlice } from "bungie-api-ts/destiny2";
import {
  activityLookup,
  armorSample,
  characterLoadout,
  reportSide,
  type ArmorProfile,
  type ArmorReport,
  type ArmorReportEntry,
} from "../src/lib/armory/set-popularity-reads";
import { BUCKETS } from "../src/lib/armory/set-popularity";
import { addSample, type SetSample } from "../src/lib/armory/set-popularity-store";
import { storeMinute } from "../src/lib/weapons/popularity-copies";
import { createHttpClient } from "../src/lib/weapons/manifest";
import { encodeSetStore } from "./set-store-file";
import { writeFileAtomic } from "./write-file-atomic";

/**
 * The popularity crawl's armor set tally (crawl-perk-popularity.ts
 * --armor-out; the rules are src/lib/armory/set-popularity-reads.ts). The
 * crawl hands it each profile read of a player it found in a report, and the
 * players it found but won't read itself; it keeps each character's latest
 * sample per bucket and writes them as an armor crawl file for
 * merge-armor-set-popularity.ts.
 */

/** The crawl's rate-limited GET (undefined for any answer but success). */
type Get = <T>(url: string) => Promise<T | undefined>;

export interface ArmorTally {
  /** The profile component the crawl's reads add for the tally: 204, every character's current activity. */
  readonly components: string;
  /** Judges the report entry's character from a profile read of its player, read at `readAt` (ms); `ended` is when the report's activity did. */
  judge(profile: ArmorProfile, report: ArmorReport, entry: ArmorReportEntry, ended: number, readAt: number): void;
  /**
   * Reads a player the crawl found in a report but won't read itself (read
   * recently, or already this crawl) for the tally alone: their current
   * activity and equipment, a few KB. Without it the tally would lean away
   * from the players who play most. A character already judged this crawl
   * isn't read again.
   */
  readAlone(get: Get, report: ArmorReport, entry: ArmorReportEntry, ended: number): Promise<void>;
  /** For the crawl's log. */
  summary(): string;
  /** Writes the samples as an armor crawl file, encrypted with `key`. */
  write(path: string, key: Buffer, generatedAt: string): Promise<void>;
}

/** The manifest tables the tally reads: about 12 MB, once per crawl. */
const TABLES = [
  "DestinyActivityDefinition",
  "DestinyActivityTypeDefinition",
  "DestinyFireteamFinderActivityGraphDefinition",
  "DestinyGlobalConstantsDefinition",
  "DestinyEquipableItemSetDefinition",
] as const;

export async function createArmorTally(apiKey: string): Promise<ArmorTally> {
  const http = createHttpClient(apiKey);
  const manifest = (await getDestinyManifest(http)).Response;
  const defs = await getDestinyManifestSlice(http, { destinyManifest: manifest, tableNames: [...TABLES], language: "en" });
  // The installed bungie-api-ts predates this field.
  const constants = Object.values(defs.DestinyGlobalConstantsDefinition)[0] as
    | { vanguardAlertsFireteamFinderActivityGraphRootNodeHash?: number }
    | undefined;
  const vanguardAlertsRoot = constants?.vanguardAlertsFireteamFinderActivityGraphRootNodeHash;
  if (vanguardAlertsRoot === undefined) console.warn("The manifest names no Vanguard Alerts root; GM alerts won't be counted.");
  const lookup = activityLookup({
    activities: defs.DestinyActivityDefinition,
    activityTypes: defs.DestinyActivityTypeDefinition,
    fireteamFinderGraph: defs.DestinyFireteamFinderActivityGraphDefinition,
    vanguardAlertsRoot,
  });
  // The set definitions list their pieces, so the item table isn't needed.
  const setOfItem = new Map<number, number>();
  for (const [hash, set] of Object.entries(defs.DestinyEquipableItemSetDefinition)) {
    if (!set.setPerks?.length) continue;
    for (const item of set.setItems ?? []) setOfItem.set(item, Number(hash));
  }
  const setOf = (item: number) => setOfItem.get(item);
  console.log(`Tallying armor sets too, on manifest ${manifest.version}.`);

  const samples = new Map<string, SetSample>();
  /** Characters judged this crawl. */
  const judged = new Set<string>();
  let alone = 0;

  const tally: ArmorTally = {
    components: "204",
    judge(profile, report, entry, ended, readAt) {
      const character = entry.characterId;
      if (!character) return;
      judged.add(character);
      const loadout = characterLoadout(profile, character, setOf);
      if (!loadout) return;
      const { classType, ...side } = reportSide(report, entry);
      const sample = armorSample({ ...side, ended, readAt, ...loadout }, lookup);
      if (sample) addSample(samples, { character, ...sample, minute: storeMinute(readAt), classType });
    },
    async readAlone(get, report, entry, ended) {
      const user = entry.player?.destinyUserInfo;
      if (!user || !entry.characterId || judged.has(entry.characterId)) return;
      judged.add(entry.characterId);
      alone++;
      const profile = await get<ArmorProfile>(
        `https://www.bungie.net/Platform/Destiny2/${user.membershipType}/Profile/${user.membershipId}/?components=204,205`,
      );
      if (profile) tally.judge(profile, report, entry, ended, Date.now());
    },
    summary() {
      const by = BUCKETS.map((bucket) => `${[...samples.values()].filter((s) => s.bucket === bucket).length} ${bucket}`);
      return `armor: ${judged.size} characters judged (${alone} read for armor alone), ${samples.size} samples (${by.join(", ")})`;
    },
    async write(path, key, generatedAt) {
      const runs = [{ generatedAt, reads: judged.size, samples: samples.size }];
      await writeFileAtomic(path, encodeSetStore({ runs, samples: [...samples.values()] }, key));
      console.log(`Wrote ${samples.size} armor set samples to ${path}.`);
    },
  };
  return tally;
}
