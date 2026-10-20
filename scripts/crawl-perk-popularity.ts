import { loadEnvConfig } from "@next/env";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import type { ArmorReport, ArmorReportEntry } from "../src/lib/armory/set-popularity-reads";
import { THROTTLE_CODES } from "../src/lib/bungie/throttle";
import { popularityLookup, type CrawlSample, type PopularityCatalog } from "../src/lib/weapons/perk-popularity";
import { allocOwners, lookupFingerprint, recheckPlan, storeDay } from "../src/lib/weapons/popularity-copies";
import { profileCopies, readCollector, type ProfileRead } from "../src/lib/weapons/popularity-reads";
import { createArmorTally } from "./armor-tally";
import { decodeOwners, encodeCopies } from "./copy-store-file";
import { storeKey } from "./sealed-file";
import { writeFileAtomic } from "./write-file-atomic";

/**
 * Finds players through Bungie's public API and records the perks on every
 * legendary weapon of theirs it can see, each copy once by its instance id,
 * as a copy store (see src/lib/weapons/popularity-copies.ts). The merge
 * (merge-perk-popularity.ts) folds each crawl into the running store and
 * tallies it into the snapshot the weapon page reads.
 *
 * Players come from post-game reports sampled at random from one of two
 * windows. With --recent, the reports that ended in the last few minutes, the
 * window moving along with the crawl, so the players found are active now.
 * Otherwise, the --hours up to now.
 * Report ids are handed out as activities end (consecutive ids ended within
 * minutes of each other, though they may have started hours apart), so it finds
 * the id range the window spans by each report's end time and picks ids
 * uniformly inside it, which spreads the sample over every hour however early
 * it stops; that search is only precise to a minute or so, so a report that
 * ended outside a fixed window is skipped. PvP matches are skipped too:
 * players are found through PvE.
 * For each player it hasn't seen, one profile read gives when they last
 * played and the weapons equipped on every character, which are public on
 * every profile, so no one signs in, plus the vault and character inventories
 * for the few (about 4%) who have made them public; private ones cost nothing
 * extra. Given the running store (--store), it also reads again the players
 * in it it hasn't read for RECHECK_AFTER_DAYS, the longest unread first, with
 * up to half its reads (recheckPlan): that keeps their copies, and when they last played,
 * current, so the merge can keep a player's copies for as long as they play.
 * Players in the store read more recently are passed over when found again.
 * Each weapon's columns are read from their own sockets, learned from all its
 * copies at the end (see columnSockets). The crawl's file lists the players it
 * read, so it's encrypted like the store (scripts/copy-store-file.ts). All
 * requests share one rate limit, which slows down for good each time Bungie
 * throttles; only throttles, server errors and network failures are retried.
 *
 *   tsx scripts/crawl-perk-popularity.ts --players=500 --store=store.bin --out=crawl.bin
 *
 * With --armor-out it also tallies the armor sets players wear in endgame
 * activities (scripts/armor-tally.ts): its reads of players found in reports
 * add their current activity, and the players found but not read (read
 * recently, or already this crawl) get a small read for the tally alone.
 * The armor crawl goes to its own file, for merge-armor-set-popularity.ts.
 *
 * Options: --players (stop once this many profiles have been read, default 20000), --minutes (time
 * budget, default 300), --rate (requests per second to start at, default 20, or 8 on the app's key),
 * --workers (workers, and requests in flight at most, default 1.2 × --rate: a profile read takes
 * about a second), --recent=<minutes> (sample the reports that ended in the last
 * this many minutes as the crawl goes, instead of a fixed window), --hours (how far back to
 * sample, default 24), --armor-out (the armor crawl's file; without it, no armor tally), --catalog (weapons.json path, default
 * public/data/weapons.json), --store (the running copy store, for the players to
 * read again; without it every player found is new), --out (required).
 * The key comes from BUNGIE_CRAWLER_API_KEY, falling back to
 * NEXT_PUBLIC_BUNGIE_API_KEY for small local runs; the files' key from
 * POPULARITY_STORE_KEY.
 */

/** DestinyActivityModeType.AllPvP: these reports are skipped, players are found through PvE. */
const ALL_PVP = 5;
/**
 * Profile components: 100 profile (when they last played), 102 vault, 201
 * character inventories (both empty unless the player made them public), 205
 * every character's equipment, 305 sockets.
 */
