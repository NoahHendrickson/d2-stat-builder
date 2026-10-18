import { loadEnvConfig } from "@next/env";
import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { THROTTLE_CODES } from "../src/lib/bungie/throttle";
import {
  addCopy,
  columnSockets,
  perksAtSockets,
  popularityLookup,
  traitColumns,
  type CrawlFile,
  type CrawlSample,
  type PopularityCatalog,
  type WeaponPopularity,
} from "../src/lib/weapons/perk-popularity";

/**
 * Samples which perks players run on legendary weapons, from Bungie's public
 * API, and writes a perk-popularity snapshot (see src/lib/weapons/perk-popularity.ts).
 *
 * It samples post-game reports at random from one of two windows. With
 * --recent, the reports that ended in the last few minutes, the window moving
 * along with the crawl: a player's equipped weapons are read minutes after the
 * match, so they're still the ones they used (more copies per read, and the
 * right copy when they own two rolls of one weapon). Several short runs spread
 * over the day cover it. Otherwise, the --hours before `until`, which is now,
 * or with --day 06:00 UTC that day (so a missed day can be backfilled with
 * the 24 hours the old daily crawl would have had).
 * Report ids are handed out as activities end (consecutive ids ended within
 * minutes of each other, though they may have started hours apart), so it finds
 * the id range the window spans by each report's end time and picks ids
 * uniformly inside it, which spreads the sample over every hour however early
 * it stops; that search is only precise to a minute or so, so a report that
 * ended outside a fixed window is skipped. It skips PvP matches too (popularity is
 * PvE only), and for each player it hasn't seen reads the weapons the character in that report
 * has equipped, with their perks. Equipped items are public on every profile, so
 * no one signs in. A weapon only counts if the report lists it among the weapons
 * used in that match, so a PvE count is a weapon used in PvE, not whatever the
 * player went on to equip; a player who used none the tally covers (only
 * exotics, say) isn't read at all.
 * Each weapon's columns are read from their own sockets, learned from all its
 * copies at the end (see columnSockets). Nothing about a player is kept except
 * the tally. All requests share one rate limit, which slows down for good each
 * time Bungie throttles; only throttles, server errors and network failures
 * are retried.
 *
 *   tsx scripts/crawl-perk-popularity.ts --players=500 --out=public/dev-data/perk-popularity.json
 *
 * Options: --players (stop once this many profiles have been read, default 20000), --minutes (time
 * budget, default 300), --rate (requests per second to start at, default 20, or 8 on the app's key),
 * --workers (requests in flight, default 1.2 × --rate: a character read takes
 * about a second), --recent=<minutes> (sample the reports that ended in the last
 * this many minutes as the crawl goes, instead of a fixed window), --hours (how far back to
 * sample, default 24), --day (YYYY-MM-DD to backfill; needs --hours=24, and a day
 * the merge still keeps), --catalog (weapons.json path, default
 * public/data/weapons.json), --out (required).
 * The key comes from BUNGIE_CRAWLER_API_KEY, falling back to
 * NEXT_PUBLIC_BUNGIE_API_KEY for small local runs.
 */

const WEAPON_BUCKETS = new Set([1498876634, 2465295065, 953998645]);
/** DestinyActivityModeType.AllPvP: these reports are skipped, popularity is PvE only. */
const ALL_PVP = 5;
/**
 * Where a --day backfill's 24 hours end, UTC: the day's 06:00, when the data
 * repo's daily crawl used to start (it crawls every few hours now), so backfilled
 * days line up with the daily ones they sit beside.
 */
const BACKFILL_DAY_END_UTC = "06:00";
/** Days the data repo's merge keeps (merge-perk-popularity.ts --days); it prunes older days. */
const MERGE_DAYS = 7;

interface Options {
  players: number;
  minutes: number;
  rate: number;
  workers: number;
  /** Which reports to draw from (see the Sampler each one builds), as the crawl file records it. */
  sample: CrawlSample;
  catalog: string;
  out: string;
}

