import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { traitColumns, type PopularityCatalog } from "../src/lib/weapons/perk-popularity";
import {
  copyCount,
  decodeCopies,
  emptyStore,
  encodeCopies,
  mergeCopies,
  pruneCopies,
  snapshotFromCopies,
  storeDay,
} from "../src/lib/weapons/popularity-copies";

/**
 * Folds crawls into the copy store and tallies it into the published snapshot
 * (see src/lib/weapons/popularity-copies.ts). Each --add (a crawl's file, in
 * the order given) replaces any copy it saw again; copies last seen more than
 * --days ago (today included) drop out. The store is rewritten in place, and
 * a missing one starts empty.
 *
 *   tsx scripts/merge-perk-popularity.ts --store=copies.bin.gz --add=crawl.bin.gz --days=14 --out=perk-popularity.json
 *
 * --catalog (weapons.json path, default public/data/weapons.json) gives each
 * weapon's columns: one whose column count has changed since its copies were
 * seen is left out until they're seen again.
 */

async function main() {
  const { values: args } = parseArgs({
    options: {
      store: { type: "string" },
      add: { type: "string", multiple: true },
      days: { type: "string" },
      catalog: { type: "string" },
      out: { type: "string" },
    },
  });
  if (!args.store || !args.out) throw new Error("Pass --store=<copy store> and --out=<snapshot>.");
  const days = Number(args.days ?? 14);
  if (!Number.isInteger(days) || days < 1) throw new Error("--days must be a whole number of days.");

  const storePath = resolve(args.store);
  let store = await readFile(storePath).then(decodeCopies, (error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    console.log(`No copy store at ${storePath} yet; starting one.`);
    return emptyStore();
  });
  const before = copyCount(store);
  for (const file of args.add ?? []) store = mergeCopies(store, decodeCopies(await readFile(resolve(file))));
  store = pruneCopies(store, storeDay() - (days - 1));

  const catalog = JSON.parse(
    await readFile(resolve(args.catalog || "public/data/weapons.json"), "utf8"),
  ) as PopularityCatalog;
  const weapons = new Map(catalog.weapons.map((w) => [w.hash, w]));
  const snapshot = snapshotFromCopies(
    store,
    (hash) => weapons.get(hash)?.columns.length,
    (hash) => {
      const weapon = weapons.get(hash);
      return weapon && traitColumns(weapon.columns);
    },
  );

  await writeFile(`${storePath}.tmp`, encodeCopies(store));
  await rename(`${storePath}.tmp`, storePath);
  const target = resolve(args.out);
  await writeFile(`${target}.tmp`, JSON.stringify(snapshot));
  await rename(`${target}.tmp`, target);
  const tallied = Object.values(snapshot.weapons).reduce((sum, w) => sum + w.copies, 0);
  console.log(
    `Copy store: ${before} → ${copyCount(store)} copies of ${store.weapons.size} weapons, from ${store.runs.length} crawls over the last ${days} days. Snapshot: ${tallied} copies of ${Object.keys(snapshot.weapons).length} weapons → ${target}.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
