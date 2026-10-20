import { gunzipSync, gzipSync } from "node:zlib";
import { BUCKETS, SET_CONFIG_KINDS, type SetConfig, type SetConfigKind } from "../src/lib/armory/set-popularity";
import type { SetSample, SetStore } from "../src/lib/armory/set-popularity-store";
import { seal, unseal } from "./sealed-file";

/**
 * The armor set store's file (src/lib/armory/set-popularity-store.ts). It
 * lists characters, so it's encrypted (scripts/sealed-file.ts, the same
 * POPULARITY_STORE_KEY as the copy store) and can sit in a public release.
 * Sealed inside is the gzip of JSON: { format: "D2AS", version, runs, samples },
 * each sample a tuple: character, bucket (index in BUCKETS), minute, class,
 * config kind (index in SET_CONFIG_KINDS), then the config's set hashes.
 */

const FORMAT = "D2AS";
const VERSION = 1;
const WHAT = "armor set store";

/** How many set hashes each kind of config has. */
const SETS_OF: Record<SetConfigKind, number> = { none: 0, two: 1, pair: 2, four: 1 };

type Row = [character: string, bucket: number, minute: number, classType: number, kind: number, ...sets: number[]];

export function encodeSetStore(store: SetStore, key: Buffer): Buffer {
  const samples: Row[] = store.samples.map((s) => [
    s.character,
    BUCKETS.indexOf(s.bucket),
    s.minute,
    s.classType,
    SET_CONFIG_KINDS.indexOf(s.config.kind),
    ...s.config.sets,
  ]);
  return seal(gzipSync(JSON.stringify({ format: FORMAT, version: VERSION, runs: store.runs, samples })), key);
}

export function decodeSetStore(file: Buffer, key: Buffer): SetStore {
  const data = JSON.parse(gunzipSync(unseal(file, key, WHAT)).toString("utf8"));
  if (data?.format !== FORMAT) throw new Error(`Not an ${WHAT}.`);
  if (data.version !== VERSION) throw new Error(`${WHAT} version ${data.version}; this code reads ${VERSION}.`);
  const samples = (data.samples as Row[]).map(([character, bucket, minute, classType, kind, ...sets]): SetSample => {
    const name = BUCKETS[bucket];
    const configKind = SET_CONFIG_KINDS[kind];
    if (!name || !configKind || sets.length !== SETS_OF[configKind])
      throw new Error(`A sample in the ${WHAT} has an unknown bucket or config.`);
    // The kind and its count of sets were just checked.
    return { character, bucket: name, minute, classType, config: { kind: configKind, sets } as unknown as SetConfig };
  });
  return { runs: data.runs, samples };
}
