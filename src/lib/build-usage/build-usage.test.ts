import { describe, expect, test } from "vitest";
import { solve } from "../optimizer/solve";
import type { OptimizerInput, OptimizerLoadout, OptimizerPiece } from "../optimizer/types";
import { MIN_ELIGIBLE_QUERIES, loadoutPieceIds, usageBucket } from "./buckets";
import { queryIdentity, summarizeRun } from "./summarize";
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

const usageOf = (
  q: OptimizerInput,
  displayed = solve(q).loadouts,
  returned: readonly OptimizerLoadout[] = displayed,
) => new Map(summarizeRun(q, displayed, returned).map((u) => [u.id, u.used]));

describe("summarizeRun", () => {
  test("flags used and twin pieces from a real solve", () => {
    const q = input([
      [
        piece("101", [30, 0, 0, 0, 0, 0]),
        piece("103", [30, 0, 0, 0, 0, 0]), // 101's twin: the search keeps only one
      ],
      ...rest,
    ]);
    const usage = usageOf(q);
    expect(usage.get("101")).toBe(true);
    expect(usage.get("103")).toBe(true);
    expect(usage.get("201")).toBe(true);
  });

  test("counts the displayed builds, not the solver's order", () => {
    // Weapons and total disagree, so a Weapons sort shows a different 50 than the solver's.
    const helmets = Array.from({ length: 60 }, (_, i) =>
      piece(String(1000 + i), [(i * 37) % 60, 0, 0, 0, 0, i]),
    );
    const q = input([helmets, ...rest]);
    const returned = solve(q).loadouts;
    const displayed = [...returned].sort((a, b) => b.stats[0] - a.stats[0]).slice(0, 50);
    // Ties are cut at the 50th-best total, not the lowest displayed one, which a
    // Weapons sort drags far down the totals.
    const floor = Math.max(
      Math.min(...displayed.map((l) => l.total)),
      returned.map((l) => l.total).sort((x, y) => y - x)[displayed.length - 1],
    );
    expect(floor).toBeGreaterThan(Math.min(...displayed.map((l) => l.total)));
    const credited = new Set(
      [...displayed, ...returned.filter((l) => l.total >= floor)].map((l) => l.pieceIds[0]),
    );
    const usage = usageOf(q, displayed, returned);
    expect([...usage.keys()].filter((id) => id.startsWith("1"))).toHaveLength(60);
    for (const h of helmets) expect(usage.get(h.id)).toBe(credited.has(h.id));
    // Every displayed helmet is credited, and the rule still leaves some out.
    for (const l of displayed) expect(usage.get(l.pieceIds[0])).toBe(true);
    expect(helmets.some((h) => !usage.get(h.id))).toBe(true);
  });

  test("builds that tie the displayed ones count even when the list cut them", () => {
    const helmets = Array.from({ length: 60 }, (_, i) =>
      piece(String(1000 + i), [i, 0, 0, 0, 0, 60 - i]),
    );
    const q = input([helmets, ...rest]);
    const returned = solve(q).loadouts; // 60 builds, every total equal
    const usage = usageOf(q, returned.slice(0, 50), returned);
    for (const h of helmets) expect(usage.get(h.id)).toBe(true);
  });

  test("exotics count only when the query picked them", () => {
    const helm = (id: string) => piece(id, [30, 0, 0, 0, 0, 0], { exotic: true, hash: 9 });
    const any = input([[helm("601"), piece("602", [20, 0, 0, 0, 0, 0])], ...rest]);
    expect(usageOf(any).has("601")).toBe(false);
    const picked = input([[helm("601"), helm("603")], ...rest], {
      exotic: { mode: "specific", hashes: [9] },
    });
    const usage = usageOf(picked);
    expect(usage.has("601")).toBe(true);
    expect(usage.has("603")).toBe(true);
  });

  test("legendaries in the slot a picked exotic takes never had a chance", () => {
    const q = input(
      [
        [piece("701", [30, 0, 0, 0, 0, 0], { exotic: true, hash: 9 }), piece("702", [40, 0, 0, 0, 0, 0])],
        ...rest,
      ],
      { exotic: { mode: "specific", hashes: [9] } },
    );
    const usage = usageOf(q);
    expect(usage.get("701")).toBe(true);
    expect(usage.has("702")).toBe(false);
    expect(usage.get("201")).toBe(true);
  });

  test("synthetic pieces are left out", () => {
    const q = input([[piece("synthetic-ci", [30, 0, 0, 0, 0, 0])], ...rest]);
    expect(usageOf(q).has("synthetic-ci")).toBe(false);
  });
});

