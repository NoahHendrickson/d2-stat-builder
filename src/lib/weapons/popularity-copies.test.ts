import { describe, expect, it } from "vitest";
import type { CrawlSource } from "./perk-popularity";
import {
  copyCount,
  emptyStore,
  lookupFingerprint,
  mergeCopies,
  pruneCopies,
  recheckPlan,
  snapshotFromCopies,
  storeDay,
  storeFromCrawl,
  tallyCopies,
  type CatalogColumns,
  type CopyStore,
  type SeenOwner,
} from "./popularity-copies";
import { emptyHazard, HAZARD_MAX_GAP, HAZARD_WEEKS } from "./popularity-hazard";

// Weapon 1: an intrinsic column (single perk, never identified), barrel 11/12,
// traits 13/14 and 13/15. Weapon 2: one barrel column.
const kinds = (...k: string[]) => k.map((kind) => ({ kind }));
const CATALOG: Record<number, { kind: string }[]> = {
  1: kinds("Intrinsic", "Barrel", "Trait", "Trait"),
  2: kinds("Barrel"),
};
const columnsOf: CatalogColumns = (hash) => CATALOG[hash];

const run = (generatedAt: string, players = 1): CrawlSource => ({
  generatedAt,
  from: generatedAt,
  to: generatedAt,
  players,
  rechecked: 0,
  copies: 1,
  vaults: 0,
  sample: { kind: "recent", minutes: 15 },
  catalog: "0",
});
const player = (id: number, played: number | undefined, whole = false): SeenOwner => ({ id: BigInt(id), type: 3, played, whole });
/** A copy of `weapon` as [weapon, instance id, owner's membership id, perks, equipped (left out: the read didn't say)]. */
type Copy = [weapon: number, id: number, owner: number, perks: (number | undefined)[], equipped?: boolean];

/** `day` and `hour` (UTC) as ms. */
const when = (day: number, hour = 0) => day * 86_400_000 + hour * 3_600_000;

/** One crawl read on `day` (at `hour`): its players, and their copies. */
function crawl(day: number, at: string, players: SeenOwner[], copies: Copy[], hour = 0) {
  const byWeapon = new Map<number, { id: bigint; owner: number; perks: (number | undefined)[]; equipped: boolean | undefined }[]>();
  for (const [weapon, id, owner, perks, equipped] of copies) {
    const list = byWeapon.get(weapon) ?? [];
    list.push({ id: BigInt(id), owner: players.findIndex((p) => p.id === BigInt(owner)), perks, equipped });
    byWeapon.set(weapon, list);
  }
  return storeFromCrawl(players, byWeapon, when(day, hour), run(at, players.length));
}

/** Every copy as [id, day last seen equipped], by weapon. */
const equippedDays = (store: CopyStore) =>
  Object.fromEntries([...store.weapons].map(([hash, w]) => [hash, Array.from(w.ids, (id, i) => [Number(id), w.equipped[i]])]));

/** Every copy as [id, day seen, owner's membership id, perks], by weapon. */
function contents(store: CopyStore) {
  return Object.fromEntries(
    [...store.weapons].map(([hash, w]) => [
      hash,
      Array.from(w.ids, (id, i) => [
        Number(id),
        w.seen[i],
        Number(store.owners.ids[w.owners[i]!]),
        Array.from(w.picks.subarray(i * w.columns, (i + 1) * w.columns), (p) => (p === 255 ? undefined : w.perks[p])),
      ]),
    ]),
  );
}
/** Every player as [membership id, last played, day last read]. */
const players = (store: CopyStore) =>
  Array.from(store.owners.ids, (id, i) => [Number(id), store.owners.played[i], Math.floor(store.owners.read[i]! / 1_440)]);

const merge = (...stores: CopyStore[]) => stores.reduce((a, b) => mergeCopies(a, b, columnsOf), emptyStore());

