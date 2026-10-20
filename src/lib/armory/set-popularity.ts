/**
 * Armor set popularity: which set bonuses players wear in endgame activities.
 * This module is the published snapshot and what the optimizer's dialog makes
 * of it. How a crawl's profile reads become samples is set-popularity-reads.ts;
 * the store they're kept in, and the snapshot it's tallied into, is
 * set-popularity-store.ts.
 */

/** The snapshot's file in the data repo (see data-repo.ts). */
export const ARMOR_SET_POPULARITY_FILE = "armor-set-popularity.json";

export const BUCKETS = ["raid", "dungeon", "gmAlert", "conquest"] as const;
export type ActivityBucket = (typeof BUCKETS)[number];

export const BUCKET_LABELS: Record<ActivityBucket, string> = {
  raid: "Raids",
  dungeon: "Dungeons",
  gmAlert: "GM Vanguard Alerts",
  conquest: "Conquests",
};

/**
 * What set bonuses a loadout's armor makes, and with which sets: a 4-piece
 * (4 or 5 pieces of one set), two 2-pieces (lower hash first), one 2-piece
 * alone, or none. 5 pieces make at most two bonuses.
 */
export type SetConfig =
  | { kind: "none"; sets: readonly [] }
  | { kind: "two"; sets: readonly [number] }
  | { kind: "pair"; sets: readonly [number, number] }
  | { kind: "four"; sets: readonly [number] };
export type SetConfigKind = SetConfig["kind"];
export const SET_CONFIG_KINDS: readonly SetConfigKind[] = ["none", "two", "pair", "four"];

/** The set bonuses of the armor whose pieces are in `sets` (undefined: a piece in no set). */
export function setConfig(sets: readonly (number | undefined)[]): SetConfig {
  const counts = new Map<number, number>();
  for (const set of sets) if (set) counts.set(set, (counts.get(set) ?? 0) + 1);
  const bonuses = [...counts].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  if (bonuses.length === 0) return { kind: "none", sets: [] };
  if (bonuses[0][1] >= 4) return { kind: "four", sets: [bonuses[0][0]] };
  if (bonuses.length === 1) return { kind: "two", sets: [bonuses[0][0]] };
  const [a, b] = [bonuses[0][0], bonuses[1][0]].sort((x, y) => x - y);
  return { kind: "pair", sets: [a, b] };
}

/** A config's key in a BucketTally: its set hashes, comma-joined ("" for none). */
export const configKey = (config: SetConfig) => config.sets.join(",");

/** One bucket's characters, counted by config: each kind's counts keyed by configKey. */
export interface BucketTally {
  samples: number;
  counts: Record<SetConfigKind, Record<string, number>>;
}

/** The published snapshot. */
export interface ArmorSetPopularity {
  schema: 1;
  generatedAt: string;
  /** How many days of samples it covers. */
  days: number;
  buckets: Partial<Record<ActivityBucket, BucketTally>>;
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
  /** How the characters' armor splits by kind of config. */
  shape: Record<SetConfigKind, number>;
  /** Every set worn, most worn first. */
  sets: SetShare[];
  /** Every 2 + 2 pair worn, most worn first. */
  pairs: { sets: readonly [number, number]; share: number }[];
}

export function bucketView(tally: BucketTally): BucketView {
  const n = tally.samples || 1;
  const shape: Record<SetConfigKind, number> = { none: 0, two: 0, pair: 0, four: 0 };
  const sets = new Map<number, { four: number; two: number }>();
  const pairs: BucketView["pairs"] = [];
  for (const kind of SET_CONFIG_KINDS) {
    for (const [key, count] of Object.entries(tally.counts[kind] ?? {})) {
      shape[kind] += count / n;
      const hashes = key ? key.split(",").map(Number) : [];
      for (const hash of hashes) {
        let set = sets.get(hash);
        if (!set) sets.set(hash, (set = { four: 0, two: 0 }));
        set[kind === "four" ? "four" : "two"] += count;
      }
      if (kind === "pair") pairs.push({ sets: [hashes[0], hashes[1]], share: count / n });
    }
  }
  return {
    samples: tally.samples,
    shape,
    sets: [...sets]
      .map(([setHash, { four, two }]) => ({ setHash, four: four / n, two: two / n, any: (four + two) / n }))
      .sort((a, b) => b.any - a.any || b.four - a.four || a.setHash - b.setHash),
    pairs: pairs.sort((a, b) => b.share - a.share || a.sets[0] - b.sets[0]),
  };
}
