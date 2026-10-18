import { describe, expect, it } from "vitest";
import type { CrawlSource } from "./perk-popularity";
import {
  copyCount,
  dueOwners,
  emptyStore,
  mergeCopies,
  pruneCopies,
  snapshotFromCopies,
  storeDay,
  storeFromCrawl,
  tallyCopies,
  type CatalogColumns,
  type CopyStore,
  type SeenOwner,
} from "./popularity-copies";

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
});
const player = (id: number, played: number, whole = false): SeenOwner => ({ id: BigInt(id), type: 3, played, whole });
/** A copy of `weapon` as [weapon, instance id, owner's membership id, perks]. */
type Copy = [weapon: number, id: number, owner: number, perks: (number | undefined)[]];

/** One crawl read on `day`: its players, and their copies. */
function crawl(day: number, at: string, players: SeenOwner[], copies: Copy[]) {
  const byWeapon = new Map<number, { id: bigint; owner: number; perks: (number | undefined)[] }[]>();
  for (const [weapon, id, owner, perks] of copies) {
    const list = byWeapon.get(weapon) ?? [];
    list.push({ id: BigInt(id), owner: players.findIndex((p) => p.id === BigInt(owner)), perks });
    byWeapon.set(weapon, list);
  }
  return storeFromCrawl(players, byWeapon, day, run(at, players.length));
}

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
/** Every player as [membership id, last played, last read]. */
const players = (store: CopyStore) =>
  Array.from(store.owners.ids, (id, i) => [Number(id), store.owners.played[i], store.owners.read[i]]);

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
    const store = storeFromCrawl([player(1, 1)], new Map([[2, [{ id, owner: 0, perks: [11] }]]]), 1, run("a"));
    expect(store.weapons.get(2)!.ids[0]).toBe(id);
  });
});

describe("mergeCopies", () => {
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

  it("keeps a player's copies for as long as they play, however long ago they were seen", () => {
    const seenLongAgo = crawl(day - 40, "2026-09-08T12:00:00Z", [player(7, day - 40)], [[1, 1, 7, [undefined, 11, 13, 15]]]);
    // Read again today without the vault: copy 1 wasn't equipped, but they still play.
    const readToday = crawl(day, "2026-10-18T12:00:00Z", [player(7, day)], [[2, 2, 7, [12]]]);
    const pruned = pruneCopies(merge(seenLongAgo, readToday), day - 13);
    expect(contents(pruned)).toEqual({ 1: [[1, day - 40, 7, [undefined, 11, 13, 15]]], 2: [[2, day, 7, [12]]] });
    expect(pruned.runs.map((r) => r.generatedAt)).toEqual(["2026-10-18T12:00:00Z"]);
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
});

describe("dueOwners", () => {
  it("lists the players last read on or before the day given, the longest unread first", () => {
    const store = merge(
      crawl(20, "a", [player(1, 20)], [[2, 1, 1, [11]]]),
      crawl(10, "b", [player(2, 10)], [[2, 2, 2, [11]]]),
      crawl(30, "c", [player(3, 30)], [[2, 3, 3, [11]]]),
    );
    expect(dueOwners(store, 20)).toEqual([
      { type: 3, id: BigInt(2) },
      { type: 3, id: BigInt(1) },
    ]);
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
      storeFromCrawl([player(7, 10)], new Map([[2, [{ id: BigInt(1), owner: 0, perks: [11] }]]]), 10, {
        ...run("2026-10-17T01:00:00Z", 4),
        from: "2026-10-17T00:00:00Z",
      }),
      storeFromCrawl([player(7, 11), player(8, 11)], new Map([[2, [{ id: BigInt(1), owner: 0, perks: [12] }]]]), 11, {
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
    });
  });
});
