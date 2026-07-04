import { expect, test } from "vitest";
import { beats, runSolveSession } from "./session";
import { solve } from "./solve";
import type { OptimizerInput, OptimizerOutput, OptimizerPiece } from "./types";
import { realWarlockCodaInput, realWarlockTwoSetInput } from "./real-pool.fixture";

type SessionEvent =
  | { type: "progress"; value: number }
  | { type: "better"; output: OptimizerOutput }
  | { type: "result"; output: OptimizerOutput; refining: boolean; verified: boolean };

/**
 * Every posted result must carry proven per-stat uppers that dominate its ceilings, and
 * its exactness flag must equal the elementwise ceilings===uppers equality.
 */
function assertUpperInvariants(out: OptimizerOutput) {
  let allEqual = true;
  for (let s = 0; s < 6; s++) {
    expect(out.ceilings[s]).toBeLessThanOrEqual(out.ceilingUppers[s]);
    if (out.ceilings[s] !== out.ceilingUppers[s]) allEqual = false;
  }
  expect(out.ceilingsExact).toBe(allEqual);
}

function collector() {
  const events: SessionEvent[] = [];
  const results = () =>
    events.filter((e) => e.type === "result") as Extract<
      SessionEvent,
      { type: "result" }
    >[];
  const better = () =>
    events.filter((e) => e.type === "better") as Extract<
      SessionEvent,
      { type: "better" }
    >[];
  return {
    events,
    results,
    better,
    cb: {
      onProgress: (value: number) => events.push({ type: "progress", value }),
      onCeilings: () => {},
      onBetter: (output: OptimizerOutput) => events.push({ type: "better", output }),
      onResult: (output: OptimizerOutput, refining: boolean, verified: boolean) =>
        events.push({ type: "result", output, refining, verified }),
    },
  };
}

test("an uncapped search posts exactly one final, verified result", () => {
  const piece = (id: string, stats: number[]): OptimizerPiece => ({
    id,
    stats,
    exotic: false,
  });
  const input: OptimizerInput = {
    slots: [
      [piece("h", [30, 0, 0, 0, 0, 0])],
      [piece("a", [0, 20, 0, 0, 0, 0])],
      [piece("c", [0, 0, 10, 0, 0, 0])],
      [piece("l", [0, 0, 0, 40, 0, 0])],
      [piece("k", [0, 0, 0, 0, 15, 0])],
    ],
    minimums: [0, 0, 0, 0, 0, 0],
    allowTuning: false,
  };
  const { results, better, cb } = collector();
  runSolveSession(input, cb);
  expect(results()).toHaveLength(1);
  expect(results()[0].refining).toBe(false);
  expect(results()[0].verified).toBe(true);
  expect(results()[0].output.capped).toBe(false);
  expect(better()).toHaveLength(0);
});

const realInput = realWarlockCodaInput;

/**
 * A pool with a DETERMINISTIC capped-walk blind spot: slot 0's first-enumerated piece
 * (h-weapon) fronts 17^4 = 83,521 feasible fillers-only completions — more than the
 * 65,536 leaves a 1ms budget covers before its first clock check — while the best
 * builds hide behind the second piece (h-spread). h-weapon builds pile weapon past the
 * 200 clamp (best total 260, measured); h-spread builds spread the same 90 points
 * unclamped (best 339). Nothing prunes the h-weapon subtree: minimums are zero and the
 * top-N admission bound (runningTotal + suffixTotal = 450) always beats the heap's
 * worst (≤ 264), so the cap fires mid-subtree by construction.
 *
 * This used to use realWarlockCodaInput (measured capped best 483 vs true 486), but the
 * subset-mask suffix bound tightened the walk enough that its 65,536-leaf window now
 * covers that pool's entire top-200 — the offer path needs a blind spot no admissible
 * per-stat/subset bound can close (only a clamp-aware TOTAL bound could, a deliberate
 * non-goal; see the dominance note in solve.ts).
 */
