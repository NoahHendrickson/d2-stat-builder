import { readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { crawlSource, mergePopularity, type PerkPopularityIndex } from "../src/lib/weapons/perk-popularity";

/**
 * Adds up the last week of perk-popularity crawls into the published snapshot.
 * Each file is named for the UTC day it was crawled (2026-10-18.json), with the
 * hour after a T when a day has several crawls (2026-10-18T06.json); the
 * crawls of the days within --days of today are merged (see mergePopularity)
 * into --out.
 * With --prune, files older than that are deleted, so the data repo only
 * keeps what the snapshot is built from.
 *
 *   tsx scripts/merge-perk-popularity.ts --dir=daily --days=7 --out=perk-popularity.json --prune
 */

const DAY_FILE = /^(\d{4}-\d{2}-\d{2})(?:T\d{2})?\.json$/;

async function main() {
  const { values: args } = parseArgs({
    options: {
      dir: { type: "string" },
      days: { type: "string" },
      out: { type: "string" },
      prune: { type: "boolean" },
    },
  });
  if (!args.dir || !args.out) throw new Error("Pass --dir=<crawl files> and --out=<snapshot>.");
  const days = Number(args.days ?? 7);
  if (!Number.isInteger(days) || days < 1) throw new Error("--days must be a whole number of days.");
  const dir = resolve(args.dir);
  // The earliest UTC day still in the window: today and the days - 1 before it.
  const since = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);

  const files = (await readdir(dir)).flatMap((name) => {
    const day = DAY_FILE.exec(name)?.[1];
    return day ? [{ name, day }] : [];
  });
  const kept = files.filter((f) => f.day >= since).sort((a, b) => a.name.localeCompare(b.name));
  if (kept.length === 0) throw new Error(`No crawl files since ${since} in ${dir}; nothing written.`);
  const snapshots = await Promise.all(
    kept.map(async (f) => JSON.parse(await readFile(join(dir, f.name), "utf8")) as PerkPopularityIndex),
  );
  // With the files it came from, so each count can be traced to how and when it was crawled.
  const merged = { ...mergePopularity(snapshots), crawls: kept.map((f, i) => crawlSource(f.name, snapshots[i]!)) };
  const target = resolve(args.out);
  await writeFile(`${target}.tmp`, JSON.stringify(merged));
  await rename(`${target}.tmp`, target);
  const copies = Object.values(merged.weapons).reduce((sum, w) => sum + w.copies, 0);
  console.log(
    `Merged ${kept.length} crawls (${kept.map((f) => f.name.replace(".json", "")).join(", ")}): ${merged.players} players, ${copies} copies, ${Object.keys(merged.weapons).length} weapons → ${target}.`,
  );

  if (args.prune) {
    for (const f of files.filter((f) => f.day < since)) {
      await rm(join(dir, f.name));
      console.log(`Pruned ${f.name}.`);
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
