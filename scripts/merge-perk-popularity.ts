import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { popularityLookup, type PopularityCatalog } from "../src/lib/weapons/perk-popularity";
import {
  copyCount,
  emptyStore,
  lookupFingerprint,
  mergeCopies,
  pruneCopies,
  snapshotFromCopies,
  storeDay,
} from "../src/lib/weapons/popularity-copies";
import { decodeCopies, encodeCopies, storeKey } from "./copy-store-file";

/**
 * Folds crawls into the copy store and tallies it into the published snapshot
 * (see src/lib/weapons/popularity-copies.ts). Each --add is a crawl's file;
 * a copy seen again keeps its latest sighting, a player read again keeps their
 * latest read, and a crawl already in the store is skipped. A player who last
 * played more than --days ago (today included) drops out with their copies,
 * and a copy of a player whose latest read didn't see their vault drops out
 * once it hasn't been seen for --unseen-days (default 30): only a whole read
 * can tell a copy was dismantled.
 * The store is rewritten in place; a missing one starts empty. Both files are
 * encrypted with POPULARITY_STORE_KEY (see scripts/copy-store-file.ts).
 * Nothing is written when the store would be left empty, so a run of failed
 * crawls can't publish a blank snapshot.
 *
 *   tsx scripts/merge-perk-popularity.ts --store=store.bin --add=crawl.bin --days=14 --out=perk-popularity.json
 *
 * --catalog (weapons.json path, default public/data/weapons.json) holds every
 * copy to the weapon's current columns (see mergeCopies). A crawl that ran on
 * a different catalog couldn't list every weapon this one keeps, so its whole
 * reads don't count as whole: nothing of theirs is taken as dismantled.
 */

async function main() {
  const { values: args } = parseArgs({
    options: {
      store: { type: "string" },
      add: { type: "string", multiple: true },
      days: { type: "string" },
      "unseen-days": { type: "string" },
      catalog: { type: "string" },
      out: { type: "string" },
    },
  });
  if (!args.store || !args.out) throw new Error("Pass --store=<copy store> and --out=<snapshot>.");
  const days = Number(args.days ?? 14);
  if (!Number.isInteger(days) || days < 1) throw new Error("--days must be a whole number of days.");
  const unseenDays = Number(args["unseen-days"] ?? 30);
  if (!Number.isInteger(unseenDays) || unseenDays < 1) throw new Error("--unseen-days must be a whole number of days.");

  const catalog = JSON.parse(
    await readFile(resolve(args.catalog || "public/data/weapons.json"), "utf8"),
  ) as PopularityCatalog;
  const columns = new Map(catalog.weapons.map((w) => [w.hash, w.columns]));
  const columnsOf = (hash: number) => columns.get(hash);

  const key = storeKey();
  const storePath = resolve(args.store);
  let store = await readFile(storePath).then((file) => decodeCopies(file, key), (error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    console.log(`No copy store at ${storePath} yet; starting one.`);
    return emptyStore();
  });
  const before = copyCount(store);
  const fingerprint = lookupFingerprint(popularityLookup(catalog));
  const crawls = await Promise.all(
    (args.add ?? []).map(async (file) => {
      const crawl = decodeCopies(await readFile(resolve(file)), key);
      if (crawl.runs.some((run) => run.catalog !== fingerprint)) {
        console.warn(`${file} was crawled on a different catalog; its whole reads won't drop anything.`);
        crawl.owners.whole.fill(0);
      }
      return crawl;
    }),
  );
  // The empty first merge holds the store to today's catalog even with nothing to add.
  for (const crawl of [emptyStore(), ...crawls]) store = mergeCopies(store, crawl, columnsOf);
  store = pruneCopies(store, storeDay() - (days - 1), storeDay() - (unseenDays - 1));
  const copies = copyCount(store);
  if (copies === 0) throw new Error(`No player who's played in the last ${days} days has any copies; nothing written.`);

  const snapshot = snapshotFromCopies(store, columnsOf);
  await writeFile(`${storePath}.tmp`, encodeCopies(store, key));
  await rename(`${storePath}.tmp`, storePath);
  const target = resolve(args.out);
  await writeFile(`${target}.tmp`, JSON.stringify(snapshot));
  await rename(`${target}.tmp`, target);
  console.log(
    `Copy store: ${before} → ${copies} copies of ${store.weapons.size} weapons, from ${store.owners.ids.length} players who've played in the last ${days} days (${store.runs.length} crawls in that time) → ${storePath}, snapshot → ${target}.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
