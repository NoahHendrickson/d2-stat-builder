import { describe, expect, test } from "vitest";
import { computeCeilingCarry, sameQueryExceptMinimums } from "./carryover";
import type {
  OptimizerInput,
  OptimizerLoadout,
  OptimizerOutput,
  OptimizerPiece,
} from "./types";

// A minimal legal 5-slot input. Every field left at its solver default so the tests can
// override exactly one thing at a time and assert the comparator's field sensitivity.
function piece(id: string, stats: number[], extra: Partial<OptimizerPiece> = {}): OptimizerPiece {
  return { id, stats, exotic: false, ...extra };
}

function baseInput(overrides: Partial<OptimizerInput> = {}): OptimizerInput {
  return {
    slots: [
      [piece("h", [30, 0, 0, 0, 0, 0])],
      [piece("a", [0, 20, 0, 0, 0, 0])],
      [piece("c", [0, 0, 10, 0, 0, 0])],
      [piece("l", [0, 0, 0, 40, 0, 0])],
      [piece("k", [0, 0, 0, 0, 15, 0])],
    ],
    minimums: [0, 0, 0, 0, 0, 0],
    ...overrides,
  };
}

// A stand-in output. ceilings are the achievable lows, ceilingUppers the proven uppers.
function output(overrides: Partial<OptimizerOutput> = {}): OptimizerOutput {
  return {
    loadouts: [],
    combosTried: 0,
    combosValid: 0,
    ceilings: [30, 20, 10, 40, 15, 0],
    ceilingUppers: [30, 20, 10, 40, 15, 0],
    ceilingsExact: true,
    capped: false,
    ...overrides,
  };
}

function loadout(stats: number[], modsUsed = { major: 0, minor: 0 }): OptimizerLoadout {
  return {
    pieceIds: ["h", "a", "c", "l", "k"],
    baseStats: stats,
    stats,
    tuningBonus: [0, 0, 0, 0, 0, 0],
    tuning: [null, null, null, null, null],
    modBonus: [0, 0, 0, 0, 0, 0],
    modsUsed,
    artificeBonus: [0, 0, 0, 0, 0, 0],
    artifice: [null, null, null, null, null],
    total: stats.reduce((a, b) => a + b, 0),
    exotic: false,
  };
}

