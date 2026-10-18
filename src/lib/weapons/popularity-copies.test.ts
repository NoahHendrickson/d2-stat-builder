import { describe, expect, it } from "vitest";
import type { CrawlSource } from "./perk-popularity";
import {
  copyCount,
  emptyStore,
  mergeCopies,
  pruneCopies,
  snapshotFromCopies,
  storeDay,
  storeFromCopies,
  tallyCopies,
  type CatalogColumns,
  type CopyStore,
  type SeenCopy,
} from "./popularity-copies";

// Weapon 1: an intrinsic column (single perk, never identified), barrel 11/12,
// traits 13/14 and 13/15. Weapon 2: one barrel column.
const kinds = (...k: string[]) => k.map((kind) => ({ kind }));
const CATALOG: Record<number, { kind: string }[]> = {
  1: kinds("Intrinsic", "Barrel", "Trait", "Trait"),
  2: kinds("Barrel"),
};
const columnsOf: CatalogColumns = (hash) => CATALOG[hash];

const copy = (id: number, perks: (number | undefined)[]): SeenCopy => ({ id: BigInt(id), perks });
const crawl = (generatedAt: string, players = 1): CrawlSource => ({
  generatedAt,
  from: generatedAt,
  to: generatedAt,
  players,
  copies: 1,
  vaults: 0,
  sample: { kind: "recent", minutes: 15 },
});
/** A one-crawl store of weapon 1's copies, seen on `day`. */
const seen = (day: number, at: string, ...copies: SeenCopy[]) => storeFromCopies(new Map([[1, copies]]), day, crawl(at));

/** Every copy as [id, day, perks], by weapon, for comparing stores. */
function contents(store: CopyStore) {
  return Object.fromEntries(
    [...store.weapons].map(([hash, w]) => [
      hash,
      Array.from(w.ids, (id, i) => [
        Number(id),
        w.seen[i],
        Array.from(w.picks.subarray(i * w.columns, (i + 1) * w.columns), (p) => (p === 255 ? undefined : w.perks[p])),
      ]),
    ]),
  );
}

describe("storeFromCopies", () => {
  it("keeps the copies sorted by id, all seen on the day given, with the crawl", () => {
    const store = seen(100, "a", copy(9, [undefined, 12, 13, 15]), copy(3, [undefined, 11, 14, 13]));
    expect(contents(store)).toEqual({
      1: [
        [3, 100, [undefined, 11, 14, 13]],
        [9, 100, [undefined, 12, 13, 15]],
      ],
    });
    expect(store.runs.map((r) => r.generatedAt)).toEqual(["a"]);
  });

  it("handles ids past 2^53 exactly", () => {
    const id = BigInt("6917529123456789012");
    const store = storeFromCopies(new Map([[2, [{ id, perks: [11] }]]]), 1, crawl("a"));
    expect(store.weapons.get(2)!.ids[0]).toBe(id);
  });
});

describe("mergeCopies", () => {
  it("counts a copy in both once, keeping the later sighting", () => {
    const older = seen(10, "a", copy(1, [undefined, 11, 13, 13]), copy(2, [undefined, 12, 14, 15]));
    const newer = seen(12, "b", copy(2, [undefined, 11, 14, 15]), copy(3, [undefined, 12, 13, 15]));
    expect(contents(mergeCopies(older, newer, columnsOf))).toEqual({
      1: [
        [1, 10, [undefined, 11, 13, 13]],
        [2, 12, [undefined, 11, 14, 15]],
        [3, 12, [undefined, 12, 13, 15]],
      ],
    });
  });

  it("keeps the later sighting whichever side it's on, so an older crawl added late can't roll a copy back", () => {
    const later = seen(114, "b", copy(1, [undefined, 12, 14, 15]));
    const earlier = seen(100, "a", copy(1, [undefined, 11, 13, 13]));
    const merged = mergeCopies(later, earlier, columnsOf);
    expect(contents(merged)).toEqual({ 1: [[1, 114, [undefined, 12, 14, 15]]] });
    // So pruning on day 114 keeps it.
    expect(copyCount(pruneCopies(merged, 101))).toBe(1);
  });

  it("changes nothing when a crawl already in the store is merged again", () => {
    const a = seen(100, "a", copy(1, [undefined, 11, 13, 13]));
    const b = seen(114, "b", copy(1, [undefined, 12, 14, 15]));
    const ab = mergeCopies(a, b, columnsOf);
    const replayed = mergeCopies(ab, a, columnsOf);
    expect(contents(replayed)).toEqual(contents(ab));
    expect(replayed.runs.map((r) => r.generatedAt)).toEqual(["a", "b"]);
  });

  it("tells crawls apart by when they finished, not by anything else", () => {
    const merged = mergeCopies(seen(10, "a", copy(1, [undefined, 11, 13, 13])), seen(10, "b", copy(2, [undefined, 11, 13, 13])), columnsOf);
    expect(merged.runs.map((r) => r.generatedAt)).toEqual(["a", "b"]);
    expect(copyCount(merged)).toBe(2);
  });

  it("fills a column the later sighting couldn't identify from the earlier one", () => {
    const older = seen(10, "a", copy(1, [undefined, 11, 13, 15]));
    const newer = seen(12, "b", copy(1, [undefined, 12, undefined, undefined]));
    expect(contents(mergeCopies(older, newer, columnsOf))).toEqual({ 1: [[1, 12, [undefined, 12, 13, 15]]] });
  });

  it("drops copies whose column count no longer matches the catalog, and weapons it doesn't have", () => {
    const stale = storeFromCopies(new Map([[1, [copy(1, [11, 13])]], [3, [copy(5, [11])]]]), 10, crawl("a"));
    const fresh = seen(11, "b", copy(2, [undefined, 11, 13, 15]));
    expect(contents(mergeCopies(stale, fresh, columnsOf))).toEqual({ 1: [[2, 11, [undefined, 11, 13, 15]]] });
    // With nothing to add, the merge still holds the store to the catalog.
    expect(contents(mergeCopies(stale, emptyStore(), columnsOf))).toEqual({});
  });
});