describe("storeFromCrawl", () => {
  it("keeps the players, read that day, and their copies sorted by id", () => {
    const store = crawl(100, "a", [player(7, 99), player(8, 100, true)], [
      [1, 9, 7, [undefined, 12, 13, 15]],
      [1, 3, 8, [undefined, 11, 14, 13]],
    ]);
    expect(contents(store)).toEqual({
      1: [
        [3, 100, 8, [undefined, 11, 14, 13]],
        [9, 100, 7, [undefined, 12, 13, 15]],
      ],
    });
    expect(players(store)).toEqual([
      [7, 99, 100],
      [8, 100, 100],
    ]);
    expect(Array.from(store.owners.whole)).toEqual([0, 1]);
  });

  it("handles ids past 2^53 exactly", () => {
    const id = BigInt("6917529123456789012");
    const store = storeFromCrawl([player(1, 1)], new Map([[2, [{ id, owner: 0, perks: [11], equipped: false }]]]), when(1), run("a"));
    expect(store.weapons.get(2)!.ids[0]).toBe(id);
  });
});

describe("mergeCopies", () => {
  it("keeps the later read's copy on the same day, whichever order the two come in", () => {
    // Read at 09:00 with barrel 11, then at 18:00 (rerolled to 12) on the same day.
    const morning = crawl(10, "morning", [player(7, 10)], [[1, 1, 7, [undefined, 11, 13, 14]]], 9);
    const evening = crawl(10, "evening", [player(7, 10)], [[1, 1, 7, [undefined, 12, 13, 14]]], 18);
    for (const store of [merge(morning, evening), merge(evening, morning)])
      expect(contents(store)[1]).toEqual([[1, 10, 7, [undefined, 12, 13, 14]]]);
  });

  it("leaves the players as they are when nothing comes in", () => {
    const store = merge(crawl(10, "a", [player(7, 10)], [[1, 1, 7, [undefined, 11, 13, 14]]]));
    expect(mergeCopies(store, emptyStore(), columnsOf).owners).toBe(store.owners);
  });

  it("counts a copy in both once, keeping the later sighting, and a player in both once", () => {
    const older = crawl(10, "a", [player(7, 10)], [
      [1, 1, 7, [undefined, 11, 13, 13]],
      [1, 2, 7, [undefined, 12, 14, 15]],
    ]);
    const newer = crawl(12, "b", [player(8, 12), player(7, 12)], [
      [1, 2, 7, [undefined, 11, 14, 15]],
      [1, 3, 8, [undefined, 12, 13, 15]],
    ]);
    const merged = merge(older, newer);
    expect(contents(merged)).toEqual({
      1: [
        [1, 10, 7, [undefined, 11, 13, 13]],
        [2, 12, 7, [undefined, 11, 14, 15]],
        [3, 12, 8, [undefined, 12, 13, 15]],
      ],
    });
    expect(players(merged)).toEqual([
      [7, 12, 12],
      [8, 12, 12],
    ]);
  });

  it("keeps the later read whichever side it's on, so an older crawl added late can't roll anything back", () => {
    const later = crawl(114, "b", [player(7, 114)], [[1, 1, 7, [undefined, 12, 14, 15]]]);
    const earlier = crawl(100, "a", [player(7, 100)], [[1, 1, 7, [undefined, 11, 13, 13]]]);
    const merged = merge(later, earlier);
    expect(contents(merged)).toEqual({ 1: [[1, 114, 7, [undefined, 12, 14, 15]]] });
    expect(players(merged)).toEqual([[7, 114, 114]]);
    expect(copyCount(pruneCopies(merged, 101))).toBe(1);
  });

  it("changes nothing when a crawl already in the store is merged again", () => {
    const a = crawl(100, "a", [player(7, 100)], [[1, 1, 7, [undefined, 11, 13, 13]]]);
    const b = crawl(114, "b", [player(7, 114)], [[1, 1, 7, [undefined, 12, 14, 15]]]);
    const ab = merge(a, b);
    const replayed = mergeCopies(ab, a, columnsOf);
    expect(contents(replayed)).toEqual(contents(ab));
    expect(players(replayed)).toEqual(players(ab));
    expect(replayed.runs.map((r) => r.generatedAt)).toEqual(["a", "b"]);
  });

  it("fills a column the later sighting couldn't identify from the earlier one", () => {
    const older = crawl(10, "a", [player(7, 10)], [[1, 1, 7, [undefined, 11, 13, 15]]]);
    const newer = crawl(12, "b", [player(7, 12)], [[1, 1, 7, [undefined, 12, undefined, undefined]]]);
    expect(contents(merge(older, newer))).toEqual({ 1: [[1, 12, 7, [undefined, 12, 13, 15]]] });
  });

  it("drops a player's older copies their later whole read didn't list, on every weapon", () => {
    const older = crawl(10, "a", [player(7, 10), player(8, 10)], [
      [1, 1, 7, [undefined, 11, 13, 15]],
      [1, 2, 7, [undefined, 12, 13, 15]],
      [2, 5, 7, [11]],
      [1, 3, 8, [undefined, 11, 14, 15]],
    ]);
    // Player 7 read again with their vault public: only copy 1 is left.
    const newer = crawl(12, "b", [player(7, 12, true)], [[1, 1, 7, [undefined, 11, 13, 15]]]);
    expect(contents(merge(older, newer))).toEqual({
      1: [
        [1, 12, 7, [undefined, 11, 13, 15]],
        [3, 10, 8, [undefined, 11, 14, 15]],
      ],
    });
  });

  it("keeps a player's older copies when their later read couldn't see the vault", () => {
    const older = crawl(10, "a", [player(7, 10)], [[1, 1, 7, [undefined, 11, 13, 15]]]);
    const newer = crawl(12, "b", [player(7, 12)], [[1, 2, 7, [undefined, 12, 13, 15]]]);
    expect(copyCount(merge(older, newer))).toBe(2);
  });

  it("doesn't let an older crawl added late bring back copies a later whole read found gone, on any weapon", () => {
    const earlier = crawl(100, "a", [player(7, 100)], [
      [1, 1, 7, [undefined, 11, 13, 15]],
      [1, 2, 7, [undefined, 12, 13, 15]],
      [2, 5, 7, [11]],
    ]);
    const laterWhole = crawl(114, "b", [player(7, 114, true)], [[1, 1, 7, [undefined, 11, 13, 15]]]);
    const inOrder = merge(earlier, laterWhole);
    const reversed = merge(laterWhole, earlier);
    expect(contents(inOrder)).toEqual({ 1: [[1, 114, 7, [undefined, 11, 13, 15]]] });
    expect(contents(reversed)).toEqual(contents(inOrder));
    expect(players(reversed)).toEqual(players(inOrder));
  });

  it("orders two whole reads of one day by the minute, whatever order they're merged in", () => {
    // 09:00 saw only copy 1; 15:00 saw copies 1 and 2.
    const morning = crawl(100, "a", [player(7, 100, true)], [[1, 1, 7, [undefined, 11, 13, 15]]], 9);
    const afternoon = crawl(100, "b", [player(7, 100, true)], [
      [1, 1, 7, [undefined, 11, 13, 15]],
      [1, 2, 7, [undefined, 12, 13, 15]],
    ], 15);
    expect(copyCount(merge(morning, afternoon))).toBe(2);
    expect(copyCount(merge(afternoon, morning))).toBe(2);
  });

  it("takes a sighting in a report as when they last played, and nothing more", () => {
    const read = crawl(100, "a", [player(7, 100, true)], [[2, 1, 7, [11]]]);
    const sighting = crawl(110, "b", [{ ...player(7, 110, true), sightedOnly: true }], []);
    const merged = merge(read, sighting);
    // Played on day 110, still last read on day 100 (so still due), and nothing dropped.
    expect(players(merged)).toEqual([[7, 110, 100]]);
    expect(copyCount(merged)).toBe(1);
    expect(copyCount(pruneCopies(merged, 110 - 13))).toBe(1);
  });

  it("leaves a weapon the crawl didn't touch as it was", () => {
    const store = merge(crawl(10, "a", [player(7, 10), player(8, 10)], [[2, 1, 7, [11]], [1, 2, 8, [undefined, 11, 13, 15]]]));
    const merged = mergeCopies(store, crawl(11, "b", [player(8, 11)], [[1, 3, 8, [undefined, 12, 13, 15]]]), columnsOf);
    expect(merged.weapons.get(2)).toBe(store.weapons.get(2));
  });

  it("keeps when a player last played when a later read couldn't tell", () => {
    const older = crawl(10, "a", [player(7, 9)], [[2, 1, 7, [11]]]);
    const newer = crawl(12, "b", [player(7, undefined)], [[2, 1, 7, [11]]]);
    expect(players(merge(older, newer))).toEqual([[7, 9, 12]]);
  });

  it("drops copies whose column count no longer matches the catalog, and weapons it doesn't have", () => {
    const stale = crawl(10, "a", [player(7, 10)], [
      [1, 1, 7, [11, 13]],
      [3, 5, 7, [11]],
    ]);
    const fresh = crawl(11, "b", [player(7, 11)], [[1, 2, 7, [undefined, 11, 13, 15]]]);
    expect(contents(mergeCopies(stale, fresh, columnsOf))).toEqual({ 1: [[2, 11, 7, [undefined, 11, 13, 15]]] });
    // With nothing to add, the merge still holds the store to the catalog.
    expect(contents(mergeCopies(stale, emptyStore(), columnsOf))).toEqual({});
  });
});