const PROFILE_COMPONENTS = "100,102,201,205,305";
/** How long after reading a player the crawl reads them again. */
const RECHECK_AFTER_DAYS = 7;

interface Options {
  players: number;
  minutes: number;
  rate: number;
  workers: number;
  /** Which reports to draw from (see the Sampler each one builds), as the crawl file records it. */
  sample: Exclude<CrawlSample, { kind: "signed-in" }>;
  catalog: string;
  store?: string;
  out: string;
  armorOut?: string;
}

/** `defaultRate` is the --rate when none is passed (see main). */
function readOptions(defaultRate: number): Options {
  // Strict: an unknown flag (a typo like --recnet) or one missing its value is an error, not a default crawl.
  const { values: args } = parseArgs({
    options: Object.fromEntries(
      ["players", "minutes", "rate", "workers", "recent", "hours", "catalog", "store", "out", "armor-out"].map((key) => [
        key,
        { type: "string" } as const,
      ]),
    ),
  });
  if (!args.out) throw new Error("Pass --out=<path> for the crawl's copies.");
  const number = (key: string, fallback?: number) => {
    const value = Number(args[key] ?? fallback);
    if (!Number.isFinite(value) || value <= 0) throw new Error(`--${key} must be a positive number.`);
    return value;
  };
  let sample: Options["sample"];
  if (args.recent !== undefined) {
    if (args.hours !== undefined) throw new Error("--recent samples a moving window of its own; drop --hours.");
    sample = { kind: "recent", minutes: number("recent") };
  } else {
    sample = { kind: "window", hours: number("hours", 24), until: new Date().toISOString() };
  }
  const rate = number("rate", defaultRate);
  return {
    players: number("players", 20_000),
    minutes: number("minutes", 300),
    rate,
    // A profile read takes about a second, so keep about a second's requests in flight.
    workers: number("workers", Math.ceil(rate * 1.2)),
    sample,
    catalog: args.catalog || "public/data/weapons.json",
    store: args.store,
    out: args.out,
    armorOut: args["armor-out"],
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

/** How long a request may take, a whole profile with a public vault included, before it is retried. */
const REQUEST_TIMEOUT_MS = 30_000;
/** How much slower the rate gets for each throttle, and the slowest it goes (requests per second). */
const THROTTLE_SLOWDOWN = 0.8;
const SLOWEST_RATE = 2;
/** Throttles closer together than this are one burst (every request in flight hears it) and slow the rate once. */
const THROTTLE_BURST_MS = 5_000;

/**
 * Bungie's API under one rate limit and at most `maxInFlight` requests at once
 * (--workers). The cap is what has kept the crawl unthrottled: reads take a
 * second or two, so --workers of them in flight run well under --rate. A
 * report's players are read at once (see samplePlayer's caller), so without
 * it the crawl would climb to --rate and be throttled.
 */
function bungieClient(apiKey: string, rate: number, maxInFlight: number) {
  let spacing = 1000 / rate;
  let inFlight = 0;
  /** Requests waiting for one in flight to finish, first come first served. */
  const queue: (() => void)[] = [];
  const acquire = () =>
    inFlight < maxInFlight ? (inFlight++, Promise.resolve()) : new Promise<void>((go) => queue.push(go));
  // A finished request hands its place straight to the next waiting, if any.
  const release = () => (queue.length > 0 ? queue.shift()!() : inFlight--);
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
      await acquire();
      let body: BungieResponse<T> | undefined;
      let status = 0;
      try {
        await slot();
        requests++;
        // A read can hang for minutes, holding a worker and, near the end, the whole crawl.
        const response = await fetch(url, { headers: { "X-API-Key": apiKey }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
        status = response.status;
        body = (await response.json().catch(() => undefined)) as BungieResponse<T> | undefined;
      } catch {
        // Network blip or timeout: back off and retry.
      } finally {
        release();
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

/** A post-game report's entry, with what the armor tally reads of it. */
type PgcrEntry = ArmorReportEntry & {
  /** The activity's length in seconds (the same on every entry). */
  values?: { activityDurationSeconds?: { basic?: { value?: number } } };
};
interface Pgcr extends ArmorReport {
  /** When the activity started. */
  period: string;
  activityDetails: ArmorReport["activityDetails"] & { mode: number; modes?: number[] };
  entries: PgcrEntry[];
}

/**
 * When the activity ended (ms): its start plus its length. Report ids follow
 * this, not the start (a raid that ran for hours sits among the reports of the
 * minute it ended), so every window is measured by it. A report without a
 * length can't be placed, so it's undefined rather than its start, which could
 * be hours early. Now and then a report's start or length puts its end hours
 * ahead of the clock; it can't have ended later than now, which is what a
 * report that far along the ids says anyway, so that's where it's put, and
 * nothing downstream (the window, the crawl's span, when a player last played)
 * sees a time that hasn't come.
 */
function endedAt(report: Pgcr) {
  const seconds = report.entries[0]?.values?.activityDurationSeconds?.basic?.value;
  return seconds === undefined ? undefined : Math.min(Date.parse(report.period) + seconds * 1000, Date.now());
}

/** An instant as Bungie writes its `period`: whole seconds, "2026-10-18T06:00:00Z". */
const isoSeconds = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");
/**
 * A profile read with PROFILE_COMPONENTS: 200–800 KB, and no slower than one
 * character's 13 KB. A private vault or inventory comes back as just its
 * privacy setting, no `data`.
 */
interface Profile extends ProfileRead {
  profile?: { data?: { dateLastPlayed?: string } };
  /** With the armor tally (204). */
  characterActivities?: { data?: Record<string, { currentActivityHash?: number }> };
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

  const key = storeKey();
  const catalog = JSON.parse(await readFile(resolve(options.catalog), "utf8")) as PopularityCatalog;
  const lookup = popularityLookup(catalog);
  const today = storeDay();
  // Who to read again, and who was read too recently to read now: the store's players are all it needs.
  const plan = recheckPlan(
    options.store ? decodeOwners(await readFile(resolve(options.store)), key) : allocOwners(0),
    today,
    RECHECK_AFTER_DAYS,
  );
  if (options.store) console.log(`The store has ${plan.players} players; ${plan.remaining()} are due to be read again.`);
  const client = bungieClient(apiKey, options.rate, options.workers);
  // The armor tally rides along: if it can't start (the manifest won't load), the weapons crawl without it.
  const armor = options.armorOut
    ? await createArmorTally(apiKey).catch((error: unknown) => {
        console.warn(`No armor tally this crawl: ${error instanceof Error ? error.message : error}`);
        return undefined;
      })
    : undefined;
  const components = armor ? `${PROFILE_COMPONENTS},${armor.components}` : PROFILE_COMPONENTS;
  const deadline = Date.now() + options.minutes * 60_000;

  console.log("Finding the newest post-game report…");
  const newest = await newestPgcr(client.get);
  const { sample } = options;
  const sampler =
    sample.kind === "recent"
      ? await movingWindow(client.get, newest, sample.minutes)
      : await fixedWindow(client.get, newest, sample);
  console.log(`Sampling reports ${sampler.describe()} at random.`);

  // The players read and their copies (see readCollector).
  const collected = readCollector(lookup);
  // Players tried, so none is read twice; `players` is how many answered, which
  // is what --players caps and the crawl records. Reads still in flight
  // count towards the cap, so it isn't overshot by one per worker.
  const seen = new Set<string>();
  let players = 0;
  /** Reads started, and how many of them were of players in the store: the plan's half is of these. */
  let started = 0;
  let rereads = 0;
  /** Players in the store whose read again answered. */
  let rechecked = 0;
  /** Players found in a report but read too recently to read again. */
  let fresh = 0;
  /** Players read whole (see CrawlSource.vaults). */
  let vaults = 0;
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

  /**
   * Reads one player's profile and records them and their copies: `known` when
   * they're in the store, `foundOn` the day of the report a new player was
   * found in, for when the profile doesn't say when they last played.
   */
  async function readPlayer(type: number, id: string, known: boolean, foundOn?: number): Promise<Profile | undefined> {
    seen.add(id);
    started++;
    if (known) {
      rereads++;
      plan.read(id);
    }
    reading++;
    const profile = await client.get<Profile>(
      `https://www.bungie.net/Platform/Destiny2/${type}/Profile/${id}/?components=${components}`,
    );
    reading--;
    if (!profile) {
      // A player in the store who won't read (account gone, moved platform): count
      // it as a read, of nothing, so they wait a week like the rest instead of
      // heading the queue every crawl until they're pruned. When they played stays.
      if (known) collected.add({ id: BigInt(id), type, played: undefined }, [], false, true);
      return undefined;
    }
    players++;
    if (known) rechecked++;
    // Every bucket, the vault's included, for the tally's weapons only (the lookup's).
    const read = profileCopies(profile, ({ itemHash }) => lookup.has(itemHash));
    // A profile that doesn't say when they last played: a known player keeps
    // what the store knew, a new one goes by the report they were found in.
    const lastPlayed = Date.parse(profile.profile?.data?.dateLastPlayed ?? "");
    const played = Number.isNaN(lastPlayed) ? (known ? undefined : foundOn) : storeDay(lastPlayed);
    const { found, whole } = collected.add({ id: BigInt(id), type, played }, read.copies, read.sawAll, known);
    copies += found;
    if (whole) vaults++;
    return profile;
  }

  /** `ended`: when the report's activity did (ms). */
  async function samplePlayer(entry: PgcrEntry, report: Pgcr, ended: number) {
    const user = entry.player?.destinyUserInfo;
    if (!user?.membershipId || done()) return;
    // Read already this crawl (from another report, or again from the store):
    // no copies to add, but the armor tally wants what they wear now.
    if (seen.has(user.membershipId)) return armor?.readAlone(client.get, report, entry, ended);
    const endedOn = storeDay(ended);
    if (plan.recentlyRead(user.membershipId)) {
      // Not worth a read yet, but the report proves they played: that keeps
      // them in the store even if their next read is a while coming.
      fresh++;
      seen.add(user.membershipId);
      collected.sight({ id: BigInt(user.membershipId), type: user.membershipType, played: endedOn });
      return armor?.readAlone(client.get, report, entry, ended);
    }
    const profile = await readPlayer(user.membershipType, user.membershipId, plan.known(user.membershipId), endedOn);
    if (profile) armor?.judge(profile, report, entry, ended, Date.now());
  }

  async function worker() {
    while (!done()) {
      const due = plan.next(started, rereads);
      if (due) {
        if (!seen.has(due.id)) await readPlayer(due.type, due.id, true);
        continue;
      }
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
      // All at once: the armor tally's orbit reads must land within minutes of the activity's end.
      await Promise.all(report.entries.map((entry) => samplePlayer(entry, report, ended)));
    }
  }

  const summary = () =>
    `${players} players (${rechecked} read again, ${fresh} passed over as read recently, ${vaults} read whole), ${copies} copies, ${reports} reports (${outside} outside the window), ${client.requests()} requests, ${client.throttles()} throttles, ${plan.remaining()} still due${armor ? `; ${armor.summary()}` : ""}`;
  const progress = setInterval(() => {
    console.log(`${summary()} (${client.rate()}/s), sampling ${sampler.describe()}`);
  }, 30_000);
  await Promise.all(Array.from({ length: options.workers }, worker));
  clearInterval(progress);
  await sampler.stop();
  const stalled = sampler.stalled();
  if (stalled) console.warn(`Ended early: ${stalled}.`);

  if (collected.players() === 0) throw new Error("No players were read; nothing written.");
  const target = resolve(options.out);
  const generatedAt = new Date().toISOString();
  const now = Date.parse(generatedAt);
  const crawl = collected.store(now, {
    generatedAt,
    // With no report counted (every read a read again), the span is just this crawl's moment.
    from: isoSeconds(Number.isFinite(first) ? first : now),
    to: isoSeconds(Number.isFinite(last) ? last : now),
    players,
    rechecked,
    copies,
    vaults,
    sample,
    catalog: lookupFingerprint(lookup),
    // Due players left unread when the crawl ended: growing over crawls of one length, re-reads can't keep up with the store.
    due: plan.remaining(),
  });
  await writeFileAtomic(target, encodeCopies(crawl, key));
  // Nor can writing its file cost the weapons theirs, already written: no armor file just means no armor merge.
  if (armor && options.armorOut)
    await armor.write(resolve(options.armorOut), key, generatedAt).catch((error: unknown) => {
      console.warn(`Couldn't write the armor crawl: ${error instanceof Error ? error.message : error}`);
    });
  console.log(`Wrote ${copies} copies of ${collected.weapons()} weapons: ${summary()}, ending at ${client.rate()}/s, to ${target}.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