/**
 * The end of the sampled window: now, or with --day that day's 06:00 UTC. A
 * --day is checked here, before any request: a real date
 * (Date.parse rolls 2026-02-30 over to March 2 rather than failing), not still
 * ahead, a 24-hour window (so it lines up with its neighbours instead of
 * overlapping them), and a day the merge still keeps.
 */
function readUntil(day: string | undefined, hours: number) {
  if (day === undefined) return Date.now();
  const until = Date.parse(`${day}T${BACKFILL_DAY_END_UTC}:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(until) || !new Date(until).toISOString().startsWith(day))
    throw new Error(`--day must be a real date like 2026-10-15, not "${day}".`);
  if (until > Date.now()) throw new Error(`--day ${day} hasn't reached ${BACKFILL_DAY_END_UTC} UTC yet.`);
  if (hours !== 24)
    throw new Error("--day stands in for one day's crawl, so --hours must be 24; any other length overlaps the days beside it.");
  const oldestKept = new Date(Date.now() - (MERGE_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
  if (day < oldestKept)
    throw new Error(`--day ${day} is older than the ${MERGE_DAYS} days the merge keeps (${oldestKept} on), so it would be pruned straight away.`);
  return until;
}

/** `defaultRate` is the --rate when none is passed (see main). */
function readOptions(defaultRate: number): Options {
  // Strict: an unknown flag (a typo like --recnet) or one missing its value is an error, not a default crawl.
  const { values: args } = parseArgs({
    options: Object.fromEntries(
      ["players", "minutes", "rate", "workers", "recent", "hours", "day", "catalog", "out"].map((key) => [
        key,
        { type: "string" } as const,
      ]),
    ),
  });
  if (!args.out) throw new Error("Pass --out=<path> for the snapshot.");
  const number = (key: string, fallback?: number) => {
    const value = Number(args[key] ?? fallback);
    if (!Number.isFinite(value) || value <= 0) throw new Error(`--${key} must be a positive number.`);
    return value;
  };
  let sample: CrawlSample;
  if (args.recent !== undefined) {
    if (args.day !== undefined || args.hours !== undefined)
      throw new Error("--recent samples a moving window of its own; drop --hours and --day.");
    sample = { kind: "recent", minutes: number("recent") };
  } else {
    const hours = number("hours", 24);
    sample = { kind: "window", hours, until: new Date(readUntil(args.day, hours)).toISOString() };
  }
  const rate = number("rate", defaultRate);
  return {
    players: number("players", 20_000),
    minutes: number("minutes", 300),
    rate,
    // A character read takes about a second, so keep about a second's requests in flight.
    workers: number("workers", Math.ceil(rate * 1.2)),
    sample,
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


/** How much slower the rate gets for each throttle, and the slowest it goes (requests per second). */
const THROTTLE_SLOWDOWN = 0.8;
const SLOWEST_RATE = 2;
/** Throttles closer together than this are one burst (every request in flight hears it) and slow the rate once. */
const THROTTLE_BURST_MS = 5_000;

function bungieClient(apiKey: string, rate: number) {
  let spacing = 1000 / rate;
  let nextSlot = 0;
  let requests = 0;
  let throttles = 0;
  let slowedAt = 0;
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
      // Throttled, a 5xx, or no answer at all: wait as long as Bungie asks, at least a backoff.
      // A throttle also holds every worker back and slows the rate for the rest of the run.
      const wait = Math.max((body?.ThrottleSeconds ?? 0) * 1000, 1000 * 2 ** attempt);
      if (throttled) {
        throttles++;
        nextSlot = Date.now() + wait;
        if (Date.now() - slowedAt > THROTTLE_BURST_MS) {
          slowedAt = Date.now();
          // Never faster than it already is, even when --rate started below SLOWEST_RATE.
          spacing = Math.max(spacing, Math.min(spacing / THROTTLE_SLOWDOWN, 1000 / SLOWEST_RATE));
        }
      }
      await sleep(wait);
    }
    return undefined;
  }
  /**
   * `throttles` and the `rate` it ended at say whether --rate has room: no
   * throttles over a run means it does.
   */
  return {
    get,
    requests: () => requests,
    throttles: () => throttles,
    rate: () => Math.round((1000 / spacing) * 10) / 10,
  };
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
/**
 * One character's equipment and its sockets (GetCharacter, components 205,305):
 * about 13 KB, where the whole profile's is about 500 KB and no faster.
 */
interface Character {
  equipment?: {
    data?: { items: { itemHash: number; itemInstanceId?: string; bucketHash: number }[] };
  };
  itemComponents?: {
    sockets?: { data?: Record<string, { sockets: { plugHash?: number }[] }> };
  };
}

const pgcrUrl = (id: number) =>
  `https://stats.bungie.net/Platform/Destiny2/Stats/PostGameCarnageReport/${id}/`;

type Get = ReturnType<typeof bungieClient>["get"];

/**
 * Narrows [low, high] to within `tolerance` of the id where `before` turns
 * false (it holds for every id below that one and none above), and returns the
 * narrowed pair.
 */
async function bisect(low: number, high: number, tolerance: number, before: (id: number) => Promise<boolean>) {
  while (high - low > tolerance) {
    const middle = Math.floor((low + high) / 2);
    if (await before(middle)) low = middle;
    else high = middle;
  }
  return [low, high] as const;
}

const exists = (get: Get) => async (id: number) => (await get<Pgcr>(pgcrUrl(id))) !== undefined;

/** The newest report id that exists: ids only grow, so search for the edge roughly, then close in on it. */
async function newestPgcr(get: Get) {
  const [near] = await bisect(10_000_000_000, 40_000_000_000, 20_000, exists(get));
  // Reports can be missing here and there; step back to one that exists.
  for (let id = near; id > near - 500; id--) if (await get<Pgcr>(pgcrUrl(id))) return advanceNewest(get, id);
  throw new Error("Couldn't find a recent post-game report.");
}

/**
 * The newest report id now, from one that existed earlier (`from`): gallop
 * forward until an id is missing, then search back to within a few hundred ids
 * (a fraction of a minute). A missing id along the way only stops it short; the
 * next call carries on.
 */
async function advanceNewest(get: Get, from: number) {
  let low = from;
  let step = 1_000;
  while (await get<Pgcr>(pgcrUrl(low + step))) {
    low += step;
    step *= 2;
  }
  const [newest] = await bisect(low, low + step, 300, exists(get));
  return newest;
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
 * The first report id that ended at or after `since` (ms), searched from `low`:
 * ids grow with end time. Precise to `tolerance` ids; the default few thousand
 * is seconds of play at peak, enough for a day's edges.
 */
async function firstPgcrSince(get: Get, newest: number, since: number, low = 10_000_000_000, tolerance = 5_000) {
  const [, first] = await bisect(low, newest, tolerance, async (id) => {
    const ended = await endNear(get, id);
    return ended !== undefined && ended < since;
  });
  return first;
}

/** The report ids a crawl draws from, and which of the reports drawn it counts. */
interface Sampler {
  randomId(): number;
  /** Whether a report that ended at `ended` (ms) is this crawl's to count. */
  counts(ended: number): boolean;
  /** The ids drawn from now, for the log. */
  describe(): string;
  /** Why the crawl should end early (its window stopped following the clock), or undefined. */
  stalled(): string | undefined;
  /** Stops following the clock; resolves once a move in flight has finished. */
  stop(): Promise<void>;
}

/** An id in [low, high], uniformly. */
const between = ({ low, high }: { low: number; high: number }) => low + Math.floor(Math.random() * (high - low + 1));

/**
 * A fixed window: from the first report that ended at its start to the first
 * that ended at its end (newest when it ends now), the second search starting
 * from the first. Both are only precise to a few thousand ids, so a report
 * drawn that ended outside the window doesn't count.
 */
async function fixedWindow(get: Get, newest: number, window: { hours: number; until: string }): Promise<Sampler> {
  const until = Date.parse(window.until);
  const since = until - window.hours * 3_600_000;
  const low = await firstPgcrSince(get, newest, since);
  const ids = { low, high: await firstPgcrSince(get, newest, until, low) };
  const range = `${ids.low}–${ids.high} (ended ${new Date(since).toISOString()} to ${new Date(until).toISOString()})`;
  return {
    randomId: () => between(ids),
    counts: (ended) => ended >= since && ended < until,
    describe: () => range,
    stalled: () => undefined,
    stop: async () => {},
  };
}

/**
 * The reports that ended in the last `minutes`, moving along with the clock:
 * about once a minute the newest id and the first that ended `minutes` ago are
 * searched again from where they were (a dozen requests). Both edges are found
 * to within a few hundred ids, so even a short window off-peak keeps its width.
 * A report drawn counts if it ended after the window's start as of its last
 * move, give or take the edge search's slack. If the window stops moving
 * (every move failing for STALL_MS), the crawl ends early instead of drawing
 * from a range that is no longer recent.
 */
/**
 * How far before a moving window's start a counted report may have ended: the
 * low edge is searched to 300 ids, which is seconds at peak and a minute or so
 * when quiet.
 */
const EDGE_SLACK_MS = 2 * 60_000;
/** A moving window whose moves have all failed for this long ends the crawl. */
const STALL_MS = 10 * 60_000;

async function movingWindow(get: Get, newest: number, minutes: number): Promise<Sampler> {
  /** The window's low edge (ms) as of its last move, and when that move finished. */
  let since = Date.now() - minutes * 60_000;
  let movedAt = Date.now();
  const firstRecent = (high: number, start: number, low?: number) => firstPgcrSince(get, high, start, low, 300);
  const ids = { low: await firstRecent(newest, since), high: newest };
  let moving: Promise<void> | undefined;
  const timer = setInterval(() => {
    moving ??= (async () => {
      // The start is fixed before the searches, which can take minutes once throttled.
      const start = Date.now() - minutes * 60_000;
      const high = await advanceNewest(get, ids.high);
      Object.assign(ids, { low: await firstRecent(high, start, ids.low), high });
      since = start;
      movedAt = Date.now();
    })()
      .catch((error: unknown) =>
        console.warn(`Couldn't move the window along: ${error instanceof Error ? error.message : error}`),
      )
      .finally(() => {
        moving = undefined;
      });
  }, 60_000);
  return {
    randomId: () => between(ids),
    counts: (ended) => ended >= since - EDGE_SLACK_MS,
    describe: () => `${ids.low}–${ids.high} (the last ${minutes} minutes)`,
    stalled: () =>
      Date.now() - movedAt > STALL_MS
        ? `the window hasn't moved since ${new Date(movedAt).toISOString()}`
        : undefined,
    async stop() {
      clearInterval(timer);
      await moving;
    },
  };
}

async function main() {
  loadEnvConfig(process.cwd());
  const apiKey = process.env.BUNGIE_CRAWLER_API_KEY || process.env.NEXT_PUBLIC_BUNGIE_API_KEY;
  if (!apiKey) throw new Error("Set BUNGIE_CRAWLER_API_KEY to crawl.");
  const appKey = !process.env.BUNGIE_CRAWLER_API_KEY;
  if (appKey) console.warn("No BUNGIE_CRAWLER_API_KEY; using the app's key. Keep this run small.");
  // The app's key is the one d2conflux.com users share, so a throttle on it would hit them:
  // default to the old 8/s there, and leave 20/s to the crawler key.
  const options = readOptions(appKey ? 8 : 20);

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
  const { sample } = options;
  const sampler =
    sample.kind === "recent"
      ? await movingWindow(client.get, newest, sample.minutes)
      : await fixedWindow(client.get, newest, sample);
  console.log(`Sampling reports ${sampler.describe()} at random.`);

  // Each weapon's copies (plugs by socket), tallied once every copy is in.
  const copiesByWeapon = new Map<number, (number | undefined)[][]>();
  // Players tried, so none is read twice; `players` is how many answered, which
  // is what --players caps and the snapshot reports. Reads still in flight
  // count towards the cap, so it isn't overshot by one per worker.
  const seen = new Set<string>();
  let players = 0;
  let reading = 0;
  let reports = 0;
  /** Reports drawn that the sampler didn't count (see Sampler.counts). */
  let outside = 0;
  let copies = 0;
  // When the earliest and latest reports counted ended (ms).
  let first = Infinity;
  let last = -Infinity;
  const done = () =>
    players + reading >= options.players || Date.now() > deadline || sampler.stalled() !== undefined;

  async function samplePlayer(entry: PgcrEntry) {
    const user = entry.player?.destinyUserInfo;
    // The weapons they used that the tally covers. None (only exotics, or no
    // weapon kills at all): reading their weapons couldn't add a copy, so don't
    // spend a request on it. A quarter of the players with weapon kills.
    const counted = new Set(
      entry.extended?.weapons?.map((w) => w.referenceId).filter((hash) => lookup.has(hash)),
    );
    if (!user?.membershipId || counted.size === 0 || seen.has(user.membershipId) || done()) return;
    seen.add(user.membershipId);
    reading++;
    const character = await client.get<Character>(
      `https://www.bungie.net/Platform/Destiny2/${user.membershipType}/Profile/${user.membershipId}/Character/${entry.characterId}/?components=205,305`,
    );
    reading--;
    if (!character) return;
    players++;
    const items = character.equipment?.data?.items ?? [];
    const sockets = character.itemComponents?.sockets?.data ?? {};
    for (const item of items) {
      if (!WEAPON_BUCKETS.has(item.bucketHash) || !item.itemInstanceId || !counted.has(item.itemHash)) continue;
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
      const report = await client.get<Pgcr>(pgcrUrl(sampler.randomId()));
      if (!report) continue;
      // Ended outside a fixed window by the id search's slack, too long ago for a
      // moving one, or can't be placed at all: not this crawl's to count.
      const ended = endedAt(report);
      if (ended === undefined || !sampler.counts(ended)) {
        outside++;
        continue;
      }
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
      `${players} players, ${copies} weapons, ${reports} reports (${outside} outside the window), ${client.requests()} requests, ${client.throttles()} throttles (${client.rate()}/s), sampling ${sampler.describe()}`,
    );
  }, 30_000);
  await Promise.all(Array.from({ length: options.workers }, worker));
  clearInterval(progress);
  await sampler.stop();
  const stalled = sampler.stalled();
  if (stalled) console.warn(`Ended early: ${stalled}.`);

  if (copies === 0) throw new Error("No weapons were tallied; nothing written.");
  const tally: Record<string, WeaponPopularity> = {};
  for (const [hash, list] of copiesByWeapon) {
    const columns = lookup.get(hash)!;
    const placed = columnSockets(columns, list);
    const traits = traitsByWeapon.get(hash);
    for (const plugs of list) addCopy(tally, hash, perksAtSockets(columns, placed, plugs), traits);
  }
  const snapshot: CrawlFile = {
    schema: 2,
    generatedAt: new Date().toISOString(),
    // Copies were tallied, so at least one report was counted.
    from: isoSeconds(first),
    to: isoSeconds(last),
    sample,
    players,
    weapons: tally,
  };
  const target = resolve(options.out);
  await writeFile(`${target}.tmp`, JSON.stringify(snapshot));
  await rename(`${target}.tmp`, target);
  console.log(
    `Wrote ${Object.keys(tally).length} weapons from ${copies} equipped copies (${players} players, ${reports} reports (${outside} outside the window), ${client.requests()} requests, ${client.throttles()} throttles, ending at ${client.rate()}/s) to ${target}.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