describe("pruneCopies", () => {
  const day = storeDay(Date.parse("2026-10-18T12:00:00Z"));

  it("keeps a private player's copy while they play until it goes unseen for the unseen window", () => {
    const seenAgo = (days: number) => crawl(day - days, "2026-09-01T12:00:00Z", [player(7, day - days)], [[1, 1, 7, [undefined, 11, 13, 15]]]);
    // Read again today without the vault: copy 1 wasn't equipped, but they still play.
    const readToday = crawl(day, "2026-10-18T12:00:00Z", [player(7, day)], [[2, 2, 7, [12]]]);
    const kept = pruneCopies(merge(seenAgo(25), readToday), day - 13, day - 29);
    expect(contents(kept)).toEqual({ 1: [[1, day - 25, 7, [undefined, 11, 13, 15]]], 2: [[2, day, 7, [12]]] });
    expect(kept.runs.map((r) => r.generatedAt)).toEqual(["2026-10-18T12:00:00Z"]);
    // Unseen for 40 days: only a whole read could say it's gone, so it goes.
    expect(contents(pruneCopies(merge(seenAgo(40), readToday), day - 13, day - 29))).toEqual({ 2: [[2, day, 7, [12]]] });
  });

  it("drops a private player whose every copy went unseen, and keeps a whole read's copies", () => {
    const store = merge(
      crawl(day - 40, "2026-09-08T12:00:00Z", [player(7, day - 40), player(8, day - 40, true)], [
        [1, 1, 7, [undefined, 11, 13, 15]],
        [1, 2, 8, [undefined, 12, 13, 15]],
      ]),
    );
    // Both still play (a sighting today), neither re-read.
    store.owners.played.fill(day);
    const pruned = pruneCopies(store, day - 13, day - 29);
    expect(players(pruned).map(([id]) => id)).toEqual([8]);
    expect(contents(pruned)[1]).toEqual([[2, day - 40, 8, [undefined, 12, 13, 15]]]);
  });

  it("drops players who haven't played for the window, their copies with them, and renumbers the rest", () => {
    const store = merge(
      crawl(day - 20, "a", [player(7, day - 20), player(8, day - 20)], [
        [1, 1, 7, [undefined, 11, 13, 15]],
        [2, 4, 8, [12]],
      ]),
      crawl(day, "b", [player(9, day), player(8, day)], [
        [1, 2, 9, [undefined, 12, 13, 15]],
        [2, 4, 8, [12]],
      ]),
    );
    const pruned = pruneCopies(store, day - 13);
    expect(contents(pruned)).toEqual({ 1: [[2, day, 9, [undefined, 12, 13, 15]]], 2: [[4, day, 8, [12]]] });
    expect(players(pruned)).toEqual([
      [8, day, day],
      [9, day, day],
    ]);
  });

  it("drops players left with no copies", () => {
    const store = merge(crawl(day, "a", [player(7, day, true)], []));
    expect(players(pruneCopies(store, day - 13))).toEqual([]);
  });

  it("leaves the copies as they are when no player goes", () => {
    const store = merge(crawl(day, "a", [player(7, day)], [[2, 1, 7, [11]]]));
    expect(pruneCopies(store, day - 13).weapons.get(2)).toBe(store.weapons.get(2));
  });
});

