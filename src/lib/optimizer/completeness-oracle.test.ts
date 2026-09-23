/**
 * Independent correctness gates for the solver, from the 2026-09-21 calculation review.
 *
 * The existing property tests compare the solver against its own tuner, which pins
 * internal consistency but cannot show the tuner is COMPLETE. The oracle here is a
 * deliberately naive enumeration — every piece combination × every tuning option per
 * piece (including "no tune") × every stat/artifice mod covering — written from the game
 * rules alone, sharing nothing with the production pruning (`directionalsBranchable`,
 * the suffix bounds, `assignMods`). Pools are tiny so the enumeration is exhaustive.
 *
 * What it checks, per seeded-random query:
 *  - feasibility: the solver returns ≥1 build iff the oracle finds a legal assignment;
 *  - every returned build is legal and its recorded bonuses reconstruct its stats/total;
 *  - ceilings: an exact ceiling equals the oracle's true per-stat maximum; an inexact one
 *    is a lower bound with a proven upper above the truth (solvers on these pools are
 *    exact in practice; the branch is there so a budget hiccup can't flake the test).
 * Ranking is a product policy (Balanced-first, mods only cover targets) and is pinned by
 * the solver's own tests; here the solver's best total is only checked against the
 * oracle's unrestricted maximum as an upper bound.
 */
import { describe, expect, test } from "vitest";
import { mulberry32, randInt } from "./test-rng";
import { solve } from "./solve";
import { NUM_SLOTS, NUM_STATS, clamp } from "./floors";
import { createTuningSearcher, makeInternalPiece } from "./tuning";
import type {
  OptimizerInput,
  OptimizerLoadout,
  OptimizerPiece,
  SetRequirement,
} from "./types";

// ---------------------------------------------------------------------------
// The oracle
// ---------------------------------------------------------------------------

/** Every tuning delta a piece may take, from the rules (not from buildTuneOpts). */
function oracleTuneVecs(p: OptimizerPiece, input: OptimizerInput): number[][] {
  const zero = [0, 0, 0, 0, 0, 0];
  if ((input.allowTuning ?? true) === false || !p.tuning) return [zero];
  const out: number[][] = [zero];
  if (input.allowBalancedTuning ?? true) {
    const bal = zero.slice();
    for (const s of p.tuning.offStats) bal[s] += 1;
    out.push(bal);
  }
  const plusStats = p.exotic ? [0, 1, 2, 3, 4, 5] : [p.tuning.tuned];
  for (const plus of plusStats) {
    for (let minus = 0; minus < NUM_STATS; minus++) {
      if (minus === plus) continue;
      const v = zero.slice();
      v[plus] += 5;
      v[minus] -= 5;
      out.push(v);
    }
  }
  return out;
}

function exoticAllowed(p: OptimizerPiece, input: OptimizerInput): boolean {
  if (!p.exotic) return true;
  const mode = input.exotic?.mode ?? "any";
  if (mode === "none") return false;
  if (mode === "specific") return p.hash !== undefined && !!input.exotic?.hashes?.includes(p.hash);
  return true;
}

/**
 * Enumerate every covering of `deficits` (other-stat shortfalls) with the budgets and
 * report the best leftover mod points, plus whether any covering exists.
 */
function coverings(
  deficits: number[],
  major: number,
  minor: number,
  art: number,
): { feasible: boolean; bestLeftoverPoints: number } {
  let feasible = false;
  let best = -1;
  const rec = (s: number, M: number, m: number, A: number): void => {
    if (s === NUM_STATS) {
      feasible = true;
      const leftover = M * 10 + m * 5 + A * 3;
      if (leftover > best) best = leftover;
      return;
    }
    const d = deficits[s];
    if (d <= 0) {
      rec(s + 1, M, m, A);
      return;
    }
    for (let a = 0; a <= M; a++) {
      for (let b = 0; b <= m; b++) {
        for (let c = 0; c <= A; c++) {
          if (a * 10 + b * 5 + c * 3 >= d) rec(s + 1, M - a, m - b, A - c);
        }
      }
    }
  };
  rec(0, major, minor, art);
  return { feasible, bestLeftoverPoints: best };
}

interface OracleResult {
  feasible: boolean;
  /** Per stat: max final value subject to the OTHER five minimums (own ignored). */
  ceilings: number[];
  /** Max Σ clamp(final) over every legal assignment with mods placed anywhere. */
  bestTotalUpper: number;
}

