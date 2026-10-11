import { describe, expect, test } from "vitest";
import { solve } from "../optimizer/solve";
import type { OptimizerInput, OptimizerLoadout, OptimizerPiece } from "../optimizer/types";
import { MIN_ELIGIBLE_QUERIES, usageBucket } from "./buckets";
import { dominatedBuilds, queryIdentity, summarizeRun } from "./summarize";
import { decodeRecord, encodeRecord } from "./wire";

function piece(id: string, stats: number[], extra: Partial<OptimizerPiece> = {}): OptimizerPiece {
  return { id, stats, exotic: false, ...extra };
}

function input(slots: OptimizerPiece[][], overrides: Partial<OptimizerInput> = {}): OptimizerInput {
  return {
    slots,
    minimums: [0, 0, 0, 0, 0, 0],
    mods: { major: 0, minor: 0 },
    allowTuning: false,
    ...overrides,
  };
}

const rest = [
  [piece("201", [0, 10, 0, 0, 0, 0])],
  [piece("301", [0, 0, 10, 0, 0, 0])],
  [piece("401", [0, 0, 0, 10, 0, 0])],
  [piece("501", [0, 0, 0, 0, 10, 0])],
];

describe("summarizeRun", () => {
  test("flags used, worse-only, and twin pieces from a real solve", () => {
    const q = input(
      [
        [
          piece("101", [30, 0, 0, 0, 0, 0]),
          piece("102", [20, 0, 0, 0, 0, 0]), // every build with it is beaten by 101's
          piece("103", [30, 0, 0, 0, 0, 0]), // 101's twin: the search keeps only one
          piece("104", [40, 0, 0, 0, 0, 0], { exotic: true, hash: 9 }), // excluded below
        ],
        ...rest,
      ],
      { exotic: { mode: "none" } },
    );
    const usage = new Map(summarizeRun(q, solve(q)).map((u) => [u.id, u]));
    expect(usage.get("101")).toEqual({ id: "101", used: true, optimal: true });
    expect(usage.get("103")).toEqual({ id: "103", used: true, optimal: true });
    expect(usage.get("102")).toEqual({ id: "102", used: true, optimal: false });
    expect(usage.has("104")).toBe(false); // never eligible, so it isn't "unused" either
    expect(usage.get("201")).toEqual({ id: "201", used: true, optimal: true });
  });

  test("pieces past the shown builds count as eligible but unused", () => {
    const helmets = Array.from({ length: 60 }, (_, i) =>
      piece(String(1000 + i), [i, 0, 0, 0, 0, 60 - i]),
    );
    const q = input([helmets, ...rest], { maxResults: 200 });
    const out = solve(q);
    const shown = new Set(out.loadouts.slice(0, 50).map((l) => l.pieceIds[0]));
    const usage = summarizeRun(q, out).filter((u) => u.id.startsWith("1"));
    expect(usage).toHaveLength(60);
    for (const u of usage) expect(u.used).toBe(shown.has(u.id));
  });

  test("exotics count only when the query picked them", () => {
    const helm = (id: string) => piece(id, [30, 0, 0, 0, 0, 0], { exotic: true, hash: 9 });
    const any = input([[helm("601"), piece("602", [20, 0, 0, 0, 0, 0])], ...rest]);
    expect(summarizeRun(any, solve(any)).map((u) => u.id)).not.toContain("601");
    const picked = input([[helm("601"), helm("603")], ...rest], {
      exotic: { mode: "specific", hashes: [9] },
    });
    const ids = summarizeRun(picked, solve(picked)).map((u) => u.id);
    expect(ids).toContain("601");
    expect(ids).toContain("603");
  });

  test("synthetic pieces are left out", () => {
    const q = input([[piece("synthetic-ci", [30, 0, 0, 0, 0, 0])], ...rest]);
    expect(summarizeRun(q, solve(q)).map((u) => u.id)).not.toContain("synthetic-ci");
  });
});

