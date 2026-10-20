import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  emptySetStore,
  mergeSetStores,
  pruneSetStore,
  setPopularitySnapshot,
} from "../src/lib/armory/set-popularity-store";
import { storeDay } from "../src/lib/weapons/popularity-copies";
import { readStoreOr, storeKey } from "./sealed-file";
import { decodeSetStore, encodeSetStore } from "./set-store-file";
import { writeFileAtomic } from "./write-file-atomic";

/**
 * Folds armor crawls (crawl-perk-popularity.ts --armor-out) into the armor set
 * store and tallies it into the snapshot the optimizer's set popularity reads
 * (see src/lib/armory/set-popularity-store.ts). Each character keeps its
 * latest sample per bucket; a sample from more than --days ago (today
 * included) drops out. The store is rewritten in place; a missing one starts
 * empty. Both files are encrypted with POPULARITY_STORE_KEY. As with the
 * weapon merge, nothing is written when the store would be left empty, so a
 * run of failed crawls can't publish a blank snapshot.
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
  let store = await readStoreOr(storePath, (file) => decodeSetStore(file, key), emptySetStore, "armor set store");
  const before = store.samples.length;
  for (const file of args.add ?? []) store = mergeSetStores(store, decodeSetStore(await readFile(resolve(file)), key));
  store = pruneSetStore(store, storeDay() - (days - 1));
  if (store.samples.length === 0) throw new Error(`No armor set samples from the last ${days} days; nothing written.`);

  const snapshot = setPopularitySnapshot(store, new Date().toISOString(), days);
  await writeFileAtomic(storePath, encodeSetStore(store, key));
  const target = resolve(args.out);
  await writeFileAtomic(target, JSON.stringify(snapshot));
  const counts = Object.entries(snapshot.buckets).map(([bucket, tally]) => `${tally.samples} ${bucket}`);
  console.log(
    `Armor set store: ${before} → ${store.samples.length} samples (${counts.join(", ")}), ${store.runs.length} crawls in the last ${days} days → ${storePath}, snapshot → ${target}.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