function oracle(input: OptimizerInput): OracleResult {
  const mins = input.minimums;
  const frag = input.fragmentBonus ?? [0, 0, 0, 0, 0, 0];
  const major = input.mods?.major ?? 0;
  const minor = input.mods?.minor ?? 0;
  const reqs: SetRequirement[] = input.setRequirements ?? [];
  const mode = input.exotic?.mode ?? "any";
  const needExotic = mode === "require" || mode === "specific";
  const res: OracleResult = {
    feasible: false,
    ceilings: new Array(NUM_STATS).fill(0),
    bestTotalUpper: 0,
  };
  const chosen: OptimizerPiece[] = new Array(NUM_SLOTS);
  const deficits = new Array(NUM_STATS).fill(0);

  const evalCombo = (): void => {
    let exotics = 0;
    let art = 0;
    for (const p of chosen) {
      if (p.exotic) exotics++;
      if (p.artifice) art++;
    }
    if (exotics > 1) return;
    if (needExotic && exotics !== 1) return;
    for (const r of reqs) {
      if (chosen.filter((p) => p.setHash === r.setHash).length < r.count) return;
    }
    const vecs = chosen.map((p) => oracleTuneVecs(p, input));
    const pre = new Array(NUM_STATS).fill(0);
    const recTune = (i: number): void => {
      if (i === NUM_SLOTS) {
        // Full feasibility (all six minimums).
        for (let s = 0; s < NUM_STATS; s++) {
          deficits[s] = mins[s] > 0 && pre[s] < mins[s] ? mins[s] - pre[s] : 0;
        }
        const all = coverings(deficits, major, minor, art);
        if (all.feasible) {
          res.feasible = true;
          // Unrestricted total upper bound: every mod point placed at its best.
          // Points are placed one at a time into the stat with the most headroom;
          // an over-estimate is fine (this is an upper bound on the policy total).
          let total = 0;
          for (let s = 0; s < NUM_STATS; s++) total += clamp(pre[s]);
          let headroom = 0;
          for (let s = 0; s < NUM_STATS; s++) headroom += 200 - clamp(pre[s]);
          total += Math.min(headroom, major * 10 + minor * 5 + art * 3);
          if (total > res.bestTotalUpper) res.bestTotalUpper = total;
        }
        // Per-stat ceilings: cover the OTHER five, dump the rest into t.
        for (let t = 0; t < NUM_STATS; t++) {
          const saved = deficits[t];
          deficits[t] = 0;
          const c = coverings(deficits, major, minor, art);
          deficits[t] = saved;
          if (!c.feasible) continue;
          const v = clamp(pre[t] + c.bestLeftoverPoints);
          if (v > res.ceilings[t]) res.ceilings[t] = v;
        }
        return;
      }
      for (const v of vecs[i]) {
        for (let s = 0; s < NUM_STATS; s++) pre[s] += v[s];
        recTune(i + 1);
        for (let s = 0; s < NUM_STATS; s++) pre[s] -= v[s];
      }
    };
    for (let s = 0; s < NUM_STATS; s++) {
      pre[s] = frag[s];
      for (const p of chosen) pre[s] += p.stats[s];
    }
    recTune(0);
  };
  const recSlot = (k: number): void => {
    if (k === NUM_SLOTS) {
      evalCombo();
      return;
    }
    for (const p of input.slots[k]) {
      if (!exoticAllowed(p, input)) continue;
      chosen[k] = p;
      recSlot(k + 1);
    }
  };
  recSlot(0);
  return res;
}

// ---------------------------------------------------------------------------
// Legality + arithmetic reconstruction of a returned build
// ---------------------------------------------------------------------------

