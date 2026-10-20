/**
 * How the popularity crawl's reads become armor set samples
 * (scripts/armor-tally.ts runs this for crawl-perk-popularity.ts --armor-out).
 *
 * The crawl finds players through post-game reports and reads each one's
 * profile a minute or two after their activity ended. A report lists no armor,
 * so what counts is what the read sees, and when:
 *
 * - In one of the buckets' activities now: what they have on is what they're
 *   wearing in it, so it counts for that activity.
 * - In orbit or a social space after a Conquest or Grandmaster Vanguard Alert
 *   (most players go back to orbit after those) within ORBIT_READ_MS of it
 *   ending, with every weapon that got kills in it still equipped: no
 *   loadout swap since, so it counts for the one they just finished. Raids and
 *   dungeons fill without these, so they take only in-activity reads.
 * - Anything else isn't counted.
 */

// Runtime imports are relative so the module runs under vitest and the crawler.
import { setConfig, type ActivityBucket, type SetConfig } from "./set-popularity";
import { ARMOR_BUCKETS, WEAPON_BUCKETS } from "./stats";

/** Buckets that also take orbit reads, with the weapon check (see the top). */
const ORBIT_BUCKETS: ReadonlySet<ActivityBucket> = new Set(["gmAlert", "conquest"]);
/** How soon after the report's activity ended an orbit read must be. */
export const ORBIT_READ_MS = 3 * 60_000;

/** DestinyActivityModeType: Raid, Dungeon, Social (the Tower, the Enclave, the Pale Heart's refuges). */
const RAID_MODE = 4;
const DUNGEON_MODE = 82;
const SOCIAL_MODE = 40;

/** The manifest tables the activity lookup reads: just the fields it needs. */
export interface ActivityTables {
  activities: Readonly<
    Record<
      string,
      {
        displayProperties?: { name?: string };
        activityTypeHash?: number;
        activityModeTypes?: readonly number[];
      }
    >
  >;
  activityTypes: Readonly<Record<string, { displayProperties?: { name?: string } }>>;
  fireteamFinderGraph: Readonly<
    Record<
      string,
      {
        displayProperties?: { name?: string };
        children?: readonly number[];
        relatedActivityHashes?: readonly number[];
      }
    >
  >;
  /** DestinyGlobalConstantsDefinition.vanguardAlertsFireteamFinderActivityGraphRootNodeHash. */
  vanguardAlertsRoot?: number;
}

export interface ActivityLookup {
  /** The bucket an activity counts for, if any. */
  bucket(activityHash: number): ActivityBucket | undefined;
  /** Whether the player is between activities: orbit, a social space, or offline (0). */
  between(activityHash: number): boolean;
}

/**
 * Buckets activities from the manifest, so a new raid, dungeon or alert
 * rotation is picked up without a code change:
 * - raid / dungeon: the "Raid" / "Dungeon" activity type, or the mode (some
 *   dungeons, like Vesper's Host, carry only the type);
 * - gmAlert: the "Grandmaster" node under the fireteam finder's Vanguard
 *   Alerts root. The alert is a strike's own activity, distinct from that
 *   strike elsewhere, offered only on Grandmaster or Ultimate, so it's GM in
 *   all but name;
 * - conquest: every tier is its own activity, named "<Tier> Conquest: …".
 * Both answers are worked out for every activity up front, so the tables
 * (tens of MB) needn't outlive this call.
 */
export function activityLookup(tables: ActivityTables): ActivityLookup {
  const typesNamed = (name: string) =>
    new Set(
      Object.entries(tables.activityTypes)
        .filter(([, type]) => type.displayProperties?.name === name)
        .map(([hash]) => Number(hash)),
    );
  const raidTypes = typesNamed("Raid");
  const dungeonTypes = typesNamed("Dungeon");
  const socialTypes = typesNamed("Social");
  const alerts = new Set<number>();
  const root = tables.vanguardAlertsRoot === undefined ? undefined : tables.fireteamFinderGraph[tables.vanguardAlertsRoot];
  for (const child of root?.children ?? []) {
    const node = tables.fireteamFinderGraph[child];
    if (/^grandmaster\b/i.test(node?.displayProperties?.name ?? "")) {
      for (const hash of node?.relatedActivityHashes ?? []) alerts.add(hash);
    }
  }
  const buckets = new Map<number, ActivityBucket>();
  // Offline reads as 0.
  const between = new Set<number>([0]);
  for (const [key, def] of Object.entries(tables.activities)) {
    const hash = Number(key);
    const type = def.activityTypeHash ?? 0;
    const modes = def.activityModeTypes ?? [];
    let bucket: ActivityBucket | undefined;
    if (raidTypes.has(type) || modes.includes(RAID_MODE)) bucket = "raid";
    else if (dungeonTypes.has(type) || modes.includes(DUNGEON_MODE)) bucket = "dungeon";
    else if (alerts.has(hash)) bucket = "gmAlert";
    else if (/\bConquest:/.test(def.displayProperties?.name ?? "")) bucket = "conquest";
    if (bucket) buckets.set(hash, bucket);
    // Orbit is an activity with neither a type nor a mode.
    else if ((!type && modes.length === 0) || socialTypes.has(type) || modes.includes(SOCIAL_MODE)) between.add(hash);
  }
  return {
    bucket: (hash) => buckets.get(hash),
    between: (hash) => between.has(hash),
  };
}

