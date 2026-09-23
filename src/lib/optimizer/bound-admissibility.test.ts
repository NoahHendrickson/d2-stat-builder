/**
 * Never-optimistic guard for the shared prefix bound (makeJointMinCheck): whenever the
 * bound says "no completion from slot k can reach the minimums", brute-forcing EVERY
 * completion through the REAL leaf search (createTuningSearcher, feasible mode) must
 * find nothing. An inadmissible bound here silently under-reports stat ceilings — this
 * project's worst historical bug class — so this property test is the gate every bound
 * change must pass.
 *
 * The harness was validated against the pre-subset-mask bound first (it passed), so a
 * failure after a bound change indicts the change, not the harness.
 */
import { describe, expect, test } from "vitest";
import { mulberry32, randInt } from "./test-rng";
import { computeSuffixBounds, makeAdmissionBound, makeJointMinCheck } from "./bounds";
import { solveCeilings } from "./ceilings";
import {
  NUM_SLOTS,
  NUM_STATS,
  STAT_CAP,
  createTuningSearcher,
  makeInternalPiece,
  type InternalPiece,
} from "./tuning";
import { realWarlockSlots } from "./real-pool.fixture";
import type { ModBudget, OptimizerInput, OptimizerPiece } from "./types";

interface RandomCase {
  slots: InternalPiece[][];
  frag: number[];
  mods: ModBudget;
  mins: number[];
}

/**
 * A tiny random pool: 2–3 pieces/slot, 5-grain stats up to 55 (so five pieces plus
 * fragments and tuning routinely reach and exceed the 200 cap — the bounds' clamp
 * arithmetic has an upper arm that lower stats never exercise), a quarter of them
 * exotic (an exotic's flexible tuning has 30 directionals, the case the plain-minus
 * dominance rule was written for), random subsets of tuning options, artifice flags,
 * fragment bonuses (may be negative), mod budgets, and minimums. NO set requirements
 * — that constraint has a separate bound not under test. Completions are enumerated
 * without the ≤1-exotic rule: the bounds don't depend on it, so this only makes the
 * check stricter.
 */
function randomCase(rng: () => number): RandomCase {
  const slots: InternalPiece[][] = [];
  for (let k = 0; k < NUM_SLOTS; k++) {
    const n = randInt(rng, 2, 3);
    const pieces: InternalPiece[] = [];
    for (let i = 0; i < n; i++) {
      const stats = Array.from({ length: NUM_STATS }, () => 5 * randInt(rng, 0, 11));
      const p: OptimizerPiece = { id: `s${k}p${i}`, stats, exotic: rng() < 0.25 };
      const roll = rng();
      if (roll < 0.25) {
        p.artifice = true; // legacy piece: free +3 mod, no tuning
      } else if (roll < 0.7) {
        // Tier-5 tuning: a rolled tuned stat + 3 distinct off-archetype stats.
        const order = [0, 1, 2, 3, 4, 5];
        for (let j = order.length - 1; j > 0; j--) {
          const m = randInt(rng, 0, j);
          [order[j], order[m]] = [order[m], order[j]];
        }
        p.tuning = { tuned: order[0], offStats: order.slice(1, 4) };
      }
      pieces.push(makeInternalPiece(p, true, true));
    }
    slots.push(pieces);
  }
  const frag = Array.from({ length: NUM_STATS }, () =>
    rng() < 0.5 ? 0 : randInt(rng, -10, 10),
  );
  const mods: ModBudget = { major: randInt(rng, 0, 3), minor: randInt(rng, 0, 3) };
  // Mix of zero, 5-grain, and off-grain minimums (off-grain exercises the rounding),
  // scaled to the stat range so a good share of prefixes is genuinely infeasible.
  const mins = Array.from({ length: NUM_STATS }, () => {
    const r = rng();
    if (r < 0.4) return 0;
    if (r < 0.85) return 5 * randInt(rng, 1, 36);
    return randInt(rng, 1, 190);
  });
  return { slots, frag, mods, mins };
}