function checkLoadout(lo: OptimizerLoadout, input: OptimizerInput, ctx: string): void {
  const frag = input.fragmentBonus ?? [0, 0, 0, 0, 0, 0];
  const pieces = lo.pieceIds.map((id, k) => {
    const p = input.slots[k].find((q) => q.id === id);
    expect(p, `${ctx}: piece ${id} not in slot ${k}`).toBeDefined();
    return p!;
  });
  const exotics = pieces.filter((p) => p.exotic).length;
  expect(exotics, ctx).toBeLessThanOrEqual(1);
  const mode = input.exotic?.mode ?? "any";
  if (mode === "none") expect(exotics, ctx).toBe(0);
  if (mode === "require" || mode === "specific") expect(exotics, ctx).toBe(1);
  if (mode === "specific") {
    const ex = pieces.find((p) => p.exotic)!;
    expect(input.exotic?.hashes ?? [], ctx).toContain(ex.hash);
  }
  for (const r of input.setRequirements ?? []) {
    expect(pieces.filter((p) => p.setHash === r.setHash).length, ctx).toBeGreaterThanOrEqual(r.count);
  }
  // Tuning legality per piece.
  const tuningSum = [0, 0, 0, 0, 0, 0];
  lo.tuning.forEach((t, k) => {
    const p = pieces[k];
    if (t === null) return;
    expect(p.tuning, `${ctx}: untunable piece ${p.id} was tuned`).toBeDefined();
    expect(input.allowTuning ?? true, ctx).toBe(true);
    if (t.kind === "balanced") {
      expect(input.allowBalancedTuning ?? true, ctx).toBe(true);
      for (const s of p.tuning!.offStats) tuningSum[s] += 1;
    } else {
      if (!p.exotic) expect(t.plus, ctx).toBe(p.tuning!.tuned);
      expect(t.minus, ctx).not.toBe(t.plus);
      tuningSum[t.plus] += 5;
      tuningSum[t.minus] -= 5;
    }
  });
  expect(lo.tuningBonus, ctx).toEqual(tuningSum);
  // Mod budget + artifice budget.
  const major = input.mods?.major ?? 0;
  const minor = input.mods?.minor ?? 0;
  expect(lo.modsUsed.major, ctx).toBeLessThanOrEqual(major);
  expect(lo.modsUsed.minor, ctx).toBeLessThanOrEqual(minor);
  expect(lo.modBonus.reduce((a, b) => a + b, 0), ctx).toBeLessThanOrEqual(
    lo.modsUsed.major * 10 + lo.modsUsed.minor * 5,
  );
  const artPieces = pieces.filter((p) => p.artifice).length;
  const artPoints = lo.artificeBonus.reduce((a, b) => a + b, 0);
  expect(artPoints % 3, ctx).toBe(0);
  expect(artPoints / 3, ctx).toBeLessThanOrEqual(artPieces);
  // Arithmetic: components reconstruct the final stats and total; minimums met.
  let total = 0;
  for (let s = 0; s < NUM_STATS; s++) {
    let base = frag[s];
    for (const p of pieces) base += p.stats[s];
    const v = clamp(base + lo.tuningBonus[s] + lo.modBonus[s] + lo.artificeBonus[s]);
    expect(lo.stats[s], `${ctx}: stat ${s} reconstruction`).toBe(v);
    expect(lo.stats[s], `${ctx}: stat ${s} below minimum`).toBeGreaterThanOrEqual(
      Math.min(input.minimums[s], 200),
    );
    total += v;
  }
  expect(lo.total, ctx).toBe(total);
}

// ---------------------------------------------------------------------------
// Random queries
// ---------------------------------------------------------------------------

function randomPiece(rnd: () => number, id: string, opts: { exotic: boolean; tunable: boolean; artifice: boolean; setHash?: number }): OptimizerPiece {
  const idx = [0, 1, 2, 3, 4, 5];
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const stats = [5, 5, 5, 5, 5, 5];
  stats[idx[0]] = 30;
  stats[idx[1]] = 25;
  stats[idx[2]] = 20;
  // Occasionally a lower-tier / legacy-shaped roll (smaller numbers, no archetype).
  if (rnd() < 0.2) for (let s = 0; s < NUM_STATS; s++) stats[s] = randInt(rnd, 0, 22);
  const off = idx.slice(3).sort((a, b) => a - b);
  return {
    id,
    stats,
    exotic: opts.exotic,
    hash: opts.exotic ? 1000 + randInt(rnd, 0, 1) : undefined,
    setHash: opts.setHash,
    artifice: opts.artifice || undefined,
    tuning: opts.tunable ? { tuned: off[randInt(rnd, 0, 2)], offStats: off } : undefined,
  };
}

