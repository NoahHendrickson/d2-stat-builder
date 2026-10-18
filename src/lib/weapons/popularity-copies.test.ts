import { describe, expect, it } from "vitest";
import {
  copyCount,
  decodeCopies,
  emptyStore,
  encodeCopies,
  mergeCopies,
  pruneCopies,
  snapshotFromCopies,
  storeDay,
  storeFromCopies,
  tallyCopies,
  type CopyStore,
  type SeenCopy,
} from "./popularity-copies";

// Weapon 1: an intrinsic column (never identified, single perk), barrel 11/12, traits 13/14 and 13/15.
const copy = (id: number, perks: (number | undefined)[]): SeenCopy => ({ id: BigInt(id), perks });
const run = (generatedAt: string) => ({ file: generatedAt, generatedAt, from: generatedAt, to: generatedAt, players: 1, copies: 1 });

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
  it("keeps one record per copy, sorted by id, all seen on the day given", () => {
    const store = storeFromCopies(
      new Map([[1, [copy(9, [undefined, 12, 13, 15]), copy(3, [undefined, 11, 14, 13]), copy(9, [undefined, 11, 14, 15])]]]),
      100,
    );
    expect(contents(store)).toEqual({
      1: [
        [3, 100, [undefined, 11, 14, 13]],
        [9, 100, [undefined, 11, 14, 15]],
      ],
    });
  });

  it("handles ids past 2^53 exactly", () => {
    const id = BigInt("6917529123456789012");
    const store = storeFromCopies(new Map([[1, [{ id, perks: [11] }]]]), 1);
    expect(store.weapons.get(1)!.ids[0]).toBe(id);
  });
});

describe("mergeCopies", () => {
  it("counts a copy in both once, with the newer record", () => {
    const older = storeFromCopies(new Map([[1, [copy(1, [undefined, 11, 13, 13]), copy(2, [undefined, 12, 14, 15])]]]), 10);
    const newer = storeFromCopies(new Map([[1, [copy(2, [undefined, 11, 14, 15]), copy(3, [undefined, 12, 13, 15])]]]), 12);
    expect(contents(mergeCopies(older, newer))).toEqual({
      1: [
        [1, 10, [undefined, 11, 13, 13]],
        [2, 12, [undefined, 11, 14, 15]],
        [3, 12, [undefined, 12, 13, 15]],
      ],
    });
  });

  it("keeps weapons only one side has, and adds up the runs", () => {
    const older = storeFromCopies(new Map([[1, [copy(1, [11])]]]), 10, run("2026-10-17T00:00:00Z"));
    const newer = storeFromCopies(new Map([[2, [copy(5, [12])]]]), 11, run("2026-10-18T00:00:00Z"));
    const merged = mergeCopies(older, newer);
    expect(contents(merged)).toEqual({ 1: [[1, 10, [11]]], 2: [[5, 11, [12]]] });
    expect(merged.runs.map((r) => r.file)).toEqual(["2026-10-17T00:00:00Z", "2026-10-18T00:00:00Z"]);
  });

  it("lists a crawl merged twice once", () => {
    const crawl = storeFromCopies(new Map([[1, [copy(1, [11])]]]), 10, run("a"));
    const other = storeFromCopies(new Map([[1, [copy(2, [11])]]]), 10, run("b"));
    const twice = mergeCopies(mergeCopies(crawl, other), crawl);
    expect(twice.runs.map((r) => r.file)).toEqual(["b", "a"]);
    expect(copyCount(twice)).toBe(2);
  });

  it("drops the older copies of a weapon whose column count changed", () => {
    const older = storeFromCopies(new Map([[1, [copy(1, [11, 13])]]]), 10);
    const newer = storeFromCopies(new Map([[1, [copy(2, [11, 13, 15])]]]), 11);
    expect(contents(mergeCopies(older, newer))).toEqual({ 1: [[2, 11, [11, 13, 15]]] });
  });

  it("merges into an empty store", () => {
    const newer = storeFromCopies(new Map([[1, [copy(1, [11])]]]), 10);
    expect(contents(mergeCopies(emptyStore(), newer))).toEqual(contents(newer));
  });
});

