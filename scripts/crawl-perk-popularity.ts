import { loadEnvConfig } from "@next/env";
import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { THROTTLE_CODES } from "../src/lib/bungie/throttle";
import {
  addCopy,
  columnSockets,
  perksAtSockets,
  popularityLookup,
  traitColumns,
  type PerkPopularityIndex,
  type PopularityCatalog,
  type WeaponPopularity,
} from "../src/lib/weapons/perk-popularity";

/**
 * Samples which perks players run on legendary weapons, from Bungie's public
 * API, and writes a perk-popularity snapshot (see src/lib/weapons/perk-popularity.ts).
 *
 * It samples post-game reports at random from one window: the --hours before
 * `until`, which is now, or with --day the start of that day's scheduled crawl
 * (so a missed day can be backfilled with exactly the window it would have had).
 * Report ids are handed out as activities end (consecutive ids ended within
 * minutes of each other, though they may have started hours apart), so it finds
 * the id range the window spans by each report's end time and picks ids
 * uniformly inside it, which spreads the sample over every hour however early
 * it stops; that search is only precise to a minute or so, so a report that
 * ended outside the window is skipped. It skips PvP matches too (popularity is
 * PvE only), and for each player it hasn't seen reads the weapons the character in that report
 * has equipped, with their perks. Equipped items are public on every profile, so
 * no one signs in. A weapon only counts if the report lists it among the weapons
 * used in that match, so a PvE count is a weapon used in PvE, not whatever the
 * player went on to equip.
 * Each weapon's columns are read from their own sockets, learned from all its
 * copies at the end (see columnSockets). Nothing about a player is kept except
 * the tally. All requests share one rate limit; only throttles, server errors
 * and network failures are retried.
 *
 *   tsx scripts/crawl-perk-popularity.ts --players=500 --out=public/dev-data/perk-popularity.json
 *
 * Options: --players (stop once this many profiles have been read, default 20000), --minutes (time
 * budget, default 300), --rate (requests per second, default 8), --workers
 * (default 6), --hours (how far back to sample, default 24), --day (YYYY-MM-DD to
 * backfill; needs --hours=24, and a day the merge still keeps), --catalog
 * (weapons.json path, default public/data/weapons.json), --out (required).
 * The key comes from BUNGIE_CRAWLER_API_KEY, falling back to
 * NEXT_PUBLIC_BUNGIE_API_KEY for small local runs.
 */

const WEAPON_BUCKETS = new Set([1498876634, 2465295065, 953998645]);
/** DestinyActivityModeType.AllPvP: these reports are skipped, popularity is PvE only. */
const ALL_PVP = 5;
/** When the data repo's scheduled crawl starts each day, UTC (its workflow cron, "0 6 * * *"). */
const SCHEDULED_CRAWL_UTC = "06:00";
/** Days the data repo's merge keeps (merge-perk-popularity.ts --days); it prunes older days. */
const MERGE_DAYS = 7;

interface Options {
  players: number;
  minutes: number;
  rate: number;
  workers: number;
  hours: number;
  /** When the sampled window ends (ms): now, or the start of --day's scheduled crawl. */
  until: number;
  catalog: string;
  out: string;
}

/**
 * The end of the sampled window: now, or with --day the start of that day's
 * scheduled crawl. A --day is checked here, before any request: a real date
 * (Date.parse rolls 2026-02-30 over to March 2 rather than failing), not still
 * ahead, a 24-hour window (so it lines up with its neighbours instead of
 * overlapping them), and a day the merge still keeps.
 */