function randomQuery(rnd: () => number): OptimizerInput {
  const exoticSlot = rnd() < 0.5 ? randInt(rnd, 0, NUM_SLOTS - 1) : -1;
  const useSets = rnd() < 0.3;
  let tunableLegendaries = 0;
  let n = 0;
  const slots: OptimizerPiece[][] = Array.from({ length: NUM_SLOTS }, (_, k) =>
    Array.from({ length: randInt(rnd, 1, 2) }, (_, i) => {
      const exotic = k === exoticSlot && i === 0;
      let tunable = rnd() < 0.5;
      if (!exotic && tunable) {
        if (tunableLegendaries >= 3) tunable = false;
        else tunableLegendaries++;
      }
      const artifice = !tunable && rnd() < 0.3;
      return randomPiece(rnd, `p${n++}`, {
        exotic,
        tunable,
        artifice,
        setHash: useSets && rnd() < 0.6 ? 7 : undefined,
      });
    }),
  );
  const major = randInt(rnd, 0, 2);
  const minor = randInt(rnd, 0, 2);
  const frag = Array.from({ length: NUM_STATS }, () =>
    rnd() < 0.3 ? randInt(rnd, -2, 2) * 10 : 0,
  );
  // Minimums near a real completion so feasible and infeasible queries both occur —
  // including one-point targets (the UI allows any integer).
  const ref = slots.map((sp) => sp[randInt(rnd, 0, sp.length - 1)]);
  const mins = new Array(NUM_STATS).fill(0);
  for (let s = 0; s < NUM_STATS; s++) {
    if (rnd() < 0.5) continue;
    let v = frag[s];
    for (const p of ref) v += p.stats[s];
    v += randInt(rnd, -8, 12);
    mins[s] = Math.max(0, Math.min(200, v));
  }
  const exoticMode = exoticSlot < 0 ? "any" : (["any", "require", "specific", "none"] as const)[randInt(rnd, 0, 3)];
  const exoticHash = exoticSlot >= 0 ? slots[exoticSlot][0].hash : undefined;
  return {
    slots,
    minimums: mins,
    mods: { major, minor },
    fragmentBonus: frag,
    allowTuning: rnd() < 0.9,
    allowBalancedTuning: rnd() < 0.8,
    exotic:
      exoticMode === "specific"
        ? { mode: "specific", hashes: exoticHash !== undefined ? [exoticHash] : [] }
        : { mode: exoticMode },
    setRequirements: useSets ? [{ setHash: 7, count: 2 }] : [],
  };
}

const GENEROUS = { topNBudgetMs: 20_000, ceilingBudgetMs: 20_000 };

describe("independent exhaustive oracle", () => {
  test("feasibility, build legality, and ceilings agree on 160 seeded-random tiny pools", () => {
    const rnd = mulberry32(0x5eed5);
    let feasibleCases = 0;
    let exactCeilingCases = 0;
    for (let iter = 0; iter < 160; iter++) {
      const input = randomQuery(rnd);
      const ctx = `iter ${iter}: mins=${input.minimums} mods=${JSON.stringify(input.mods)} frag=${input.fragmentBonus} exotic=${JSON.stringify(input.exotic)} bal=${input.allowBalancedTuning} tune=${input.allowTuning}`;
      const truth = oracle(input);
      const out = solve(input, GENEROUS);
      expect(out.capped, ctx).toBe(false);
      expect(out.loadouts.length > 0, `${ctx}: feasibility`).toBe(truth.feasible);
      for (const lo of out.loadouts) checkLoadout(lo, input, ctx);
      if (out.loadouts.length) {
        expect(out.loadouts[0].total, `${ctx}: best total exceeds oracle upper`).toBeLessThanOrEqual(
          truth.bestTotalUpper,
        );
      }
      if (!truth.feasible) continue;
      feasibleCases++;
      for (let s = 0; s < NUM_STATS; s++) {
        expect(out.ceilings[s], `${ctx}: ceiling ${s} over-reported`).toBeLessThanOrEqual(
          truth.ceilings[s],
        );
        expect(out.ceilingUppers[s], `${ctx}: upper ${s} under the truth`).toBeGreaterThanOrEqual(
          truth.ceilings[s],
        );
      }
      if (out.ceilingsExact) {
        exactCeilingCases++;
        expect(out.ceilings, `${ctx}: exact ceilings differ from oracle`).toEqual(truth.ceilings);
      }
    }
    // Coverage floors — deterministic (seeded), so these are fixed counts, not flaky.
    expect(feasibleCases).toBeGreaterThan(40);
    expect(exactCeilingCases).toBeGreaterThan(40);
  });
});