/**
 * Build canReachMin exactly the way runCeilings does: same computeSuffixBounds output,
 * same makeJointMinCheck arguments. The one place the harness touches the bound's
 * signature, so a signature change updates only this helper.
 */
function buildBound(c: RandomCase, sum: number[], sumTuneUp: number[], chosenArt: { n: number }) {
  const { suffixStat, subsetSuffix, artSuffix } = computeSuffixBounds(
    c.slots,
    [],
    false,
    () => false,
  );
  const maxModPoints = c.mods.major * 10 + c.mods.minor * 5;
  return makeJointMinCheck(
    c.mins,
    sum,
    sumTuneUp,
    c.frag,
    suffixStat,
    subsetSuffix,
    artSuffix,
    maxModPoints,
    chosenArt,
  );
}

describe("joint-min bound admissibility (never prunes a feasible completion)", () => {
  test("~200 seeded-random pools: bound=false ⇒ NO completion is feasible", () => {
    const rng = mulberry32(0xc0ffee);
    let prunedChecked = 0;
    for (let iter = 0; iter < 200; iter++) {
      const c = randomCase(rng);
      const tuner = createTuningSearcher(c.frag, c.mods);
      const sum = new Array(NUM_STATS).fill(0);
      const sumTuneUp = new Array(NUM_STATS).fill(0);
      const chosenArt = { n: 0 };
      const chosen: InternalPiece[] = new Array(NUM_SLOTS);
      const canReachMin = buildBound(c, sum, sumTuneUp, chosenArt);

      const addPiece = (k: number, p: InternalPiece): void => {
        chosen[k] = p;
        for (let s = 0; s < NUM_STATS; s++) {
          sum[s] += p.stats[s];
          sumTuneUp[s] += p.tuneStatUpside[s];
        }
        if (p.artifice) chosenArt.n++;
      };
      const removePiece = (k: number): void => {
        const p = chosen[k];
        for (let s = 0; s < NUM_STATS; s++) {
          sum[s] -= p.stats[s];
          sumTuneUp[s] -= p.tuneStatUpside[s];
        }
        if (p.artifice) chosenArt.n--;
      };

      // True iff SOME completion of slots k..4 meets the minimums, via the REAL leaf
      // search — the test must not reimplement mod/tuning semantics.
      const anyFeasibleCompletion = (k: number): boolean => {
        if (k === NUM_SLOTS) return tuner(chosen, sum, c.mins, "feasible") !== null;
        for (const p of c.slots[k]) {
          addPiece(k, p);
          const ok = anyFeasibleCompletion(k + 1);
          removePiece(k);
          if (ok) return true;
        }
        return false;
      };

      // Sample prefixes at every depth (k = 0 is the empty prefix; k = 5 a full combo).
      for (let k = 0; k <= NUM_SLOTS; k++) {
        for (let rep = 0; rep < 2; rep++) {
          if (k === 0 && rep > 0) break; // only one empty prefix
          for (let j = 0; j < k; j++) {
            addPiece(j, c.slots[j][randInt(rng, 0, c.slots[j].length - 1)]);
          }
          if (!canReachMin(k)) {
            prunedChecked++;
            expect(anyFeasibleCompletion(k), // if this fires: inadmissible bound
              `iter=${iter} k=${k} rep=${rep} prefix=${chosen
                .slice(0, k)
                .map((p) => p.id)
                .join(",")} mins=${c.mins} frag=${c.frag} mods=${JSON.stringify(c.mods)}`,
            ).toBe(false);
          }
          for (let j = k - 1; j >= 0; j--) removePiece(j);
        }
      }
    }
    // Coverage floor: the property is vacuous if the bound never fires. Deterministic
    // (seeded PRNG), so this is a fixed count, not a flaky threshold.
    expect(prunedChecked).toBeGreaterThan(100);
  });
});

