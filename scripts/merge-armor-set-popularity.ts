import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  emptySetStore,
  mergeSetStores,
  pruneSetStore,
  setPopularitySnapshot,
} from "../src/lib/armory/set-popularity";
import { storeDay } from "../src/lib/weapons/popularity-copies";
import { storeKey } from "./copy-store-file";
import { decodeSetStore, encodeSetStore } from "./set-store-file";

/**
 * Folds armor crawls (crawl-perk-popularity.ts --armor-out) into the armor set
 * store and tallies it into the snapshot the optimizer's set popularity reads
 * (see src/lib/armory/set-popularity.ts). Each character keeps its latest
 * sample per bucket; a sample from more than --days ago (today included)
 * drops out. The store is rewritten in place; a missing one starts empty.
 * Both files are encrypted with POPULARITY_STORE_KEY.
 *
 *   tsx scripts/merge-armor-set-popularity.ts --store=armor-store.bin --add=armor-crawl.bin --days=14 --out=armor-set-popularity.json
 */

async function main() {
  const { values: args } = parseArgs({
    options: {
      store: { type: "string" },
      add: { type: "string", multiple: true },
      days: { type: "string" },
      out: { type: "string" },
    },
  });
  if (!args.store || !args.out) throw new Error("Pass --store=<armor set store> and --out=<snapshot>.");
  const days = Number(args.days ?? 14);
  if (!Number.isInteger(days) || days < 1) throw new Error("--days must be a whole number of days.");

  const key = storeKey();
  const storePath = resolve(args.store);
  let store = await readFile(storePath).then(
    (file) => decodeSetStore(file, key),
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      console.log(`No armor set store at ${storePath} yet; starting one.`);
      return emptySetStore();
    },
  );
  const before = store.samples.length;
  for (const file of args.add ?? []) store = mergeSetStores(store, decodeSetStore(await readFile(resolve(file)), key));
  store = pruneSetStore(store, storeDay() - (days - 1), (iso) => storeDay(Date.parse(iso)));

  const generatedAt = new Date().toISOString();
  const snapshot = setPopularitySnapshot(store, generatedAt, days);
  await writeFile(`${storePath}.tmp`, encodeSetStore(store, key));
  await rename(`${storePath}.tmp`, storePath);
  const target = resolve(args.out);
  await writeFile(`${target}.tmp`, JSON.stringify(snapshot));
  await rename(`${target}.tmp`, target);
  const counts = Object.entries(snapshot.buckets).map(([bucket, tally]) => `${tally.samples} ${bucket}`);
  console.log(
    `Armor set store: ${before} → ${store.samples.length} samples (${counts.join(", ") || "none"}), ${store.runs.length} crawls in the last ${days} days → ${storePath}, snapshot → ${target}.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