function blindSpotInput(): OptimizerInput {
  const p = (id: string, stats: number[]): OptimizerPiece => ({
    id,
    stats,
    exotic: false,
  });
  const filler = (slot: string): OptimizerPiece[] =>
    Array.from({ length: 17 }, (_, j) => p(`${slot}${j}`, [90 - j, j, 0, 0, 0, 0]));
  return {
    slots: [
      [p("h-weapon", [90, 0, 0, 0, 0, 0]), p("h-spread", [15, 15, 15, 15, 15, 15])],
      filler("a"),
      filler("c"),
      filler("l"),
      filler("k"),
    ],
    minimums: [0, 0, 0, 0, 0, 0],
    mods: { major: 0, minor: 0 },
    allowTuning: false,
  };
}

test("a capped search freezes its list, refines ceilings, and offers a better list", () => {
  const input = blindSpotInput();
  const { events, results, better, cb } = collector();
  runSolveSession(input, cb, {
    topNBudgetMs: 1,
    ceilingBudgetMs: 50,
    refineCeilingBudgetMs: 30_000,
    refineTopNBudgetMs: 60_000,
  });

  expect(results()).toHaveLength(2);
  const [interim, final] = results();
  expect(interim.refining).toBe(true);
  expect(interim.output.capped).toBe(true);
  expect(final.refining).toBe(false);
  expect(final.verified).toBe(true); // background build search ran to exhaustion

  // The shown build list is FROZEN: the final post repeats the capped list verbatim
  // (and stays flagged capped — it is still a best-effort list for these targets).
  expect(final.output.loadouts).toEqual(interim.output.loadouts);
  expect(final.output.capped).toBe(true);
  // With a 30s budget the refinement settles every stat — the final post must carry
  // the proven-exact flag (the "Verified" claim in the UI hangs off it).
  expect(final.output.ceilingsExact).toBe(true);
  // Every posted result carries proven uppers ≥ its ceilings; exact ⇔ they're equal.
  assertUpperInvariants(interim.output);
  assertUpperInvariants(final.output);

  // Ceilings only ever rise across the refinement…
  for (let s = 0; s < 6; s++) {
    expect(final.output.ceilings[s]).toBeGreaterThanOrEqual(
      interim.output.ceilings[s],
    );
  }
  // …and land on the same exact values a full uncapped solve computes.
  const reference = solve(input, { topNBudgetMs: 60_000, ceilingBudgetMs: 30_000 });
  expect(reference.capped).toBe(false);
  expect(final.output.ceilings).toEqual(reference.ceilings);

  // The 1ms window covered 65,536 of 167,042 leaves — all inside the h-weapon subtree
  // (best total 260) — so the exhaustive pass, which finds the h-spread builds (best
  // 339), must offer a rank-wise better list.
  expect(better()).toHaveLength(1);
  const offered = better()[0].output;
  assertUpperInvariants(offered);
  expect(offered.capped).toBe(false);
  expect(offered.loadouts.length).toBeGreaterThanOrEqual(
    interim.output.loadouts.length,
  );
  for (let i = 0; i < interim.output.loadouts.length; i++) {
    expect(offered.loadouts[i].total).toBeGreaterThanOrEqual(
      interim.output.loadouts[i].total,
    );
  }
  expect(beats(offered, interim.output)).toBe(true);
  // The offered list matches what the reference exhaustive solve finds — this now
  // also pins the heapSeed path (pass 2 seeds its heap from the frozen list) against
  // an unseeded reference…
  expect(offered.loadouts.map((l) => l.total)).toEqual(
    reference.loadouts.map((l) => l.total),
  );
  // …and heap seeding must never produce duplicate builds in the offered list.
  const keys = offered.loadouts.map((l) => l.pieceIds.join("|"));
  expect(new Set(keys).size).toBe(keys.length);

  // Background progress is monotone (never restarts across the two phases): every
  // progress event after the interim result post only ever rises.
  const interimIdx = events.findIndex((e) => e.type === "result");
  const refineProgress = events
    .slice(interimIdx + 1)
    .flatMap((e) => (e.type === "progress" ? [e.value] : []));
  expect(refineProgress.length).toBeGreaterThan(0);
  for (let i = 1; i < refineProgress.length; i++) {
    expect(refineProgress[i]).toBeGreaterThanOrEqual(refineProgress[i - 1] - 1e-9);
  }
  // And the better offer arrives before the final result.
  const betterIdx = events.findIndex((e) => e.type === "better");
  const finalIdx = events.findLastIndex((e) => e.type === "result");
  expect(betterIdx).toBeGreaterThan(interimIdx);
  expect(betterIdx).toBeLessThan(finalIdx);
}, 180_000);