describe("pruneCopies", () => {
  it("drops copies and crawls from before the first day kept, and weapons left empty", () => {
    const day = storeDay(Date.parse("2026-10-18T12:00:00Z"));
    const store = mergeCopies(
      storeFromCopies(new Map([[1, [copy(1, [undefined, 11, 13, 15])]], [2, [copy(4, [12])]]]), day - 20, crawl("2026-09-28T12:00:00Z")),
      seen(day, "2026-10-18T12:00:00Z", copy(2, [undefined, 12, 13, 15])),
      columnsOf,
    );
    const pruned = pruneCopies(store, day - 13);
    expect(contents(pruned)).toEqual({ 1: [[2, day, [undefined, 12, 13, 15]]] });
    expect(pruned.runs.map((r) => r.generatedAt)).toEqual(["2026-10-18T12:00:00Z"]);
  });
});

describe("tallyCopies", () => {
  it("counts each column's perks and the trait combos, skipping unidentified perks", () => {
    const store = seen(
      1,
      "a",
      copy(1, [undefined, 11, 13, 15]),
      copy(2, [undefined, 11, 14, 15]),
      copy(3, [undefined, 12, 14, 15]),
      copy(4, [undefined, undefined, 14, undefined]),
    );
    expect(tallyCopies(mergeCopies(emptyStore(), store, columnsOf), columnsOf)).toEqual({
      1: {
        copies: 4,
        columns: [{}, { 11: 2, 12: 1 }, { 13: 1, 14: 3 }, { 15: 3 }],
        combos: { "13,15": 1, "14,15": 2 },
      },
    });
  });

  it("refuses a store that wasn't merged against this catalog", () => {
    const store = storeFromCopies(new Map([[1, [copy(1, [11, 13, 15])]]]), 1, crawl("a"));
    expect(() => tallyCopies(store, columnsOf)).toThrow(/merge first/);
  });
});

describe("snapshotFromCopies", () => {
  it("tallies the store, spans and lists its crawls, and adds up their players", () => {
    const store = mergeCopies(
      storeFromCopies(new Map([[2, [copy(1, [11])]]]), 10, { ...crawl("2026-10-17T01:00:00Z", 4), from: "2026-10-17T00:00:00Z" }),
      storeFromCopies(new Map([[2, [copy(1, [12])]]]), 11, { ...crawl("2026-10-18T01:00:00Z", 6), from: "2026-10-18T00:00:00Z" }),
      columnsOf,
    );
    expect(snapshotFromCopies(store, columnsOf, "2026-10-18T02:00:00Z")).toEqual({
      schema: 2,
      generatedAt: "2026-10-18T02:00:00Z",
      from: "2026-10-17T00:00:00Z",
      to: "2026-10-18T01:00:00Z",
      players: 10,
      // The copy both crawls saw counts once, with the later crawl's perk.
      weapons: { 2: { copies: 1, columns: [{ 12: 1 }] } },
      crawls: store.runs,
    });
  });
});