function readUntil(day: string | undefined, hours: number) {
  if (!day) return Date.now();
  const until = Date.parse(`${day}T${SCHEDULED_CRAWL_UTC}:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(until) || !new Date(until).toISOString().startsWith(day))
    throw new Error(`--day must be a real date like 2026-10-15, not "${day}".`);
  if (until > Date.now()) throw new Error(`--day ${day} hasn't reached ${SCHEDULED_CRAWL_UTC} UTC yet.`);
  if (hours !== 24)
    throw new Error("--day stands in for one scheduled crawl, so --hours must be 24; any other length overlaps the days beside it.");
  const oldestKept = new Date(Date.now() - (MERGE_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
  if (day < oldestKept)
    throw new Error(`--day ${day} is older than the ${MERGE_DAYS} days the merge keeps (${oldestKept} on), so it would be pruned straight away.`);
  return until;
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
    hours: number("hours", 24),
    until: readUntil(args.day, number("hours", 24)),
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


function bungieClient(apiKey: string, rate: number) {
  const spacing = 1000 / rate;
  let nextSlot = 0;
  let requests = 0;
  let throttles = 0;
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
      if (body?.ErrorCode === 5) throw new Error("Bungie's API is down for maintenance.");
      if (body?.ErrorCode === 2101 || body?.ErrorCode === 2102)
        throw new Error(`The API key was rejected (${body.ErrorStatus}).`);
      const throttled = status === 429 || (body !== undefined && THROTTLE_CODES.has(body.ErrorCode));
      // Any other answer (not found, private, bad parameters, …) won't change on retry.
      if (body && !throttled && status < 500) return undefined;
      // Throttled, a 5xx, or no answer at all: wait as long as Bungie asks, at least a backoff,
      // and hold every worker back for a throttle.
      const wait = Math.max((body?.ThrottleSeconds ?? 0) * 1000, 1000 * 2 ** attempt);
      if (throttled) {
        throttles++;
        nextSlot = Date.now() + wait;
      }
      await sleep(wait);
    }
    return undefined;
  }
  /** `throttles` says whether --rate has room: none over a run means it does. */
  return { get, requests: () => requests, throttles: () => throttles };
}

interface PgcrEntry {
  characterId: string;
  player?: { destinyUserInfo?: { membershipType: number; membershipId: string } };
  /** The activity's length in seconds (the same on every entry). */
  values?: { activityDurationSeconds?: { basic?: { value?: number } } };
  /** The weapons this player used in the match (got kills with). */
  extended?: { weapons?: { referenceId: number }[] };
}
interface Pgcr {
  /** When the activity started. */
  period: string;
  activityDetails: { mode: number; modes?: number[] };
  entries: PgcrEntry[];
}

/**
 * When the activity ended (ms): its start plus its length. Report ids follow
 * this, not the start (a raid that ran for hours sits among the reports of the
 * minute it ended), so every window is measured by it. A report without a
 * length can't be placed, so it's undefined rather than its start, which could
 * be hours early.
 */
function endedAt(report: Pgcr) {
  const seconds = report.entries[0]?.values?.activityDurationSeconds?.basic?.value;
  return seconds === undefined ? undefined : Date.parse(report.period) + seconds * 1000;
}

/** An instant as Bungie writes its `period`: whole seconds, "2026-10-18T06:00:00Z". */
const isoSeconds = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");
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
type Get = ReturnType<typeof bungieClient>["get"];

async function newestPgcr(get: Get) {
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

/** When the report at or just after `id` ended (a few ids can be missing, or have no length). */
async function endNear(get: Get, id: number) {
  for (let near = id; near < id + 50; near++) {
    const report = await get<Pgcr>(pgcrUrl(near));
    const ended = report && endedAt(report);
    if (ended !== undefined) return ended;
  }
  return undefined;
}

/**
 * The first report id that ended at or after `since` (ms): ids grow with end
 * time, so binary-search on it. Precise to a few thousand ids, which is seconds
 * of play.
 */
async function firstPgcrSince(get: Get, newest: number, since: number, low = 10_000_000_000) {
  let high = newest;
  while (high - low > 5_000) {
    const middle = Math.floor((low + high) / 2);
    const ended = await endNear(get, middle);
    if (ended !== undefined && ended < since) low = middle;
    else high = middle;
  }
  return high;
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
  // Each weapon's left and right trait columns, for its combos.
  const traitsByWeapon = new Map(
    catalog.weapons.flatMap((w) => {
      const traits = traitColumns(w.columns);
      return traits ? [[w.hash, traits] as const] : [];
    }),
  );
  const client = bungieClient(apiKey, options.rate);
  const deadline = Date.now() + options.minutes * 60_000;

  console.log("Finding the newest post-game report…");
  const newest = await newestPgcr(client.get);
  // The window's ids: from the first report that ended at its start to the
  // first that ended at its end (newest when it ends now), the second search
  // starting from the first. Both are only precise to a few thousand ids; the
  // worker drops reports that ended outside the window.
  const since = options.until - options.hours * 3_600_000;
  const oldest = await firstPgcrSince(client.get, newest, since);
  const end = await firstPgcrSince(client.get, newest, options.until, oldest);
  if (end < oldest) throw new Error("The window is too short to hold any reports.");
  console.log(
    `Sampling reports ${oldest}–${end} (ended ${new Date(since).toISOString()} to ${new Date(options.until).toISOString()}) at random.`,
  );
  const randomId = () => oldest + Math.floor(Math.random() * (end - oldest + 1));

  // Each weapon's copies (plugs by socket), tallied once every copy is in.
  const copiesByWeapon = new Map<number, (number | undefined)[][]>();
  // Players tried, so none is read twice; `players` is how many answered, which
  // is what --players caps and the snapshot reports. Reads still in flight
  // count towards the cap, so it isn't overshot by one per worker.
  const seen = new Set<string>();
  let players = 0;
  let reading = 0;
  let reports = 0;
  let copies = 0;
  // When the earliest and latest reports counted ended (ms).
  let first = Infinity;
  let last = -Infinity;
  const done = () => players + reading >= options.players || Date.now() > deadline;

  async function samplePlayer(entry: PgcrEntry) {
    const user = entry.player?.destinyUserInfo;
    const used = new Set(entry.extended?.weapons?.map((w) => w.referenceId));
    if (!user?.membershipId || used.size === 0 || seen.has(user.membershipId) || done()) return;
    seen.add(user.membershipId);
    reading++;
    const profile = await client.get<Profile>(
      `https://www.bungie.net/Platform/Destiny2/${user.membershipType}/Profile/${user.membershipId}/?components=205,305`,
    );
    reading--;
    if (!profile) return;
    players++;
    const items = profile.characterEquipment?.data?.[entry.characterId]?.items ?? [];
    const sockets = profile.itemComponents?.sockets?.data ?? {};
    for (const item of items) {
      if (!WEAPON_BUCKETS.has(item.bucketHash) || !item.itemInstanceId) continue;
      if (!used.has(item.itemHash) || !lookup.has(item.itemHash)) continue;
      const plugs = sockets[item.itemInstanceId]?.sockets.map((s) => s.plugHash);
      if (!plugs) continue;
      const list = copiesByWeapon.get(item.itemHash) ?? [];
      list.push(plugs);
      copiesByWeapon.set(item.itemHash, list);
      copies++;
    }
  }

  async function worker() {
    while (!done()) {
      const report = await client.get<Pgcr>(pgcrUrl(randomId()));
      if (!report) continue;
      // Ended outside the window, by the id search's slack (or can't be placed
      // at all): not this crawl's to count.
      const ended = endedAt(report);
      if (ended === undefined || ended < since || ended >= options.until) continue;
      // PvE only: a PvP match is passed over entirely (not counted, its players not sampled).
      const modes = report.activityDetails.modes ?? [report.activityDetails.mode];
      if (modes.includes(ALL_PVP)) continue;
      reports++;
      first = Math.min(first, ended);
      last = Math.max(last, ended);
      for (const entry of report.entries) await samplePlayer(entry);
    }
  }

  const progress = setInterval(() => {
    console.log(
      `${players} players, ${copies} weapons, ${reports} reports, ${client.requests()} requests, ${client.throttles()} throttles`,
    );
  }, 30_000);
  await Promise.all(Array.from({ length: options.workers }, worker));
  clearInterval(progress);

  if (copies === 0) throw new Error("No weapons were tallied; nothing written.");
  const tally: Record<string, WeaponPopularity> = {};
  for (const [hash, list] of copiesByWeapon) {
    const columns = lookup.get(hash)!;
    const placed = columnSockets(columns, list);
    const traits = traitsByWeapon.get(hash);
    for (const plugs of list) addCopy(tally, hash, perksAtSockets(columns, placed, plugs), traits);
  }
  const snapshot: PerkPopularityIndex = {
    schema: 2,
    generatedAt: new Date().toISOString(),
    // Copies were tallied, so at least one report was counted.
    from: isoSeconds(first),
    to: isoSeconds(last),
    players,
    weapons: tally,
  };
  const target = resolve(options.out);
  await writeFile(`${target}.tmp`, JSON.stringify(snapshot));
  await rename(`${target}.tmp`, target);
  console.log(
    `Wrote ${Object.keys(tally).length} weapons from ${copies} equipped copies (${players} players, ${reports} reports, ${client.requests()} requests, ${client.throttles()} throttles) to ${target}.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