describe("subset-mask suffix bound effectiveness", () => {
  /**
   * The profiled phantom-piece failure, distilled: every piece in every slot has total
   * 90 split between weapon (stat 0) and grenade (stat 3) in varying proportions, so the
   * per-stat suffix bound promises 450 to EACH of weapon and grenade — from different
   * pieces in the same slots — while any real completion supplies 450 across BOTH
   * combined. Minimums weapon 240 + grenade 300 make every weapon probe above 150
   * jointly impossible (mid + 300 > 450) yet per-stat reachable, so the old bound
   * disproves each one only by exhaustively walking the 19^5 pool.
   */
  function phantomPool(): OptimizerInput {
    const slots: OptimizerPiece[][] = Array.from({ length: NUM_SLOTS }, (_, k) =>
      Array.from({ length: 19 }, (_, i) => ({
        id: `s${k}p${i}`,
        stats: [90 - 5 * i, 0, 0, 5 * i, 0, 0],
        exotic: false,
      })),
    );
    return {
      slots,
      minimums: [240, 0, 0, 300, 0, 0],
      mods: { major: 0, minor: 0 },
      allowTuning: false,
      exotic: { mode: "any" },
    };
  }

  test("joint weapon+grenade infeasibility is disproven without an exhaustive walk", () => {
    const res = solveCeilings(phantomPool(), [0, 0, 0, 0, 0, 0], 10_000);
    // Hand-derived: probing weapon keeps grenade ≥ 300 → Σweapon ≤ 450−300 = 150, and
    // 150 is achievable (grenade 90+90+90+30+0 → weapon 0+0+0+60+90). Probing grenade
    // keeps weapon ≥ 240 → Σgrenade ≤ 210, above the 200 stat cap the optimistic side
    // starts at, so every grenade probe is feasible → 200. Other stats have no supply.
    expect(res.exact).toBe(true);
    expect(res.ceilings).toEqual([150, 0, 0, 200, 0, 0]);
    // Node budget for proving all of the above. Measured after the subset-mask bound
    // (2026-07-03): 467 nodes across 15 probes (every infeasible weapon probe dies at
    // the root; the rest is witness-finding for feasible probes) — the 20k threshold
    // is ~40x headroom on that, deterministic since nothing times out. Before the
    // subset-mask bound the same run burned 4,071,692 nodes disproving each joint
    // impossibility by exhaustive walk.
    expect(res.stats.nodes).toBeLessThan(20_000);
  });

  test("singleton masks coincide with the per-stat suffix bound on the real pool", () => {
    const slots = realWarlockSlots().map((sp) => sp.map((p) => makeInternalPiece(p, true, true)));
    const { suffixStat, subsetSuffix } = computeSuffixBounds(slots, [], false, () => false);
    for (let k = 0; k <= NUM_SLOTS; k++) {
      for (let s = 0; s < NUM_STATS; s++) {
        expect(subsetSuffix[k][1 << s], `k=${k} s=${s}`).toBe(suffixStat[k][s]);
      }
    }
  });
});

