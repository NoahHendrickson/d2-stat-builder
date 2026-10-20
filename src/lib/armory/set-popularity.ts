/**
 * Armor set popularity: which set bonuses players wear in endgame activities.
 *
 * The popularity crawl (scripts/crawl-perk-popularity.ts --armor-out) finds
 * players through post-game reports, as it does for weapons, and reads each
 * one's profile a minute or two after their activity ended. A report lists no
 * armor, so what counts is what the read sees, and when:
 *
 * - In one of the BUCKETS' activities now: what they have on is what they're
 *   wearing in it, so it counts for that activity.
 * - In orbit or a social space after a Conquest or Grandmaster Vanguard Alert
 *   (most players go back to orbit after those) within ORBIT_READ_MS of it
 *   ending, with every weapon that got kills in it still equipped: no
 *   loadout swap since, so it counts for the one they just finished. Raids and
 *   dungeons fill without these, so they take only in-activity reads.
 * - Anything else isn't counted.
 *
 * Each character counts once per bucket, with its latest sample, for as long
 * as that sample is inside the window the merge keeps (14 days), so someone
 * who raids every night weighs the same as someone who raided once.
 * The store lists characters, so it's encrypted like the weapon store; the
 * snapshot the app reads (ArmorSetPopularity) has only counts.
 */

// Runtime imports are relative so the module runs under vitest and the crawler.
import { ARMOR_BUCKETS } from "./stats";

/** Where the published snapshot lives (GitHub Pages, so serving it costs Vercel nothing). */
export const ARMOR_SET_POPULARITY_URL =
  "https://noahhendrickson.github.io/d2-conflux-data/armor-set-popularity.json";

export const BUCKETS = ["raid", "dungeon", "gmAlert", "conquest"] as const;
export type ActivityBucket = (typeof BUCKETS)[number];

export const BUCKET_LABELS: Record<ActivityBucket, string> = {
  raid: "Raids",
  dungeon: "Dungeons",
  gmAlert: "GM Vanguard Alerts",
  conquest: "Conquests",
};

/** Buckets that also take orbit reads, with the weapon check (see the top). */
const ORBIT_BUCKETS: ReadonlySet<ActivityBucket> = new Set(["gmAlert", "conquest"]);
/** How soon after the report's activity ended an orbit read must be. */
export const ORBIT_READ_MS = 3 * 60_000;

/** DestinyActivityModeType: Raid, Dungeon, Social (the Tower, the Enclave, the Pale Heart's refuges). */
const RAID_MODE = 4;
const DUNGEON_MODE = 82;
const SOCIAL_MODE = 40;

/** What set bonuses a loadout's armor makes. 5 pieces make at most two. */
export type SetConfig =
  | { kind: "four"; set: number }
  | { kind: "pair"; sets: readonly [number, number] }
  | { kind: "two"; set: number }
  | { kind: "none" };

/** The set bonuses of the armor whose pieces are in `sets` (undefined: a piece in no set). */
export function setConfig(sets: readonly (number | undefined)[]): SetConfig {
  const counts = new Map<number, number>();
  for (const set of sets) if (set) counts.set(set, (counts.get(set) ?? 0) + 1);
  const bonuses = [...counts].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  if (bonuses.length === 0) return { kind: "none" };
  if (bonuses[0][1] >= 4) return { kind: "four", set: bonuses[0][0] };
  if (bonuses.length === 1) return { kind: "two", set: bonuses[0][0] };
  const [a, b] = [bonuses[0][0], bonuses[1][0]].sort((x, y) => x - y);
  return { kind: "pair", sets: [a, b] };
}

/** The manifest tables the activity lookup reads: just the fields it needs. */
export interface ActivityTables {
  activities: Record<
    string,
    { displayProperties?: { name?: string }; activityTypeHash?: number; activityModeTypes?: number[] }
  >;
  activityTypes: Record<string, { displayProperties?: { name?: string } }>;
  fireteamFinderGraph: Record<
    string,
    { displayProperties?: { name?: string }; children?: number[]; relatedActivityHashes?: number[] }
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
  const cache = new Map<number, ActivityBucket | undefined>();
  function classify(hash: number): ActivityBucket | undefined {
    const def = tables.activities[hash];
    if (!def) return undefined;
    const type = def.activityTypeHash ?? 0;
    const modes = def.activityModeTypes ?? [];
    if (raidTypes.has(type) || modes.includes(RAID_MODE)) return "raid";
    if (dungeonTypes.has(type) || modes.includes(DUNGEON_MODE)) return "dungeon";
    if (alerts.has(hash)) return "gmAlert";
    if (/\bConquest:/.test(def.displayProperties?.name ?? "")) return "conquest";
    return undefined;
  }
  return {
    bucket(hash) {
      if (!cache.has(hash)) cache.set(hash, classify(hash));
      return cache.get(hash);
    },
    between(hash) {
      if (hash === 0) return true;
      const def = tables.activities[hash];
      if (!def) return false;
      // Orbit is an activity with neither a type nor a mode.
      if (!def.activityTypeHash && !def.activityModeTypes?.length) return true;
      return socialTypes.has(def.activityTypeHash ?? 0) || (def.activityModeTypes ?? []).includes(SOCIAL_MODE);
    },
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

/** Kinetic, energy and power weapon buckets. */
const WEAPON_BUCKET_HASHES: ReadonlySet<number> = new Set([1498876634, 2465295065, 953998645]);

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
    equippedWeapons: items.filter((item) => WEAPON_BUCKET_HASHES.has(item.bucketHash ?? 0)).map((item) => item.itemHash),
  };
}