describe("sameQueryExceptMinimums", () => {
  test("identical inputs (minimums aside) match", () => {
    expect(
      sameQueryExceptMinimums(
        baseInput({ minimums: [10, 0, 0, 0, 0, 0] }),
        baseInput({ minimums: [99, 0, 0, 0, 0, 0] }),
      ),
    ).toBe(true);
  });

  test("default normalization: mods undefined ≡ {major:0,minor:0}", () => {
    expect(
      sameQueryExceptMinimums(
        baseInput({ mods: undefined }),
        baseInput({ mods: { major: 0, minor: 0 } }),
      ),
    ).toBe(true);
  });

  test("default normalization: exotic undefined ≡ {mode:'any'}", () => {
    expect(
      sameQueryExceptMinimums(
        baseInput({ exotic: undefined }),
        baseInput({ exotic: { mode: "any" } }),
      ),
    ).toBe(true);
  });

  test("default normalization: allowTuning undefined ≡ true", () => {
    expect(
      sameQueryExceptMinimums(
        baseInput({ allowTuning: undefined }),
        baseInput({ allowTuning: true }),
      ),
    ).toBe(true);
  });

  test("default normalization: allowBalancedTuning undefined ≡ true", () => {
    expect(
      sameQueryExceptMinimums(
        baseInput({ allowBalancedTuning: undefined }),
        baseInput({ allowBalancedTuning: true }),
      ),
    ).toBe(true);
  });

  test("default normalization: fragmentBonus undefined ≡ zeros", () => {
    expect(
      sameQueryExceptMinimums(
        baseInput({ fragmentBonus: undefined }),
        baseInput({ fragmentBonus: [0, 0, 0, 0, 0, 0] }),
      ),
    ).toBe(true);
  });

  test("default normalization: maxResults undefined ≡ 200", () => {
    expect(
      sameQueryExceptMinimums(
        baseInput({ maxResults: undefined }),
        baseInput({ maxResults: 200 }),
      ),
    ).toBe(true);
  });

  test("default normalization: setRequirements undefined ≡ []", () => {
    expect(
      sameQueryExceptMinimums(
        baseInput({ setRequirements: undefined }),
        baseInput({ setRequirements: [] }),
      ),
    ).toBe(true);
  });

  test("setRequirements compare order-insensitively", () => {
    expect(
      sameQueryExceptMinimums(
        baseInput({
          setRequirements: [
            { setHash: 1, count: 2 },
            { setHash: 2, count: 4 },
          ],
        }),
        baseInput({
          setRequirements: [
            { setHash: 2, count: 4 },
            { setHash: 1, count: 2 },
          ],
        }),
      ),
    ).toBe(true);
  });

  test("different setRequirement count → not same", () => {
    expect(
      sameQueryExceptMinimums(
        baseInput({ setRequirements: [{ setHash: 1, count: 2 }] }),
        baseInput({ setRequirements: [{ setHash: 1, count: 4 }] }),
      ),
    ).toBe(false);
  });

  test("mods changed → not same", () => {
    expect(
      sameQueryExceptMinimums(
        baseInput({ mods: { major: 1, minor: 4 } }),
        baseInput({ mods: { major: 2, minor: 3 } }),
      ),
    ).toBe(false);
  });

  test("fragmentBonus changed → not same", () => {
    expect(
      sameQueryExceptMinimums(
        baseInput({ fragmentBonus: [0, 0, 10, 0, 0, 0] }),
        baseInput({ fragmentBonus: [0, 0, 0, 0, 0, 0] }),
      ),
    ).toBe(false);
  });

  test("allowTuning changed → not same", () => {
    expect(
      sameQueryExceptMinimums(
        baseInput({ allowTuning: true }),
        baseInput({ allowTuning: false }),
      ),
    ).toBe(false);
  });

  test("allowBalancedTuning changed → not same", () => {
    expect(
      sameQueryExceptMinimums(
        baseInput({ allowBalancedTuning: true }),
        baseInput({ allowBalancedTuning: false }),
      ),
    ).toBe(false);
  });

  test("exotic mode changed → not same", () => {
    expect(
      sameQueryExceptMinimums(
        baseInput({ exotic: { mode: "require" } }),
        baseInput({ exotic: { mode: "any" } }),
      ),
    ).toBe(false);
  });

  test("exotic hashes changed (specific) → not same", () => {
    expect(
      sameQueryExceptMinimums(
        baseInput({ exotic: { mode: "specific", hashes: [1, 2] } }),
        baseInput({ exotic: { mode: "specific", hashes: [1, 3] } }),
      ),
    ).toBe(false);
  });

  test("maxResults changed → not same", () => {
    expect(
      sameQueryExceptMinimums(
        baseInput({ maxResults: 200 }),
        baseInput({ maxResults: 50 }),
      ),
    ).toBe(false);
  });

  test("slot pool changed (piece stats differ) → not same", () => {
    const a = baseInput();
    const b = baseInput();
    b.slots[0] = [piece("h", [31, 0, 0, 0, 0, 0])];
    expect(sameQueryExceptMinimums(a, b)).toBe(false);
  });

  test("slot pool changed (piece count differs) → not same", () => {
    const a = baseInput();
    const b = baseInput();
    b.slots[0] = [...b.slots[0], piece("h2", [10, 0, 0, 0, 0, 0])];
    expect(sameQueryExceptMinimums(a, b)).toBe(false);
  });

  test("slot count differs → not same", () => {
    const a = baseInput();
    const b = baseInput();
    b.slots = b.slots.slice(0, 4);
    expect(sameQueryExceptMinimums(a, b)).toBe(false);
  });

  test("per-piece field changed (setHash) → not same", () => {
    const a = baseInput();
    const b = baseInput();
    b.slots[0] = [piece("h", [30, 0, 0, 0, 0, 0], { setHash: 5 })];
    expect(sameQueryExceptMinimums(a, b)).toBe(false);
  });

  test("per-piece field changed (tuning) → not same", () => {
    const a = baseInput();
    a.slots[0] = [piece("h", [30, 0, 0, 0, 0, 0], { tuning: { tuned: 0, offStats: [1, 2, 3] } })];
    const b = baseInput();
    b.slots[0] = [piece("h", [30, 0, 0, 0, 0, 0], { tuning: { tuned: 1, offStats: [1, 2, 3] } })];
    expect(sameQueryExceptMinimums(a, b)).toBe(false);
  });

  test("per-piece field changed (artifice) → not same", () => {
    const a = baseInput();
    const b = baseInput();
    b.slots[0] = [piece("h", [30, 0, 0, 0, 0, 0], { artifice: true })];
    expect(sameQueryExceptMinimums(a, b)).toBe(false);
  });

  test("per-piece stats reference reuse still matches (fast path)", () => {
    const sharedStats = [30, 0, 0, 0, 0, 0];
    const a = baseInput();
    a.slots[0] = [piece("h", sharedStats)];
    const b = baseInput();
    b.slots[0] = [piece("h", sharedStats)];
    expect(sameQueryExceptMinimums(a, b)).toBe(true);
  });
});

