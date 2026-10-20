/**
 * The armor set store: each character's latest sample per bucket
 * (set-popularity-reads.ts makes them), kept for as long as it's inside the
 * window the merge keeps (14 days), so someone who raids every night weighs
 * the same as someone who raided once. It lists characters, so its file is
 * encrypted (scripts/set-store-file.ts); the snapshot tallied from it
 * (ArmorSetPopularity) has only counts.
 */

// Runtime imports are relative so the module runs under vitest and the crawler.
import { dayOfMinute, storeDay } from "../weapons/popularity-copies";
import {
  configKey,
  type ActivityBucket,
  type ArmorSetPopularity,
  type BucketTally,
  type SetConfig,
} from "./set-popularity";

/** A character's latest sample in one bucket. */
export interface SetSample {
  /** The character id. */
  character: string;
  bucket: ActivityBucket;
  /** When it was read (storeMinute). */
  minute: number;
  /** DestinyClass: 0 Titan, 1 Hunter, 2 Warlock, 3 unknown (kept for a class filter later; the snapshot doesn't split by it). */
  classType: number;
  config: SetConfig;
}

/** One crawl's summary, as the store keeps it. */
export interface SetRun {
  generatedAt: string;
  /** Profiles read for armor, and how many samples they made. */
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
 * Keeps `sample` in `byKey` if it's its character's latest in its bucket. A
 * tie keeps the one already there, so adding the same sample twice changes
 * nothing.
 */
export function addSample(byKey: Map<string, SetSample>, sample: SetSample) {
  const key = sampleKey(sample);
  const kept = byKey.get(key);
  if (!kept || sample.minute > kept.minute) byKey.set(key, sample);
}

/**
 * Folds `newer` (a crawl, or another store) into `older`: each character
 * keeps its latest sample per bucket, by when it was read, whatever order the
 * crawls come in. A crawl already in the store is skipped whole; with the
 * latest read winning, folding in an old one again couldn't roll anything
 * back anyway.
 */
export function mergeSetStores(older: SetStore, newer: SetStore): SetStore {
  const known = new Set(older.runs.map((run) => run.generatedAt));
  const fresh = newer.runs.filter((run) => !known.has(run.generatedAt));
  if (newer.runs.length > 0 && fresh.length === 0) return older;
  const byKey = new Map<string, SetSample>();
  for (const sample of older.samples) addSample(byKey, sample);
  for (const sample of newer.samples) addSample(byKey, sample);
  return { runs: [...older.runs, ...fresh], samples: [...byKey.values()] };
}

/** The store without anything from before `firstDay` (storeDay). */
export function pruneSetStore(store: SetStore, firstDay: number): SetStore {
  return {
    runs: store.runs.filter((run) => storeDay(Date.parse(run.generatedAt)) >= firstDay),
    samples: store.samples.filter((sample) => dayOfMinute(sample.minute) >= firstDay),
  };
}

export function setPopularitySnapshot(store: SetStore, generatedAt: string, days: number): ArmorSetPopularity {
  const buckets: ArmorSetPopularity["buckets"] = {};
  for (const { bucket, config } of store.samples) {
    const tally: BucketTally = (buckets[bucket] ??= {
      samples: 0,
      counts: { none: {}, two: {}, pair: {}, four: {} },
    });
    tally.samples++;
    const counts = tally.counts[config.kind];
    const key = configKey(config);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return { schema: 1, generatedAt, days, buckets };
}
