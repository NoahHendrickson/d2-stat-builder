import { loadEnvConfig } from "@next/env";
import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  addCopy,
  equippedPerks,
  popularityLookup,
  type PerkPopularityIndex,
  type PopularityCatalog,
  type PopularityMode,
  type WeaponPopularity,
} from "../src/lib/weapons/perk-popularity";

/**
 * Samples which perks players run on legendary weapons, from Bungie's public
 * API, and writes a perk-popularity snapshot (see src/lib/weapons/perk-popularity.ts).
 *
 * It walks back from the newest post-game report, a few report ids apart so the
 * sample spreads over time, and for each player it hasn't seen reads the
 * weapons the character in that report has equipped, with their perks.
 * Equipped items are public on every profile, so no one signs in. Nothing about
 * a player is kept except the tally. All requests share one rate limit and back
 * off when Bungie asks.
 *
 *   tsx scripts/crawl-perk-popularity.ts --players=500 --out=public/dev-data/perk-popularity.json
 *
 * Options: --players (stop after this many, default 20000), --minutes (time
 * budget, default 300), --rate (requests per second, default 8), --workers
 * (default 6), --step (report ids between samples, default 23), --catalog
 * (weapons.json path, default public/data/weapons.json), --out (required).
 * The key comes from BUNGIE_CRAWLER_API_KEY, falling back to
 * NEXT_PUBLIC_BUNGIE_API_KEY for small local runs.
 */

const WEAPON_BUCKETS = new Set([1498876634, 2465295065, 953998645]);
/** DestinyActivityModeType.AllPvP. */
const ALL_PVP = 5;

interface Options {
  players: number;
  minutes: number;
  rate: number;
  workers: number;
  step: number;
  catalog: string;
  out: string;
}