describe("recheckPlan", () => {
  // Players 1 and 2 were read 10 and 20 days before day 30, player 3 that day.
  const store = merge(
    crawl(20, "a", [player(1, 20)], [[2, 1, 1, [11]]]),
    crawl(10, "b", [player(2, 10)], [[2, 2, 2, [11]]]),
    crawl(30, "c", [player(3, 30)], [[2, 3, 3, [11]]]),
  );
  const plan = () => recheckPlan(store.owners, 30, 7);

  it("reads again the players not read for the days given, the longest unread first", () => {
    const p = plan();
    expect([p.next(1, 0), p.next(3, 1), p.next(5, 2)]).toEqual([{ type: 3, id: "2" }, { type: 3, id: "1" }, undefined]);
    expect(p.remaining()).toBe(0);
  });

  it("keeps re-reads to half the reads started, failed ones included", () => {
    const p = plan();
    // No reads yet: a re-read now would be all of them.
    expect(p.next(0, 0)).toBeUndefined();
    // One new read started: the re-read makes it half.
    expect(p.next(1, 0)).toEqual({ type: 3, id: "2" });
    // That re-read counts once started, whether or not it answers.
    expect(p.next(2, 1)).toBeUndefined();
    expect(p.next(3, 1)).toEqual({ type: 3, id: "1" });
  });

  it("knows who's in the store, and who was read too recently to read now", () => {
    const p = plan();
    expect([p.known("1"), p.known("3"), p.known("9")]).toEqual([true, true, false]);
    expect([p.recentlyRead("1"), p.recentlyRead("3"), p.recentlyRead("9")]).toEqual([false, true, false]);
    expect(p.players).toBe(3);
  });
});