/** A report entry's classHash → DestinyClass. */
export const CLASS_OF_HASH: Readonly<Record<number, number>> = {
  3655393761: 0, // Titan
  671679327: 1, // Hunter
  2271682572: 2, // Warlock
};

/** A character's latest sample in one bucket. */
export interface SetSample {
  /** The character id. */
  character: string;
  bucket: ActivityBucket;
  /** The day it was read (storeDay). */
  day: number;
  /** DestinyClass: 0 Titan, 1 Hunter, 2 Warlock (kept for a class filter later; the snapshot doesn't split by it). */
  classType: number;
  config: SetConfig;
}

/** One crawl's summary, as the store keeps it. */
export interface SetRun {
  generatedAt: string;
  /** Profiles read for armor, and how many of them counted. */
  reads: number;
  samples: number;
}

export interface SetStore {
  runs: SetRun[];
  samples: SetSample[];
}

export const emptySetStore = (): SetStore => ({ runs: [], samples: [] });

const sampleKey = (sample: SetSample) => `${sample.character}:${sample.bucket}`;

/**
 * Folds `newer` into `older`: each character keeps its latest sample per
 * bucket (`newer`'s on the same day), and a run already in the store is
 * skipped.
 */
export function mergeSetStores(older: SetStore, newer: SetStore): SetStore {
  const known = new Set(older.runs.map((run) => run.generatedAt));
  const samples = new Map(older.samples.map((sample) => [sampleKey(sample), sample]));
  for (const sample of newer.samples) {
    const kept = samples.get(sampleKey(sample));
    if (!kept || sample.day >= kept.day) samples.set(sampleKey(sample), sample);
  }
  return {
    runs: [...older.runs, ...newer.runs.filter((run) => !known.has(run.generatedAt))],
    samples: [...samples.values()],
  };
}

/** The store without anything from before `firstDay` (storeDay). */
export function pruneSetStore(store: SetStore, firstDay: number, dayOf: (iso: string) => number): SetStore {
  return {
    runs: store.runs.filter((run) => dayOf(run.generatedAt) >= firstDay),
    samples: store.samples.filter((sample) => sample.day >= firstDay),
  };
}

/** One bucket's characters by set bonuses. Set hashes are the keys; a pair's is "low,high". */
export interface BucketTally {
  samples: number;
  none: number;
  /** A 4-piece bonus (4 or 5 pieces of one set). */
  four: Record<string, number>;
  /** Two 2-piece bonuses. */
  pairs: Record<string, number>;
  /** One 2-piece bonus alone. */
  two: Record<string, number>;
}

/** The published snapshot. */
export interface ArmorSetPopularity {
  schema: 1;
  generatedAt: string;
  /** How many days of samples it covers. */
  days: number;
  buckets: Partial<Record<ActivityBucket, BucketTally>>;
}

const bump = (counts: Record<string, number>, key: string) => {
  counts[key] = (counts[key] ?? 0) + 1;
};

export function setPopularitySnapshot(store: SetStore, generatedAt: string, days: number): ArmorSetPopularity {
  const buckets: ArmorSetPopularity["buckets"] = {};
  for (const sample of store.samples) {
    const tally = (buckets[sample.bucket] ??= { samples: 0, none: 0, four: {}, pairs: {}, two: {} });
    tally.samples++;
    const { config } = sample;
    if (config.kind === "none") tally.none++;
    else if (config.kind === "four") bump(tally.four, String(config.set));
    else if (config.kind === "two") bump(tally.two, String(config.set));
    else bump(tally.pairs, config.sets.join(","));
  }
  return { schema: 1, generatedAt, days, buckets };
}

/** A set's share of a bucket's characters: with its 4-piece bonus, with its 2-piece (alone or beside another set's), and either. */
export interface SetShare {
  setHash: number;
  four: number;
  two: number;
  any: number;
}

/** A bucket as the popularity dialog shows it: every share is of `samples`. */
export interface BucketView {
  samples: number;
  /** How the characters' armor splits: a 4-piece, 2 + 2, one 2-piece, no bonus. */
  shape: { four: number; pair: number; two: number; none: number };
  /** Every set worn, most worn first. */
  sets: SetShare[];
  /** Every 2 + 2 pair worn, most worn first. */
  pairs: { sets: readonly [number, number]; share: number }[];
}

const sum = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0);

export function bucketView(tally: BucketTally): BucketView {
  const n = tally.samples || 1;
  const sets = new Map<number, { four: number; two: number }>();
  const entry = (hash: number) => {
    let e = sets.get(hash);
    if (!e) sets.set(hash, (e = { four: 0, two: 0 }));
    return e;
  };
  for (const [hash, count] of Object.entries(tally.four)) entry(Number(hash)).four += count;
  for (const [hash, count] of Object.entries(tally.two)) entry(Number(hash)).two += count;
  const pairs: BucketView["pairs"] = [];
  for (const [key, count] of Object.entries(tally.pairs)) {
    const [a, b] = key.split(",").map(Number);
    entry(a).two += count;
    entry(b).two += count;
    pairs.push({ sets: [a, b], share: count / n });
  }
  return {
    samples: tally.samples,
    shape: {
      four: sum(tally.four) / n,
      pair: sum(tally.pairs) / n,
      two: sum(tally.two) / n,
      none: tally.none / n,
    },
    sets: [...sets]
      .map(([setHash, { four, two }]) => ({ setHash, four: four / n, two: two / n, any: (four + two) / n }))
      .sort((a, b) => b.any - a.any || b.four - a.four || a.setHash - b.setHash),
    pairs: pairs.sort((a, b) => b.share - a.share || a.sets[0] - b.sets[0]),
  };
}