describe("queryIdentity", () => {
  const base = input([[piece("1", [1, 0, 0, 0, 0, 0])]], {
    setRequirements: [
      { setHash: 5, count: 2 },
      { setHash: 3, count: 2 },
    ],
    powerRange: { min: 10, max: 20, weapons: [300, 200] },
  });

  test("ignores the pool, the result cap, and incidental order", () => {
    const other: OptimizerInput = {
      ...base,
      slots: [[piece("2", [9, 0, 0, 0, 0, 0])]],
      maxResults: 10,
      setRequirements: [...base.setRequirements!].reverse(),
      mods: { minor: 0, major: 0 },
      powerRange: { weapons: [200, 300], max: 20, min: 10 },
    };
    expect(queryIdentity(other, 1)).toBe(queryIdentity(base, 1));
  });

  test("changes with the class and with any constraint", () => {
    expect(queryIdentity(base, 1)).not.toBe(queryIdentity(base, 2));
    expect(queryIdentity(base, 1)).not.toBe(
      queryIdentity({ ...base, minimums: [10, 0, 0, 0, 0, 0] }, 1),
    );
    expect(queryIdentity(base, 1)).not.toBe(queryIdentity({ ...base, allowTuning: true }, 1));
  });
});

describe("record wire format", () => {
  const key = "a".repeat(64);

  test("round-trips", () => {
    const pieces = [
      { id: "1", used: false },
      { id: "2", used: true },
    ];
    expect(decodeRecord(JSON.parse(JSON.stringify(encodeRecord(key, pieces))))).toEqual({
      key,
      pieces,
    });
  });

  test("rejects bad keys, ids, and flags", () => {
    expect(decodeRecord({ key: "nope", pieces: [["1", 0]] })).toBeNull();
    expect(decodeRecord({ key, pieces: [["abc", 0]] })).toBeNull();
    expect(decodeRecord({ key, pieces: [["1", 2]] })).toBeNull();
    expect(decodeRecord({ key, pieces: [] })).toBeNull();
  });
});

describe("usageBucket", () => {
  const n = MIN_ELIGIBLE_QUERIES;
  test("no rating until a piece has had enough searches", () => {
    expect(usageBucket(undefined)).toBe("unknown");
    expect(usageBucket({ eligible: n - 1, used: 0 })).toBe("unknown");
    expect(usageBucket({ eligible: n - 1, used: n - 1 })).toBe("unknown");
  });

  test("rates by the share of searches that used the piece", () => {
    expect(usageBucket({ eligible: 40, used: 0 })).toBe("never");
    expect(usageBucket({ eligible: 40, used: 3 })).toBe("rarely"); // 7.5%
    expect(usageBucket({ eligible: 40, used: 4 })).toBe("sometimes"); // 10%
    expect(usageBucket({ eligible: 40, used: 13 })).toBe("sometimes"); // 32.5%
    expect(usageBucket({ eligible: 40, used: 14 })).toBe("often"); // 35%
  });

  test("a piece in a saved loadout is often used, whatever its count", () => {
    expect(usageBucket(undefined, true)).toBe("often");
    expect(usageBucket({ eligible: 40, used: 0 }, true)).toBe("often");
  });

  test("loadoutPieceIds collects equipped items and optimizer builds", () => {
    const ids = loadoutPieceIds([
      { loadout: { equipped: [{ id: "1" }, {}] }, optimizer: { pieceIds: ["2"] } },
      { loadout: { equipped: [{ id: "3" }] } },
    ]);
    expect([...ids].sort()).toEqual(["1", "2", "3"]);
  });
});