describe("top-N admission bound admissibility (never prunes a better completion)", () => {
  /**
   * The bound solve() prunes a prefix with, rebuilt from the same primitives: chosen
   * pieces' stats + credited tuning upside, the best the remaining slots can add
   * (suffixTotal), the mod-slack term (makeModUpside), the reachable artifice +3s and
   * the fragments' positive part. Brute-forcing every completion through the REAL leaf
   * search must never find a total above it — at every depth, including the leaf itself
   * (where the same bound gates the tuner).
   */
  test("~200 seeded-random pools: bound(k) ≥ the best total of every completion", () => {
    const rng = mulberry32(0xb0d1e5);
    let prefixesChecked = 0;
    let tightPrefixes = 0;
    // Coverage of the regimes the bound's reasoning turns on: pools where a stat can
    // reach the cap, and pools with exotics (30-directional tuning).
    let capReachable = 0;
    let withExotic = 0;
    for (let iter = 0; iter < 200; iter++) {
      const c = randomCase(rng);
      if (c.slots.some((slot) => slot.some((p) => p.exotic))) withExotic++;
      const tuner = createTuningSearcher(c.frag, c.mods);
      // Exactly as solve() builds it: top-N suffix bounds (tightened tuning credit for
      // these minimums + fragments) and the one admission-bound factory.
      const suffix = computeSuffixBounds(c.slots, [], false, () => false, {
        frag: c.frag,
        mins: c.mins,
      });
      const maxModPoints = c.mods.major * 10 + c.mods.minor * 5;
      if (suffix.suffixStat[0].some((v, s) => v + c.frag[s] >= STAT_CAP)) capReachable++;
      const sum = new Array(NUM_STATS).fill(0);
      const sumTuneDown = new Array(NUM_STATS).fill(0);
      const chosenArt = { n: 0 };
      const chosen: InternalPiece[] = new Array(NUM_SLOTS);
      const chosenIdx: number[] = new Array(NUM_SLOTS);
      const admission = makeAdmissionBound(
        c.slots,
        suffix,
        c.mins,
        sum,
        c.frag,
        sumTuneDown,
        maxModPoints,
        chosenArt,
      );

      const addPiece = (k: number, i: number): void => {
        const p = c.slots[k][i];
        chosen[k] = p;
        chosenIdx[k] = i;
        for (let s = 0; s < NUM_STATS; s++) {
          sum[s] += p.stats[s];
          sumTuneDown[s] += p.tuneStatDownside[s];
        }
        admission.push(k, i);
        if (p.artifice) chosenArt.n++;
      };
      const removePiece = (k: number): void => {
        const p = chosen[k];
        for (let s = 0; s < NUM_STATS; s++) {
          sum[s] -= p.stats[s];
          sumTuneDown[s] -= p.tuneStatDownside[s];
        }
        admission.pop(k, chosenIdx[k]);
        if (p.artifice) chosenArt.n--;
      };

      // Best maximize-mode total over every completion of slots k..4 (−1 if none feasible).
      const bestCompletion = (k: number): number => {
        if (k === NUM_SLOTS) return tuner(chosen, sum, c.mins, "maximize")?.total ?? -1;
        let best = -1;
        for (let i = 0; i < c.slots[k].length; i++) {
          addPiece(k, i);
          best = Math.max(best, bestCompletion(k + 1));
          removePiece(k);
        }
        return best;
      };

      for (let k = 0; k <= NUM_SLOTS; k++) {
        for (let rep = 0; rep < 2; rep++) {
          if (k === 0 && rep > 0) break;
          for (let j = 0; j < k; j++) {
            addPiece(j, randInt(rng, 0, c.slots[j].length - 1));
          }
          // Both admissible bounds solve() takes the min of; each must hold on its own.
          const positive = admission.positive(k);
          const net = admission.net(k);
          const best = bestCompletion(k);
          prefixesChecked++;
          if (best >= 0) {
            const ctx = `iter=${iter} k=${k} rep=${rep} prefix=${chosen
              .slice(0, k)
              .map((p) => p.id)
              .join(",")} mins=${c.mins} frag=${c.frag} mods=${JSON.stringify(c.mods)}`;
            expect(positive, `positive-parts bound: ${ctx}`).toBeGreaterThanOrEqual(best);
            expect(net, `net-tuning bound: ${ctx}`).toBeGreaterThanOrEqual(best);
            if (Math.min(positive, net) === best) tightPrefixes++;
          }
          for (let j = k - 1; j >= 0; j--) removePiece(j);
        }
      }
    }
    expect(prefixesChecked).toBeGreaterThan(1000);
    // The bound is exact somewhere (a leaf with no mods/tuning slack) — sanity that the
    // harness is comparing like with like, not two unrelated quantities.
    expect(tightPrefixes).toBeGreaterThan(0);
    // The generator must keep producing the two regimes above (a narrowed stat range or
    // exotic-free pools would silently stop testing the clamp arm and the 30-directional
    // dominance rule).
    expect(capReachable).toBeGreaterThan(50);
    expect(withExotic).toBeGreaterThan(100);
  });
});