describe("lookupFingerprint", () => {
  it("is the same for the same weapons in any order, and differs when one is missing or changes columns", () => {
    const lookup = (...weapons: [number, number][]) => new Map(weapons.map(([hash, columns]) => [hash, Array(columns)]));
    expect(lookupFingerprint(lookup([3, 4], [1, 2], [2, 5]))).toBe(lookupFingerprint(lookup([1, 2], [2, 5], [3, 4])));
    expect(lookupFingerprint(lookup([1, 2], [2, 5]))).not.toBe(lookupFingerprint(lookup([1, 2], [2, 5], [3, 4])));
    // A weapon that gained a column is a different catalog too.
    expect(lookupFingerprint(lookup([1, 2], [2, 6]))).not.toBe(lookupFingerprint(lookup([1, 2], [2, 5])));
  });
});

describe("tallyCopies", () => {
  it("counts each column's perks and the trait combos, skipping unidentified perks", () => {
    const store = crawl(1, "a", [player(7, 1)], [
      [1, 1, 7, [undefined, 11, 13, 15]],
      [1, 2, 7, [undefined, 11, 14, 15]],
      [1, 3, 7, [undefined, 12, 14, 15]],
      [1, 4, 7, [undefined, undefined, 14, undefined]],
    ]);
    expect(tallyCopies(merge(store), columnsOf)).toEqual({
      1: {
        copies: 4,
        columns: [{}, { 11: 2, 12: 1 }, { 13: 1, 14: 3 }, { 15: 3 }],
        combos: { "13,15": 1, "14,15": 2 },
      },
    });
  });

  it("refuses a store that wasn't merged against this catalog", () => {
    const store = crawl(1, "a", [player(7, 1)], [[1, 1, 7, [11, 13, 15]]]);
    expect(() => tallyCopies(store, columnsOf)).toThrow(/merge first/);
  });
});