describe("review finding 1 — compensating directional tunes", () => {
  const mk = (id: string, stats: number[], tuned: number, off: number[]): OptimizerPiece => ({
    id,
    stats,
    exotic: false,
    tuning: { tuned, offStats: off },
  });
  /**
   * Balanced everywhere gives [97,77,97,58,63,73] against targets [92,70,148,58,59,65]:
   * only class is short (by 51 — five majors leave one point). Arms' +5 class / −5 melee
   * bridges it but drops arms' Balanced +1 on grenade, leaving grenade one short — and
   * only helmet's +5 grenade / −5 health (a stat NOT short under Balanced) can bridge
   * that. A Balanced-time short-stat mask forbade helmet's directional, rejected the
   * build, and produced contradictory ceiling bounds.
   */
  const input: OptimizerInput = {
    slots: [
      [mk("h", [5, 20, 30, 5, 5, 25], 3, [0, 4, 3])],
      [mk("a", [5, 20, 5, 5, 25, 30], 2, [0, 2, 3])],
      [mk("c", [30, 25, 5, 20, 5, 5], 5, [4, 2, 5])],
      [mk("l", [30, 5, 25, 20, 5, 5], 1, [1, 4, 5])],
      [mk("ci", [25, 5, 30, 5, 20, 5], 1, [1, 3, 5])],
    ],
    minimums: [92, 70, 148, 58, 59, 65],
    mods: { major: 5, minor: 0 },
  };

  test("the legal build is returned with the compensating tune", () => {
    const out = solve(input, GENEROUS);
    expect(out.loadouts).toHaveLength(1);
    const lo = out.loadouts[0];
    expect(lo.stats).toEqual([95, 72, 151, 61, 62, 68]);
    expect(lo.tuning).toEqual([
      { kind: "directional", plus: 3, minus: 1 },
      { kind: "directional", plus: 2, minus: 5 },
      { kind: "balanced" },
      { kind: "balanced" },
      { kind: "balanced" },
    ]);
    checkLoadout(lo, input, "finding 1");
  });

  test("ceiling bounds are consistent and exact, and match the oracle", () => {
    const out = solve(input, GENEROUS);
    const truth = oracle(input);
    expect(truth.feasible).toBe(true);
    for (let s = 0; s < NUM_STATS; s++) {
      expect(out.ceilings[s]).toBeLessThanOrEqual(out.ceilingUppers[s]);
    }
    expect(out.ceilingsExact).toBe(true);
    expect(out.ceilings).toEqual(out.ceilingUppers);
    expect(out.ceilings).toEqual(truth.ceilings);
  });

  test("the tuner itself finds the assignment in both modes", () => {
    const chosen = input.slots.map((s) => makeInternalPiece(s[0], true, true, input.minimums));
    const sum = [0, 0, 0, 0, 0, 0];
    for (const p of chosen) for (let s = 0; s < NUM_STATS; s++) sum[s] += p.stats[s];
    const tuner = createTuningSearcher([0, 0, 0, 0, 0, 0], { major: 5, minor: 0 });
    expect(tuner(chosen, sum, input.minimums, "feasible")).not.toBeNull();
    const best = tuner(chosen, sum, input.minimums, "maximize");
    expect(best?.stats).toEqual([95, 72, 151, 61, 62, 68]);
  });
});