// Noah's 81-vs-85 report (2026-07-03): a heavily constrained query (specific exotic +
// two 2pc sets) finishes the build walk well inside its budget, but the joint weapon/
// grenade minimums make the ceiling probes expensive enough to blow THEIR budget — an
// uncapped solve with ceilingsExact=false. The session used to end right there, freezing
// unproven lower bounds as the displayed maxima.
test("an uncapped search with inexact ceilings refines them in the background", () => {
  const input = realWarlockTwoSetInput();
  const { results, better, cb } = collector();
  runSolveSession(input, cb, {
    topNBudgetMs: 60_000, // the walk completes uncapped
    ceilingBudgetMs: 10, // …but the ceilings can't settle in-line
    refineCeilingBudgetMs: 120_000, // background refinement converges
  });

  expect(results()).toHaveLength(2);
  const [interim, final] = results();
  // The build walk ran to exhaustion, so even the interim post is a verified list…
  expect(interim.refining).toBe(true);
  expect(interim.output.capped).toBe(false);
  expect(interim.verified).toBe(true);
  expect(interim.output.ceilingsExact).toBe(false);
  // …and the final post repeats it verbatim (the list was never in question).
  expect(final.refining).toBe(false);
  expect(final.verified).toBe(true);
  expect(final.output.loadouts).toEqual(interim.output.loadouts);
  // The refinement settles every stat and must prove strictly more headroom than the
  // in-line pass found (this query under-reports several stats at the small budget).
  expect(final.output.ceilingsExact).toBe(true);
  for (let s = 0; s < 6; s++) {
    expect(final.output.ceilings[s]).toBeGreaterThanOrEqual(
      interim.output.ceilings[s],
    );
  }
  expect(
    final.output.ceilings.some((v, s) => v > interim.output.ceilings[s]),
  ).toBe(true);
  // No phase-2 build search runs: an exhaustive walk can't beat itself.
  expect(better()).toHaveLength(0);
}, 180_000);

test("a ceilings-only refinement that also times out stays honest", () => {
  const input = realWarlockTwoSetInput();
  const { results, better, cb } = collector();
  runSolveSession(input, cb, {
    topNBudgetMs: 60_000,
    ceilingBudgetMs: 10,
    refineCeilingBudgetMs: 10, // background refinement expires too
  });
  expect(results()).toHaveLength(2);
  const [interim, final] = results();
  expect(final.verified).toBe(true); // the WALK was exhaustive…
  expect(final.output.ceilingsExact).toBe(false); // …but the ceilings stay unproven
  expect(final.output.loadouts).toEqual(interim.output.loadouts);
  // Both posts stay honest: proven uppers dominate their ceilings, and the unproven
  // exactness is consistent with the ceilings/uppers pair (some stat still short).
  assertUpperInvariants(interim.output);
  assertUpperInvariants(final.output);
  expect(better()).toHaveLength(0);
}, 60_000);

test("an unverified background pass never claims exhaustion", () => {
  const input = realInput();
  const { results, better, cb } = collector();
  runSolveSession(input, cb, {
    topNBudgetMs: 1,
    ceilingBudgetMs: 50,
    refineCeilingBudgetMs: 50,
    refineTopNBudgetMs: 1, // background build search also caps
  });
  expect(results()).toHaveLength(2);
  const [interim, final] = results();
  expect(final.verified).toBe(false);
  expect(final.output.loadouts).toEqual(interim.output.loadouts);
  // A pending offer is allowed only if strictly better; either way the frozen list
  // stands and nothing claims exhaustion.
  for (const { output: offered } of better()) {
    expect(beats(offered, interim.output)).toBe(true);
  }
}, 60_000);