describe("computeCeilingCarry", () => {
  const prevInput = baseInput({ minimums: [10, 10, 0, 0, 0, 0] });
  const prevOutput = output({
    ceilings: [30, 20, 10, 40, 15, 0],
    ceilingUppers: [30, 20, 10, 40, 15, 0],
  });

  test("returns undefined when the query differs beyond minimums", () => {
    const next = baseInput({ minimums: [10, 10, 0, 0, 0, 0], allowTuning: false });
    expect(computeCeilingCarry(prevInput, prevOutput, next)).toBeUndefined();
  });

  test("malformed minimums (wrong length) → undefined (carry nothing on doubt)", () => {
    // A short minimums array would read undefined past its end and degrade to "equal",
    // wrongly carrying both seeds. The length guard must reject it outright — on either side.
    const shortPrev = baseInput({ minimums: [10, 10, 0] });
    const shortNext = baseInput({ minimums: [10, 10, 0] });
    const okInput = baseInput({ minimums: [10, 10, 0, 0, 0, 0] });
    expect(computeCeilingCarry(shortPrev, prevOutput, okInput)).toBeUndefined();
    expect(computeCeilingCarry(okInput, prevOutput, shortNext)).toBeUndefined();
  });

  test("EQUAL minimums → carries both seeds", () => {
    const next = baseInput({ minimums: [10, 10, 0, 0, 0, 0] });
    const carry = computeCeilingCarry(prevInput, prevOutput, next);
    expect(carry).toEqual({
      ceilingSeed: prevOutput.ceilings,
      ceilingUpperSeed: prevOutput.ceilingUppers,
    });
  });

  test("LOOSENED minimums → carries ceilingSeed only (uppers invalid)", () => {
    const next = baseInput({ minimums: [5, 10, 0, 0, 0, 0] });
    const carry = computeCeilingCarry(prevInput, prevOutput, next);
    expect(carry).toEqual({ ceilingSeed: prevOutput.ceilings });
    expect(carry?.ceilingUpperSeed).toBeUndefined();
  });

  test("MIXED minimums → undefined (no per-stat salvage)", () => {
    const next = baseInput({ minimums: [5, 20, 0, 0, 0, 0] });
    expect(computeCeilingCarry(prevInput, prevOutput, next)).toBeUndefined();
  });

  describe("TIGHTENED minimums", () => {
    const tightInput = baseInput({ minimums: [15, 15, 0, 0, 0, 0] });
    const survivors = output({
      ceilings: [30, 20, 10, 40, 15, 0],
      ceilingUppers: [30, 20, 10, 40, 15, 0],
      // Two stored loadouts; only the first meets the new mins [15,15,...].
      loadouts: [loadout([20, 20, 10, 40, 15, 0]), loadout([12, 20, 10, 40, 15, 0])],
    });

    test("keeps proven uppers", () => {
      const carry = computeCeilingCarry(prevInput, survivors, tightInput);
      expect(carry?.ceilingUpperSeed).toEqual(survivors.ceilingUppers);
    });

    test("seeds lows from surviving loadouts only", () => {
      const carry = computeCeilingCarry(prevInput, survivors, tightInput);
      // Only loadout([20,20,10,40,15,0]) survives (12 < 15 on weapons drops the other).
      // No spare mods → each stat's seed is its own value from the survivor.
      expect(carry?.ceilingSeed).toEqual([20, 20, 10, 40, 15, 0]);
    });

    test("no surviving loadouts → no ceilingSeed key", () => {
      const noSurvivors = output({
        loadouts: [loadout([12, 20, 10, 40, 15, 0])], // fails weapon ≥15
      });
      const carry = computeCeilingCarry(prevInput, noSurvivors, tightInput);
      expect(carry?.ceilingUpperSeed).toEqual(noSurvivors.ceilingUppers);
      expect(carry && "ceilingSeed" in carry).toBe(false);
    });

    test("a loadout failing a SINGLE stat is dropped", () => {
      const oneFails = output({
        // meets weapon ≥15 but NOT health ≥15 (health 14) → dropped
        loadouts: [loadout([30, 14, 10, 40, 15, 0])],
      });
      const carry = computeCeilingCarry(prevInput, oneFails, tightInput);
      expect(carry && "ceilingSeed" in carry).toBe(false);
    });

    test("spare mods raise every stat's seed by the spare budget", () => {
      const withSpare = output({
        loadouts: [
          // meets [15,15,...]; 2 unused minor mods = 10 spare points → each stat +10
          loadout([15, 15, 10, 40, 15, 0], { major: 0, minor: 0 }),
        ],
      });
      const tightMods = baseInput({
        minimums: [15, 15, 0, 0, 0, 0],
        mods: { major: 0, minor: 2 },
      });
      const prevWithMods = baseInput({
        minimums: [10, 10, 0, 0, 0, 0],
        mods: { major: 0, minor: 2 },
      });
      const carry = computeCeilingCarry(prevWithMods, withSpare, tightMods);
      // spare = 2 minor * 5 = 10, added to every stat (clamped at 200)
      expect(carry?.ceilingSeed).toEqual([25, 25, 20, 50, 25, 10]);
    });
  });
});