function readOptions(): Options {
  const args = Object.fromEntries(
    process.argv.slice(2).map((arg) => {
      const [key, value = ""] = arg.replace(/^--/, "").split("=");
      return [key, value];
    }),
  );
  if (!args.out) throw new Error("Pass --out=<path> for the snapshot.");
  const number = (key: string, fallback: number) => {
    const value = Number(args[key] ?? fallback);
    if (!Number.isFinite(value) || value <= 0) throw new Error(`--${key} must be a positive number.`);
    return value;
  };
  return {
    players: number("players", 20_000),
    minutes: number("minutes", 300),
    rate: number("rate", 8),
    workers: number("workers", 6),
    step: number("step", 23),
    catalog: args.catalog || "public/data/weapons.json",
    out: args.out,
  };
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Bungie's envelope. */
interface BungieResponse<T> {
  ErrorCode: number;
  ErrorStatus: string;
  ThrottleSeconds: number;
  Response?: T;
}

/** Codes that mean "not there" or "can't see it", not "try again". */
const SKIP_CODES = new Set([
  1653, // DestinyPGCRNotFound
  1601, // DestinyAccountNotFound
  1618, // DestinyUnexpectedError
  1665, // DestinyPrivacyRestriction
  217, // UserCannotResolveCentralAccount
]);

function bungieClient(apiKey: string, rate: number) {
  const spacing = 1000 / rate;
  let nextSlot = 0;
  let requests = 0;
  /** Waits for the next free slot under the shared rate limit. */
  async function slot() {
    const now = Date.now();
    const at = Math.max(now, nextSlot);
    nextSlot = at + spacing;
    if (at > now) await sleep(at - now);
  }
  async function get<T>(url: string): Promise<T | undefined> {
    for (let attempt = 0; attempt < 5; attempt++) {
      await slot();
      requests++;
      let body: BungieResponse<T> | undefined;
      let status = 0;
      try {
        const response = await fetch(url, { headers: { "X-API-Key": apiKey } });
        status = response.status;
        body = (await response.json().catch(() => undefined)) as BungieResponse<T> | undefined;
      } catch {
        // Network blip: back off and retry.
      }
      if (body?.ErrorCode === 1) return body.Response;
      if (body && SKIP_CODES.has(body.ErrorCode)) return undefined;
      if (body?.ErrorCode === 5) throw new Error("Bungie's API is down for maintenance.");
      if (body?.ErrorCode === 2101 || body?.ErrorCode === 2102)
        throw new Error(`The API key was rejected (${body.ErrorStatus}).`);
      // Throttled, a 5xx, or something unexpected: wait as long as Bungie asks, at least a backoff.
      const wait = Math.max((body?.ThrottleSeconds ?? 0) * 1000, 1000 * 2 ** attempt);
      if (status === 429 || body?.ThrottleSeconds) nextSlot = Date.now() + wait;
      await sleep(wait);
    }
    return undefined;
  }
  return { get, requests: () => requests };
}

interface PgcrEntry {
  characterId: string;
  player?: { destinyUserInfo?: { membershipType: number; membershipId: string } };
}
interface Pgcr {
  period: string;
  activityDetails: { mode: number; modes?: number[] };
  entries: PgcrEntry[];
}
interface Profile {
  characterEquipment?: {
    data?: Record<string, { items: { itemHash: number; itemInstanceId?: string; bucketHash: number }[] }>;
  };
  itemComponents?: {
    sockets?: { data?: Record<string, { sockets: { plugHash?: number }[] }> };
  };
}

const pgcrUrl = (id: number) =>
  `https://stats.bungie.net/Platform/Destiny2/Stats/PostGameCarnageReport/${id}/`;

/** The newest report id that exists: ids only grow, so binary-search the edge. */
async function newestPgcr(get: ReturnType<typeof bungieClient>["get"]) {
  let low = 10_000_000_000;
  let high = 40_000_000_000;
  while (high - low > 20_000) {
    const middle = Math.floor((low + high) / 2);
    if (await get<Pgcr>(pgcrUrl(middle))) low = middle;
    else high = middle;
  }
  // Reports can be missing here and there; step back to one that exists.
  for (let id = low; id > low - 500; id--) if (await get<Pgcr>(pgcrUrl(id))) return id;
  throw new Error("Couldn't find a recent post-game report.");
}

async function main() {
  loadEnvConfig(process.cwd());
  const options = readOptions();
  const apiKey = process.env.BUNGIE_CRAWLER_API_KEY || process.env.NEXT_PUBLIC_BUNGIE_API_KEY;
  if (!apiKey) throw new Error("Set BUNGIE_CRAWLER_API_KEY to crawl.");
  if (!process.env.BUNGIE_CRAWLER_API_KEY)
    console.warn("No BUNGIE_CRAWLER_API_KEY; using the app's key. Keep this run small.");

  const catalog = JSON.parse(await readFile(resolve(options.catalog), "utf8")) as PopularityCatalog;
  const lookup = popularityLookup(catalog);
  const client = bungieClient(apiKey, options.rate);
  const deadline = Date.now() + options.minutes * 60_000;

  console.log("Finding the newest post-game report…");
  const newest = await newestPgcr(client.get);
  console.log(`Walking back from report ${newest}.`);

  const tally: Record<string, WeaponPopularity> = {};
  const seen = new Set<string>();
  let nextId = newest;
  let reports = 0;
  let copies = 0;
  let from = "";
  let to = "";
  const done = () => seen.size >= options.players || Date.now() > deadline;

  async function samplePlayer(entry: PgcrEntry, mode: PopularityMode) {
    const user = entry.player?.destinyUserInfo;
    if (!user?.membershipId || seen.has(user.membershipId) || done()) return;
    seen.add(user.membershipId);
    const profile = await client.get<Profile>(
      `https://www.bungie.net/Platform/Destiny2/${user.membershipType}/Profile/${user.membershipId}/?components=205,305`,
    );
    const items = profile?.characterEquipment?.data?.[entry.characterId]?.items ?? [];
    const sockets = profile?.itemComponents?.sockets?.data ?? {};
    for (const item of items) {
      if (!WEAPON_BUCKETS.has(item.bucketHash) || !item.itemInstanceId) continue;
      const columns = lookup.get(item.itemHash);
      const plugs = sockets[item.itemInstanceId]?.sockets.map((s) => s.plugHash);
      if (!columns || !plugs) continue;
      addCopy(tally, item.itemHash, equippedPerks(columns, plugs), mode);
      copies++;
    }
  }

  async function worker() {
    while (!done()) {
      const id = nextId;
      nextId -= options.step;
      const report = await client.get<Pgcr>(pgcrUrl(id));
      if (!report) continue;
      reports++;
      if (!to || report.period > to) to = report.period;
      if (!from || report.period < from) from = report.period;
      const modes = report.activityDetails.modes ?? [report.activityDetails.mode];
      const mode: PopularityMode = modes.includes(ALL_PVP) ? "pvp" : "pve";
      for (const entry of report.entries) await samplePlayer(entry, mode);
    }
  }

  const progress = setInterval(() => {
    console.log(
      `${seen.size} players, ${copies} weapons, ${reports} reports, ${client.requests()} requests`,
    );
  }, 30_000);
  await Promise.all(Array.from({ length: options.workers }, worker));
  clearInterval(progress);

  if (copies === 0) throw new Error("No weapons were tallied; nothing written.");
  const snapshot: PerkPopularityIndex = {
    schema: 1,
    generatedAt: new Date().toISOString(),
    from,
    to,
    players: seen.size,
    weapons: tally,
  };
  const target = resolve(options.out);
  await writeFile(`${target}.tmp`, JSON.stringify(snapshot));
  await rename(`${target}.tmp`, target);
  console.log(
    `Wrote ${Object.keys(tally).length} weapons from ${copies} equipped copies (${seen.size} players, ${reports} reports, ${client.requests()} requests) to ${target}.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