describe("snapshotFromCopies", () => {
  it("tallies the store, counts its players, and spans and lists its crawls", () => {
    const store = merge(
      storeFromCrawl([player(7, 10)], new Map([[2, [{ id: BigInt(1), owner: 0, perks: [11], equipped: true }]]]), when(10), {
        ...run("2026-10-17T01:00:00Z", 4),
        from: "2026-10-17T00:00:00Z",
      }),
      storeFromCrawl([player(7, 11), player(8, 11)], new Map([[2, [{ id: BigInt(1), owner: 0, perks: [12], equipped: true }]]]), when(11), {
        ...run("2026-10-18T01:00:00Z", 6),
        from: "2026-10-18T00:00:00Z",
      }),
    );
    expect(snapshotFromCopies(store, columnsOf, "2026-10-18T02:00:00Z")).toEqual({
      schema: 2,
      generatedAt: "2026-10-18T02:00:00Z",
      from: "2026-10-17T00:00:00Z",
      to: "2026-10-18T01:00:00Z",
      // Players 7 and 8, once each however many crawls read them.
      players: 2,
      // The copy both crawls saw counts once, with the later crawl's perk.
      weapons: { 2: { copies: 1, columns: [{ 12: 1 }] } },
      crawls: store.runs,
      hazard: emptyHazard(),
    });
  });
});

