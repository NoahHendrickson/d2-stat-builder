import { gunzipSync, gzipSync } from "node:zlib";
import { BUCKETS, type SetConfig, type SetSample, type SetStore } from "../src/lib/armory/set-popularity";
import { seal, unseal } from "./copy-store-file";

/**
 * The armor set store's file (src/lib/armory/set-popularity.ts). It lists
 * characters, so it's encrypted like the copy store (scripts/copy-store-file.ts,
 * the same POPULARITY_STORE_KEY) and can sit in a public release. Inside, the
 * gzip of JSON: { format: "D2AS", version, runs, samples }, each sample a
 * tuple: character, bucket index (BUCKETS), day, class, then its config's
 * kind (0 none, 1 two, 2 pair, 3 four) and set hashes.
 */

const FORMAT = "D2AS";
const VERSION = 1;

type Row = [character: string, bucket: number, day: number, classType: number, kind: number, ...sets: number[]];

const KINDS = ["none", "two", "pair", "four"] as const;

function configRow(config: SetConfig): number[] {
  switch (config.kind) {
    case "none":
      return [0];
    case "two":
      return [1, config.set];
    case "pair":
      return [2, ...config.sets];
    case "four":
      return [3, config.set];
  }
}

function rowConfig(kind: number, sets: number[]): SetConfig {
  switch (KINDS[kind]) {
    case "two":
      return { kind: "two", set: sets[0] };
    case "pair":
      return { kind: "pair", sets: [sets[0], sets[1]] };
    case "four":
      return { kind: "four", set: sets[0] };
    case "none":
      return { kind: "none" };
  }
  throw new Error(`Unknown set config kind ${kind} in the armor set store.`);
}

export function encodeSetStore(store: SetStore, key: Buffer): Buffer {
  const samples: Row[] = store.samples.map((s) => [
    s.character,
    BUCKETS.indexOf(s.bucket),
    s.day,
    s.classType,
    ...(configRow(s.config) as [number, ...number[]]),
  ]);
  return seal(gzipSync(JSON.stringify({ format: FORMAT, version: VERSION, runs: store.runs, samples })), key);
}

export function decodeSetStore(file: Buffer, key: Buffer): SetStore {
  const data = JSON.parse(gunzipSync(unseal(file, key)).toString("utf8"));
  if (data?.format !== FORMAT) throw new Error("Not an armor set store.");
  if (data.version !== VERSION) throw new Error(`Armor set store version ${data.version}; this code reads ${VERSION}.`);
  const samples: SetSample[] = (data.samples as Row[]).map(([character, bucket, day, classType, kind, ...sets]) => {
    const name = BUCKETS[bucket];
    if (!name) throw new Error(`Unknown bucket ${bucket} in the armor set store.`);
    return { character, bucket: name, day, classType, config: rowConfig(kind, sets) };
  });
  return { runs: data.runs, samples };
}