/** One read of a player found in a report, as armorSample judges it. */
export interface ArmorRead {
  /** The report's activity (its directorActivityHash). */
  reportActivity: number;
  /** When the report's activity ended (ms). */
  ended: number;
  /** The weapons that got kills in it (item hashes). */
  reportWeapons: readonly number[];
  /** When the profile was read (ms). */
  readAt: number;
  /** The character's current activity, or 0 when offline. */
  currentActivity: number;
  /** The set of each armor piece the character has equipped (undefined: in no set). */
  armorSets: readonly (number | undefined)[];
  /** The character's equipped weapons (item hashes). */
  equippedWeapons: readonly number[];
}

/** The bucket a read counts for and the set bonuses it saw, or undefined when it doesn't count (see the top). */
export function armorSample(
  read: ArmorRead,
  lookup: ActivityLookup,
): { bucket: ActivityBucket; config: SetConfig } | undefined {
  if (read.armorSets.length === 0) return undefined;
  const now = lookup.bucket(read.currentActivity);
  if (now) return { bucket: now, config: setConfig(read.armorSets) };
  const finished = lookup.bucket(read.reportActivity);
  if (!finished || !ORBIT_BUCKETS.has(finished)) return undefined;
  if (!lookup.between(read.currentActivity) || read.readAt - read.ended > ORBIT_READ_MS) return undefined;
  // No kills to check against, or a weapon that got some has been swapped out: the armor may have been too.
  const equipped = new Set(read.equippedWeapons);
  if (read.reportWeapons.length === 0 || !read.reportWeapons.every((hash) => equipped.has(hash))) return undefined;
  return { bucket: finished, config: setConfig(read.armorSets) };
}

/** What a post-game report says that armorSample needs (a PGCR, as far as this reads it). */
export interface ArmorReport {
  activityDetails: { referenceId?: number; directorActivityHash?: number };
}
export interface ArmorReportEntry {
  player?: { destinyUserInfo?: { membershipType: number; membershipId: string }; classHash?: number };
  characterId?: string;
  /** The weapons that got kills. */
  extended?: { weapons?: readonly { referenceId: number }[] };
}

/** A report entry's classHash → DestinyClass. */
const CLASS_OF_HASH: Readonly<Record<number, number>> = {
  3655393761: 0, // Titan
  671679327: 1, // Hunter
  2271682572: 2, // Warlock
};

/** The report's side of one entry's read: the activity, its kill weapons, and the character's class (3 when unknown). */
export function reportSide(report: ArmorReport, entry: ArmorReportEntry) {
  return {
    reportActivity: report.activityDetails.directorActivityHash ?? report.activityDetails.referenceId ?? 0,
    reportWeapons: (entry.extended?.weapons ?? []).map((weapon) => weapon.referenceId),
    classType: CLASS_OF_HASH[entry.player?.classHash ?? 0] ?? 3,
  };
}

/** The profile components a read for armor needs: 204 current activities, 205 equipment. */
export interface ArmorProfile {
  characterActivities?: { data?: Record<string, { currentActivityHash?: number }> };
  characterEquipment?: { data?: Record<string, { items: readonly { itemHash: number; bucketHash?: number }[] }> };
}

/**
 * One character's side of an ArmorRead from a profile read: its current
 * activity, the set of each armor piece it has on (`setOf` an item hash's set,
 * from the manifest's set definitions), and its weapons. Undefined when the
 * read lacks either component for it.
 */
export function characterLoadout(
  profile: ArmorProfile,
  characterId: string,
  setOf: (itemHash: number) => number | undefined,
): Pick<ArmorRead, "currentActivity" | "armorSets" | "equippedWeapons"> | undefined {
  const activity = profile.characterActivities?.data?.[characterId];
  const items = profile.characterEquipment?.data?.[characterId]?.items;
  if (!activity || !items) return undefined;
  const armor = items.filter((item) => (item.bucketHash ?? 0) in ARMOR_BUCKETS);
  return {
    currentActivity: activity.currentActivityHash ?? 0,
    armorSets: armor.map((item) => setOf(item.itemHash)),
    equippedWeapons: items.filter((item) => (item.bucketHash ?? 0) in WEAPON_BUCKETS).map((item) => item.itemHash),
  };
}