describe("pruneCopies", () => {
  it("drops copies and runs from before the first day kept, and weapons left empty", () => {
    const day = storeDay(Date.parse("2026-10-18T12:00:00Z"));
    const store = mergeCopies(
      storeFromCopies(new Map([[1, [copy(1, [11])]], [2, [copy(4, [12])]]]), day - 20, run("2026-09-28T12:00:00Z")),
      storeFromCopies(new Map([[1, [copy(2, [12])]]]), day, run("2026-10-18T12:00:00Z")),
    );
    const pruned = pruneCopies(store, day - 13);
    expect(contents(pruned)).toEqual({ 1: [[2, day, [12]]] });
    expect(pruned.runs.map((r) => r.file)).toEqual(["2026-10-18T12:00:00Z"]);
    expect(copyCount(pruned)).toBe(1);
  });
});

describe("tallyCopies", () => {
  const traits = (hash: number) => (hash === 1 ? ([2, 3] as const) : undefined);

  it("counts each column's perks and the trait combos, skipping unidentified perks", () => {
    const store = storeFromCopies(
      new Map([
        [
          1,
          [
            copy(1, [undefined, 11, 13, 15]),
            copy(2, [undefined, 11, 14, 15]),
            copy(3, [undefined, 12, 14, 15]),
            copy(4, [undefined, undefined, 14, undefined]),
          ],
        ],
      ]),
      1,
    );
    expect(tallyCopies(store, () => 4, traits)).toEqual({
      1: {
        copies: 4,
        columns: [{}, { 11: 2, 12: 1 }, { 13: 1, 14: 3 }, { 15: 3 }],
        combos: { "13,15": 1, "14,15": 2 },
      },
    });
  });

  it("leaves out weapons gone from the catalog or with a different column count", () => {
    const store = storeFromCopies(new Map([[1, [copy(1, [11, 13, 15])]], [2, [copy(2, [12])]]]), 1);
    expect(tallyCopies(store, (hash) => (hash === 1 ? 4 : undefined), traits)).toEqual({});
  });
});

describe("snapshotFromCopies", () => {
  it("tallies the store, spans and lists its crawls, and adds up their players", () => {
    const crawl = (file: string, from: string, to: string, players: number) => ({
      file,
      generatedAt: to,
      from,
      to,
      players,
      copies: 1,
    });
    const store = mergeCopies(
      storeFromCopies(new Map([[1, [copy(1, [11])]]]), 10, crawl("a", "2026-10-17T00:00:00Z", "2026-10-17T01:00:00Z", 4)),
      storeFromCopies(new Map([[1, [copy(1, [12])]]]), 11, crawl("b", "2026-10-18T00:00:00Z", "2026-10-18T01:00:00Z", 6)),
    );
    expect(snapshotFromCopies(store, () => 1, () => undefined, "2026-10-18T02:00:00Z")).toEqual({
      schema: 2,
      generatedAt: "2026-10-18T02:00:00Z",
      from: "2026-10-17T00:00:00Z",
      to: "2026-10-18T01:00:00Z",
      players: 10,
      // The copy both crawls saw counts once, with the later crawl's perk.
      weapons: { 1: { copies: 1, columns: [{ 12: 1 }] } },
      crawls: store.runs,
    });
  });
});

describe("encodeCopies / decodeCopies", () => {
  it("round-trips copies, days, unidentified perks and runs", () => {
    const store = mergeCopies(
      storeFromCopies(new Map([[1, [copy(1, [undefined, 11, 13, 15]), copy(7, [undefined, 12, 14, 13])]]]), 20_000, run("a")),
      storeFromCopies(new Map([[4_294_967_295, [{ id: BigInt("18446744073709551615"), perks: [4_000_000_000] }]]]), 20_001, run("b")),
    );
    const back = decodeCopies(encodeCopies(store));
    expect(contents(back)).toEqual(contents(store));
    expect(back.runs).toEqual(store.runs);
  });

  it("rejects a file that isn't a copy store", () => {
    expect(() => decodeCopies(encodeCopies(emptyStore()).subarray(0, 5))).toThrow();
  });
});