describe("review finding 3 — leftover artifice goes where it gains", () => {
  const ZERO6 = [0, 0, 0, 0, 0, 0];
  const internal = (p: Partial<OptimizerPiece> & { id: string }) =>
    makeInternalPiece({ stats: ZERO6.slice(), exotic: false, ...p }, true, true);
  const loadout = (artifice: number) =>
    Array.from({ length: NUM_SLOTS }, (_, i) =>
      internal({ id: `p${i}`, artifice: i < artifice, exotic: i < artifice }),
    );

  test("a stat below zero has the most raw room but no clamped gain", () => {
    // Weapons sits at 25 − 40 = −15 pre-clamp: +3 there is worth nothing; +3 on health
    // is worth the full 3. The old raw-room rule chose weapons (total 350).
    const search = createTuningSearcher([-40, 0, 0, 0, 0, 0], { major: 0, minor: 0 });
    const out = search(loadout(1), [25, 70, 70, 70, 70, 70], ZERO6.slice(), "maximize");
    expect(out).not.toBeNull();
    expect(out!.total).toBe(353);
    expect(out!.artificeBonus[0]).toBe(0);
    expect(out!.artificeBonus.reduce((a, b) => a + b, 0)).toBe(3);
  });

  test("near the cap a partial gain beats a zero gain", () => {
    // Health at 199 gains 1 from +3; weapons at −4 gains 0. Raw room says weapons.
    const search = createTuningSearcher([-4, 0, 0, 0, 0, 0], { major: 0, minor: 0 });
    const out = search(loadout(1), [0, 199, 200, 200, 200, 200], ZERO6.slice(), "maximize");
    expect(out).not.toBeNull();
    expect(out!.stats[1]).toBe(200);
    expect(out!.total).toBe(1000);
  });

  test("two mods together can lift a sub-zero stat that neither lifts alone", () => {
    // Weapons at −4: one +3 gains 0, two gain 2 (clamp(2)). Everything else is capped.
    const search = createTuningSearcher([-4, 0, 0, 0, 0, 0], { major: 0, minor: 0 });
    const out = search(loadout(2), [0, 200, 200, 200, 200, 200], ZERO6.slice(), "maximize");
    expect(out).not.toBeNull();
    expect(out!.stats[0]).toBe(2);
    expect(out!.total).toBe(1002);
    expect(out!.artifice.filter((a) => a !== null)).toHaveLength(2);
  });
});

describe("review finding 6 — the build budget is checked on internal nodes", () => {
  test("a walk pruned below the leaves still stops at its deadline", () => {
    // A walk with NO reachable leaves: slot 0 holds only exotics, slot 3 holds one
    // 100-total EXOTIC (the ≤1-exotic rule skips it under every prefix, so it is never
    // chosen — but it still inflates the suffix-total bound at depths ≤ 3) plus 30 zero
    // legendaries. With the heap pre-filled at total 50, the admission bound
    // (running + suffix ≤ worst) passes at depth 3 (0 + 100 > 50) and prunes every real
    // prefix at depth 4 (0 + 0 ≤ 50): 30·30·30·30 = 810,000 internal nodes, zero leaves.
    // A leaf-only clock check never fires here, so a 0 ms budget would run the whole
    // walk and report `capped: false`.
    // Stat-identical pieces dedupe to one representative per slot, which would collapse
    // the walk; distinct (unrequired) set hashes keep them apart without touching totals.
    // The one required set (hash 1, count 1) is met by slot 4's only piece, so set
    // pruning never fires — only the admission bound does.
    let n = 0;
    const zero = (id: string, exotic = false): OptimizerPiece => ({
      id,
      stats: [0, 0, 0, 0, 0, 0],
      exotic,
      hash: exotic ? 5000 + n : undefined,
      setHash: 100 + n++,
    });
    const many = (slot: string, exotic = false) =>
      Array.from({ length: 30 }, (_, i) => zero(`${slot}${i}`, exotic));
    const input: OptimizerInput = {
      slots: [
        many("a", true),
        many("b"),
        many("c"),
        [
          { id: "big", stats: [100, 0, 0, 0, 0, 0], exotic: true, hash: 7000, setHash: 999 },
          ...many("d"),
        ],
        [{ id: "e", stats: [0, 0, 0, 0, 0, 0], exotic: false, setHash: 1 }],
      ],
      minimums: [0, 0, 0, 0, 0, 0],
      mods: { major: 0, minor: 0 },
      setRequirements: [{ setHash: 1, count: 1 }],
      allowTuning: false,
    };
    const seed: OptimizerLoadout = {
      pieceIds: ["x", "x", "x", "x", "x"],
      baseStats: [50, 0, 0, 0, 0, 0],
      stats: [50, 0, 0, 0, 0, 0],
      tuningBonus: [0, 0, 0, 0, 0, 0],
      tuning: [null, null, null, null, null],
      modBonus: [0, 0, 0, 0, 0, 0],
      modsUsed: { major: 0, minor: 0 },
      artificeBonus: [0, 0, 0, 0, 0, 0],
      artifice: [null, null, null, null, null],
      total: 50,
      exotic: false,
      power: null,
    };
    const heapSeed = Array.from({ length: 200 }, (_, i) => ({ ...seed, pieceIds: [`s${i}`, "x", "x", "x", "x"] }));
    const out = solve(input, { topNBudgetMs: 0, ceilingBudgetMs: 0, heapSeed });
    expect(out.combosTried).toBe(0);
    expect(out.capped).toBe(true);
  });
});
