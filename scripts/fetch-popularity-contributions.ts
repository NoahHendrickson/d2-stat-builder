import { loadEnvConfig } from "@next/env";
import { neon } from "@neondatabase/serverless";
import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { popularityLookup, type PopularityCatalog } from "../src/lib/weapons/perk-popularity";
import { decodeContribution } from "../src/lib/weapons/popularity-contribution";
import { lookupFingerprint, storeDay } from "../src/lib/weapons/popularity-copies";
import { readCollector } from "../src/lib/weapons/popularity-reads";
import { decodeRuns, encodeCopies, storeKey } from "./copy-store-file";

/**
 * Turns the weapons signed-in players saved as they loaded their inventory on
 * the site (src/lib/weapons/contribution-store.ts) into a crawl file the merge
 * (merge-perk-popularity.ts) folds in like any other. Each is a read of the
 * player's whole inventory, private vault included, so it also drops copies
 * of theirs that are gone.
 *
 *   tsx scripts/fetch-popularity-contributions.ts --store=store.bin --out=signed-in.bin
 *
 * It takes the players saved since the latest signed-in crawl in --store (the
 * store as the merge will add to it), or in the last --hours (default 336, two
 * weeks) without one, up to SETTLE_MS ago by the database's clock, and writes
 * nothing when there are none. A save's time is when its transaction started,
 * so one still committing as this reads can land just before the newest row
 * it sees; stopping short, and starting the next run from where this one
 * stopped (its `to`), picks it up then. --catalog
 * (weapons.json path, default public/data/weapons.json) picks the tally's
 * weapons, as in the crawler. The database comes from POPULARITY_DATABASE_URL
 * (a role that can only read popularity_contributions), falling back to
 * DATABASE_URL for local runs; the file's key from POPULARITY_STORE_KEY.
 */

/** How far behind the database's clock the read stops: far longer than a save takes. */
const SETTLE_MS = 5 * 60_000;

interface Row {
  id: string;
  type: number;
  /** ms, or null when the profile didn't say. */
  played: number | null;
  saved: number;
  weapons: string;
}

async function main() {
  loadEnvConfig(process.cwd());
  const { values: args } = parseArgs({
    options: {
      store: { type: "string" },
      hours: { type: "string" },
      catalog: { type: "string" },
      out: { type: "string" },
    },
  });
  if (!args.out) throw new Error("Pass --out=<path> for the crawl file.");
  const hours = Number(args.hours ?? 336);
  if (!Number.isFinite(hours) || hours <= 0) throw new Error("--hours must be a positive number.");
  const url = process.env.POPULARITY_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("Set POPULARITY_DATABASE_URL to read the saved weapons.");

  const key = storeKey();
  // Picks up where the store's latest signed-in crawl ended, so each save is folded in once.
  const runs = args.store
    ? await readFile(resolve(args.store)).then(
        (file) => decodeRuns(file, key),
        (error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
          return [];
        },
      )
    : [];
  const latest = runs
    .filter((run) => run.sample.kind === "signed-in")
    .map((run) => Date.parse(run.to))
    .reduce((a, b) => Math.max(a, b), -Infinity);
  const since = new Date(Number.isFinite(latest) ? latest : Date.now() - hours * 3_600_000).toISOString();

  const sql = neon(url);
  const [{ until }] = (await sql`
    SELECT (extract(epoch FROM date_trunc('milliseconds', now())) * 1000)::float8 - ${SETTLE_MS} AS until`) as {
    until: number;
  }[];
  const rows = (await sql`
    SELECT membership_id::text AS id,
      membership_type::int AS type,
      (extract(epoch FROM last_played) * 1000)::float8 AS played,
      (extract(epoch FROM date_trunc('milliseconds', saved_at)) * 1000)::float8 AS saved,
      encode(weapons, 'base64') AS weapons
    FROM popularity_contributions
    WHERE date_trunc('milliseconds', saved_at) > ${since}::timestamptz
      AND date_trunc('milliseconds', saved_at) <= ${new Date(until).toISOString()}::timestamptz
    ORDER BY saved_at`) as Row[];
  if (rows.length === 0) {
    console.log(`No signed-in players saved from ${since} to ${new Date(until).toISOString()}; nothing written.`);
    return;
  }

  const catalog = JSON.parse(
    await readFile(resolve(args.catalog || "public/data/weapons.json"), "utf8"),
  ) as PopularityCatalog;
  const lookup = popularityLookup(catalog);
  const collected = readCollector(lookup);
  let copies = 0;
  let vaults = 0;
  for (const row of rows) {
    const { sawAll, copies: weapons } = decodeContribution(gunzipSync(Buffer.from(row.weapons, "base64")));
    const { found, whole } = collected.add(
      // keep: even with none of the tally's weapons, a whole read says they have none now.
      { id: BigInt(row.id), type: row.type, played: row.played === null ? undefined : storeDay(row.played), readAt: row.saved },
      weapons,
      sawAll,
      true,
    );
    copies += found;
    if (whole) vaults++;
  }

  const generatedAt = new Date().toISOString();
  const crawl = collected.store(Date.parse(generatedAt), {
    generatedAt,
    // When the first of them was saved, and where this read stopped: the next run starts after `to`.
    from: new Date(rows[0]!.saved).toISOString(),
    to: new Date(until).toISOString(),
    players: rows.length,
    // Whether they were in the store already isn't known here.
    rechecked: 0,
    copies,
    vaults,
    sample: { kind: "signed-in" },
    catalog: lookupFingerprint(lookup),
  });
  const target = resolve(args.out);
  await writeFile(`${target}.tmp`, encodeCopies(crawl, key));
  await rename(`${target}.tmp`, target);
  console.log(
    `Wrote ${copies} copies of ${collected.weapons()} weapons from ${rows.length} signed-in players (${vaults} read whole) saved since ${since} to ${target}.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