describe("the hazard", () => {
  // A store week starts on a multiple of 7 store days; `day` is 3 into one.
  const day = storeDay(Date.parse("2026-10-18T12:00:00Z"));
  const week = (d: number) => d - (d % 7);
  /** Zeros up to `gap`, then `n`. */
  const at = (gap: number, n = 1) => [...Array.from({ length: gap }, () => 0), n];

  it("keeps the day a copy was last seen equipped, through later sightings of it stowed", () => {
    const before = crawl(day - 7, "a", [player(7, day - 7)], [
      [1, 1, 7, [undefined, 11, 13, 15], true],
      [1, 2, 7, [undefined, 12, 13, 15], false],
      // From a read that didn't say: never seen equipped.
      [2, 3, 7, [11]],
    ]);
    expect(equippedDays(before)).toEqual({ 1: [[1, day - 7], [2, 0]], 2: [[3, 0]] });
    const again = crawl(day, "b", [player(7, day)], [
      [1, 1, 7, [undefined, 11, 13, 15], false],
      [1, 2, 7, [undefined, 12, 13, 15], true],
      [2, 3, 7, [11]],
    ]);
    expect(equippedDays(merge(before, again))).toEqual({ 1: [[1, day - 7], [2, day]], 2: [[3, 0]] });
    // Whichever order the two come in.
    expect(equippedDays(merge(again, before))).toEqual({ 1: [[1, day - 7], [2, day]], 2: [[3, 0]] });
    // A crawl's store has no hazard; a merged one always has.
    expect(before.hazard).toBeUndefined();
    expect(merge(before, again).hazard).toEqual(emptyHazard());
  });

  it("checks a whole player's copies out of the loadout when they're read whole again: stowed or gone, by days since equipped", () => {
    const before = crawl(day - 7, "a", [player(7, day - 7, true)], [
      // Still there, stowed, at the next read: checked and kept.
      [1, 1, 7, [undefined, 11, 13, 15], true],
      // Gone by the next read: checked and gone.
      [1, 2, 7, [undefined, 12, 13, 15], true],
      // Equipped again at the next read: not out of the loadout, so not checked.
      [2, 3, 7, [11], true],
      // Never seen equipped: nothing to measure the gap from, whether kept (4) or gone (5).
      [2, 4, 7, [12], false],
      [2, 5, 7, [12]],
    ]);
    const again = crawl(day, "b", [player(7, day, true)], [
      [1, 1, 7, [undefined, 11, 13, 15], false],
      [2, 3, 7, [11], true],
      [2, 4, 7, [12], false],
    ]);
    const merged = merge(before, again);
    expect(merged.hazard).toEqual({ weeks: [{ day: week(day), checked: at(7, 2), gone: at(7) }] });
    expect(equippedDays(merged)).toEqual({ 1: [[1, day - 7]], 2: [[3, day], [4, 0]] });
    // The hazard stays through a prune, and goes out in the snapshot.
    expect(pruneCopies(merged, day - 13).hazard).toEqual(merged.hazard);
    expect(snapshotFromCopies(merged, columnsOf).hazard).toEqual(merged.hazard);
  });

  it("measures nothing from a read that didn't see everything, or of a player whole for the first time", () => {
    const before = crawl(day - 7, "a", [player(7, day - 7, true), player(8, day - 7)], [
      [1, 1, 7, [undefined, 11, 13, 15], true],
      [1, 2, 8, [undefined, 11, 13, 15], true],
    ]);
    const again = crawl(day, "b", [player(7, day), player(8, day, true)], [[1, 2, 8, [undefined, 11, 13, 15], false]]);
    expect(merge(before, again).hazard).toEqual(emptyHazard());
  });

  it("checks a copy again at every later whole read until it's gone, the gap from when it was last equipped", () => {
    const first = crawl(day - 100, "a", [player(7, day - 100, true)], [[2, 1, 7, [11], true]]);
    // Stowed 93 days later: checked at the longest gap told apart, kept.
    const second = crawl(day - 7, "b", [player(7, day - 7, true)], [[2, 1, 7, [11], false], [2, 2, 7, [12], true]]);
    // Gone another week on, as is copy 2, out of the loadout for 7 days.
    const third = crawl(day, "c", [player(7, day, true)], []);
    expect(merge(first, second, third).hazard).toEqual({
      weeks: [
        { day: week(day - 7), checked: at(HAZARD_MAX_GAP), gone: [] },
        { day: week(day), checked: at(HAZARD_MAX_GAP).map((n, gap) => (gap === 7 ? 1 : n)), gone: at(HAZARD_MAX_GAP).map((n, gap) => (gap === 7 ? 1 : n)) },
      ],
    });
  });

  it("drops the hazard's old weeks with the prune", () => {
    // Two weeks past the weeks kept, so the check's week starts HAZARD_WEEKS or more before the window however `day` falls in its week.
    const long = HAZARD_WEEKS * 7 + 14;
    const first = crawl(day - long - 7, "a", [player(7, day - long - 7, true)], [[2, 1, 7, [11], true]]);
    const second = crawl(day - long, "b", [player(7, day - long, true)], [[2, 1, 7, [11], false]]);
    const third = crawl(day, "c", [player(7, day, true)], [[2, 1, 7, [11], false]]);
    const merged = merge(first, second, third);
    expect(merged.hazard!.weeks.map((w) => w.day)).toEqual([week(day - long), week(day)]);
    expect(pruneCopies(merged, day - 13).hazard!.weeks.map((w) => w.day)).toEqual([week(day)]);
  });
});