describe("dominatedBuilds", () => {
  const build = (ids: string[], stats: number[], power: number | null = null) =>
    ({ pieceIds: ids, stats, power }) as OptimizerLoadout;
  const pieces = new Map<string, OptimizerPiece>([
    ["x1", piece("x1", [0, 0, 0, 0, 0, 0], { exotic: true, hash: 1 })],
    ["x2", piece("x2", [0, 0, 0, 0, 0, 0], { exotic: true, hash: 2 })],
  ]);

  test("beaten on every stat is dominated; a tie is not", () => {
    const flags = dominatedBuilds(
      [
        build(["a"], [30, 30, 0, 0, 0, 0]),
        build(["b"], [30, 20, 0, 0, 0, 0]),
        build(["c"], [30, 30, 0, 0, 0, 0]),
        build(["d"], [10, 40, 0, 0, 0, 0]),
      ],
      pieces,
      false,
    );
    expect(flags).toEqual([false, true, false, false]);
  });

  test("builds with different exotics are never compared", () => {
    const flags = dominatedBuilds(
      [build(["x1"], [30, 30, 0, 0, 0, 0]), build(["x2"], [20, 20, 0, 0, 0, 0])],
      pieces,
      false,
    );
    expect(flags).toEqual([false, false]);
  });

  test("power breaks the comparison only while a power range is enforced", () => {
    const list = [build(["a"], [30, 0, 0, 0, 0, 0], 400), build(["b"], [20, 0, 0, 0, 0, 0], 450)];
    expect(dominatedBuilds(list, pieces, false)).toEqual([false, true]);
    expect(dominatedBuilds(list, pieces, true)).toEqual([false, false]);
  });
});

describe("queryIdentity", () => {
  test("ignores the pool and set order, but not the class", () => {
    const a = input([[piece("1", [1, 0, 0, 0, 0, 0])]], {
      setRequirements: [
        { setHash: 5, count: 2 },
        { setHash: 3, count: 2 },
      ],
    });
    const b = input([[piece("2", [9, 0, 0, 0, 0, 0])]], {
      setRequirements: [
        { setHash: 3, count: 2 },
        { setHash: 5, count: 2 },
      ],
    });
    expect(queryIdentity(a, 1)).toBe(queryIdentity(b, 1));
    expect(queryIdentity(a, 1)).not.toBe(queryIdentity(a, 2));
    expect(queryIdentity(a, 1)).not.toBe(
      queryIdentity({ ...a, minimums: [10, 0, 0, 0, 0, 0] }, 1),
    );
  });
});

describe("record wire format", () => {
  const key = "a".repeat(64);

  test("round-trips", () => {
    const pieces = [
      { id: "1", used: false, optimal: false },
      { id: "2", used: true, optimal: false },
      { id: "3", used: true, optimal: true },
    ];
    expect(decodeRecord(JSON.parse(JSON.stringify(encodeRecord(key, pieces))))).toEqual({
      key,
      pieces,
    });
  });

  test("rejects bad keys, ids, and flags", () => {
    expect(decodeRecord({ key: "nope", pieces: [["1", 0]] })).toBeNull();
    expect(decodeRecord({ key, pieces: [["abc", 0]] })).toBeNull();
    expect(decodeRecord({ key, pieces: [["1", 3]] })).toBeNull();
    expect(decodeRecord({ key, pieces: [] })).toBeNull();
  });
});

describe("usageBucket", () => {
  test("unused pieces need enough searches before they read as never used", () => {
    expect(usageBucket(undefined)).toBe("unknown");
    expect(usageBucket({ eligible: MIN_ELIGIBLE_QUERIES - 1, used: 0, optimal: 0 })).toBe("unknown");
    expect(usageBucket({ eligible: MIN_ELIGIBLE_QUERIES, used: 0, optimal: 0 })).toBe("never");
    expect(usageBucket({ eligible: 1, used: 1, optimal: 0 })).toBe("nonOptimal");
    expect(usageBucket({ eligible: 9, used: 2, optimal: 1 })).toBe("few");
    expect(usageBucket({ eligible: 9, used: 3, optimal: 1 })).toBe("many");
  });
});
