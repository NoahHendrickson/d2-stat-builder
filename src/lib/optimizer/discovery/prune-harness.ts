/**
 * Prune-admissibility harness for the DFS walks in solve.ts (top-N) and ceilings.ts
 * (probes), under the constraints bound-admissibility.test.ts leaves out: set
 * requirements, exotic require/specific/none, power ranges, and pools that went through
 * `buildSlots` (exotic filter + dedupe + sort).
 *
 * The audit walks EVERY prefix of the deduped pool (no pruning), keeping the same
 * accumulators solve()'s recurse() keeps, and at each prefix evaluates every prune the
 * walks use. Each prune's claim is then checked against the brute-forced subtree under it:
 *  - canReachMin(k) false        ⇒ no completion passes the real tuner (feasible mode)
 *  - canReachSets(k) false       ⇒ no completion meets every set requirement
 *  - exotic suffix prune         ⇒ no completion holds any exotic
 *  - nextExoticCount(..) < 0     ⇒ no completion through that child is exotic-legal
 *  - power.feasible(k) false     ⇒ no completion's floor(mean) gear power is in range
 *  - admission bound(k)          ≥ the best maximize total of every completion
 * plus power-tracker leaf exactness, probe-mins joint checks (the ceiling walk), and
 * cannotBeat() consistency with the exposed positive/net bounds.
 *
 * "Completion" is deliberately the UNRESTRICTED set (any piece per remaining slot, ≤1
 * exotic not enforced) for each per-constraint prune — every bound here is a relaxation
 * that ignores the other constraints, so the stricter check is still sound — and the
 * violations are tagged with whether a LEGAL completion (exotic rule + sets + power)
 * also breaks the claim, which is the contract solve() actually depends on.
 */
import { buildSlots, computeSuffixBounds, makeAdmissionBound, makeJointMinCheck, nextExoticCount } from "../bounds";
import { NUM_SLOTS, NUM_STATS, STAT_CAP } from "../floors";
import { createPowerTracker } from "../power";
import { createTuningSearcher, makeInternalPiece, type InternalPiece } from "../tuning";
import { randInt } from "../test-rng";
import type { OptimizerInput, OptimizerPiece, PowerRange, SetRequirement } from "../types";

// ---------------------------------------------------------------------------
// Independent rule implementations (from the game rules, not from the walk)
// ---------------------------------------------------------------------------

/** floor(mean) gear power over known-power pieces + weapons; null with nothing known. */
export function bruteGearPower(pieces: readonly { power?: number }[], weapons: readonly number[]): number | null {
  let n = 0;
  let s = 0;
  for (const w of weapons) {
    n++;
    s += w;
  }
  for (const p of pieces) {
    if (p.power === undefined) continue;
    n++;
    s += p.power;
  }
  if (n === 0) return null;
  return Math.floor(s / n);
}

export function powerInRange(pieces: readonly { power?: number }[], range: PowerRange | undefined): boolean {
  if (!range) return true;
  const g = bruteGearPower(pieces, range.weapons ?? []);
  if (g === null) return true; // policy: nothing known ⇒ passes any range
  return g >= range.min && g <= range.max;
}

export function setsMet(pieces: readonly { setHash?: number }[], reqs: SetRequirement[]): boolean {
  for (const r of reqs) {
    let n = 0;
    for (const p of pieces) if (p.setHash === r.setHash) n++;
    if (n < r.count) return false;
  }
  return true;
}

export function exoticLegal(pieces: readonly { exotic: boolean; hash?: number }[], input: OptimizerInput): boolean {
  const mode = input.exotic?.mode ?? "any";
  let n = 0;
  for (const p of pieces) {
    if (!p.exotic) continue;
    n++;
    if (mode === "none") return false;
    if (mode === "specific" && (p.hash === undefined || !(input.exotic?.hashes ?? []).includes(p.hash))) return false;
  }
  if (n > 1) return false;
  if ((mode === "require" || mode === "specific") && n !== 1) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export type PruneKind =
  | "canReachMin"
  | "canReachMin-probe"
  | "canReachSets"
  | "exoticSuffix"
  | "nextExoticCount"
  | "powerPrefix"
  | "powerLeafExact"
  | "admission-positive"
  | "admission-net"
  | "cannotBeat-consistency"
  | "suffix-topN-drift";

export interface Violation {
  kind: PruneKind;
  k: number;
  prefix: string[];
  detail: string;
  /** True when a LEGAL completion (exotic rule + sets + power) also contradicts the prune. */
  legal: boolean;
}

export interface AuditStats {
  nodes: number;
  leaves: number;
  fired: Record<string, number>;
  /** Prefixes where the admission bound was exactly equal to the best completion. */
  admissionTight: number;
  /** min over prefixes of (bound − best legal) — how close the harness came. */
  admissionMinSlack: number;
}

interface Agg {
  /** Per mins-vector: some completion passes the tuner (feasible mode). */
  feas: boolean[];
  /** Same, restricted to legal completions. */
  feasLegal: boolean[];
  sets: boolean;
  setsLegalOther: boolean; // sets met by a completion that is exotic-legal + power-ok
  anyExotic: boolean;
  exoLegal: boolean;
  exoLegalFull: boolean; // exotic-legal AND sets AND power (legal ignoring stats)
  power: boolean;
  powerLegalOther: boolean;
  best: number;
  bestLegal: number;
}

export interface AuditOptions {
  /** Extra minimum vectors to check the ceiling-probe joint check with. */
  probeMins?: number[][];
}

/**
 * Walk every prefix of buildSlots(input) and check each prune against brute force.
 * Returns the violations found (never throws on a violation).
 */
export function auditPrunes(input: OptimizerInput, opts: AuditOptions = {}): { violations: Violation[]; stats: AuditStats } {
  const violations: Violation[] = [];
  const stats: AuditStats = { nodes: 0, leaves: 0, fired: {}, admissionTight: 0, admissionMinSlack: Infinity };
  const fire = (k: string) => (stats.fired[k] = (stats.fired[k] ?? 0) + 1);

  const slots = buildSlots(input);
  if (slots.length !== NUM_SLOTS || slots.some((s) => s.length === 0)) return { violations, stats };

  const min = input.minimums;
  const mods = input.mods ?? { major: 0, minor: 0 };
  const maxModPoints = mods.major * 10 + mods.minor * 5;
  const frag = input.fragmentBonus ?? new Array(NUM_STATS).fill(0);
  const reqs = input.setRequirements ?? [];
  const exoticMode = input.exotic?.mode ?? "any";
  const needExotic = exoticMode === "require" || exoticMode === "specific";
  const weapons = input.powerRange?.weapons ?? [];

  // Exactly as solve() builds them.
  const suffix = computeSuffixBounds(slots, reqs, needExotic, (p) => p.exotic, { frag, mins: min });
  const { suffixStat, setSuffix, exoticSuffix, artSuffix, subsetSuffix } = suffix;
  // runCeilings' own (option-less) call must agree on every field the probes read.
  {
    const plain = computeSuffixBounds(slots, reqs, needExotic, (p) => p.exotic);
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    if (
      !same(plain.suffixStat, suffixStat) ||
      !same(plain.setSuffix, setSuffix) ||
      !same(plain.exoticSuffix, exoticSuffix) ||
      !same(plain.artSuffix, artSuffix) ||
      !same(plain.subsetSuffix, subsetSuffix)
    ) {
      violations.push({ kind: "suffix-topN-drift", k: 0, prefix: [], detail: "probe-read fields differ", legal: true });
    }
  }

  const sum = new Array(NUM_STATS).fill(0);
  const sumTuneUp = new Array(NUM_STATS).fill(0);
  const sumTuneDown = new Array(NUM_STATS).fill(0);
  const chosen: InternalPiece[] = new Array(NUM_SLOTS);
  const setCounts = new Array(reqs.length).fill(0);
  const chosenArt = { n: 0 };
  const power = createPowerTracker(slots, input.powerRange);
  const tuner = createTuningSearcher(frag, mods);

  const minsList: number[][] = [min, ...(opts.probeMins ?? [])];
  const checks = minsList.map((m) =>
    makeJointMinCheck(m, sum, sumTuneUp, frag, suffixStat, subsetSuffix, artSuffix, maxModPoints, chosenArt),
  );
  const canReachSets = (k: number): boolean => {
    for (let r = 0; r < reqs.length; r++) if (setCounts[r] + setSuffix[r][k] < reqs[r].count) return false;
    return true;
  };
  const admission = makeAdmissionBound(slots, suffix, min, sum, frag, sumTuneDown, maxModPoints, chosenArt);

  const prefixIds = (k: number) => chosen.slice(0, k).map((p) => p.id);

  const rec = (k: number, exoticCount: number): Agg => {
    stats.nodes++;
    // Evaluate every prune at this prefix BEFORE descending (the accumulators are live).
    const reach = checks.map((c) => c(k));
    const setsOk = canReachSets(k);
    const exoPrune = needExotic && exoticCount + exoticSuffix[k] < 1;
    const powerOk = power ? power.feasible(k) : true;
    const pos = admission.positive(k);
    const net = admission.net(k);
    const bound = Math.min(pos, net);
    if (admission.cannotBeat(k, bound - 1) || !admission.cannotBeat(k, bound)) {
      violations.push({
        kind: "cannotBeat-consistency",
        k,
        prefix: prefixIds(k),
        detail: `bound=${bound} cannotBeat(b-1)=${admission.cannotBeat(k, bound - 1)} cannotBeat(b)=${admission.cannotBeat(k, bound)}`,
        legal: true,
      });
    }

    let agg: Agg;
    if (k === NUM_SLOTS) {
      stats.leaves++;
      const feas = minsList.map((m) => tuner(chosen, sum, m, "feasible") !== null);
      const best = tuner(chosen, sum, min, "maximize");
      const exo = exoticLegal(chosen, input);
      const st = setsMet(chosen, reqs);
      const pw = powerInRange(chosen, input.powerRange);
      // Power tracker exactness at the leaf.
      if (power && powerOk !== pw) {
        violations.push({
          kind: "powerLeafExact",
          k,
          prefix: prefixIds(k),
          detail: `tracker=${powerOk} brute=${pw} gear=${bruteGearPower(chosen, weapons)} range=${JSON.stringify(input.powerRange)} powers=${chosen.map((p) => p.power)}`,
          legal: exo && st,
        });
      }
      const legalNoStats = exo && st && pw;
      agg = {
        feas,
        feasLegal: feas.map((f) => f && legalNoStats),
        sets: st,
        setsLegalOther: st && exo && pw,
        anyExotic: chosen.some((p) => p.exotic),
        exoLegal: exo,
        exoLegalFull: legalNoStats,
        power: pw,
        powerLegalOther: pw && exo && st,
        best: best ? best.total : -1,
        bestLegal: best && legalNoStats ? best.total : -1,
      };
    } else {
      agg = {
        feas: minsList.map(() => false),
        feasLegal: minsList.map(() => false),
        sets: false,
        setsLegalOther: false,
        anyExotic: false,
        exoLegal: false,
        exoLegalFull: false,
        power: false,
        powerLegalOther: false,
        best: -1,
        bestLegal: -1,
      };
      for (let i = 0; i < slots[k].length; i++) {
        const p = slots[k][i];
        const nextExotic = nextExoticCount(exoticCount, p, k, needExotic, exoticSuffix);
        for (let s = 0; s < NUM_STATS; s++) {
          sum[s] += p.stats[s];
          sumTuneUp[s] += p.tuneStatUpside[s];
          sumTuneDown[s] += p.tuneStatDownside[s];
        }
        admission.push(k, i);
        if (p.artifice) chosenArt.n++;
        for (let r = 0; r < reqs.length; r++) if (p.setHash === reqs[r].setHash) setCounts[r]++;
        power?.push(p);
        chosen[k] = p;
        const child = rec(k + 1, exoticCount + (p.exotic ? 1 : 0));
        if (nextExotic < 0) {
          fire("nextExoticCount");
          if (child.exoLegal) {
            violations.push({
              kind: "nextExoticCount",
              k: k + 1,
              prefix: prefixIds(k + 1),
              detail: `nextExotic=${nextExotic} but an exotic-legal completion exists`,
              legal: child.exoLegalFull,
            });
          }
        }
        power?.pop(p);
        for (let r = 0; r < reqs.length; r++) if (p.setHash === reqs[r].setHash) setCounts[r]--;
        if (p.artifice) chosenArt.n--;
        admission.pop(k, i);
        for (let s = 0; s < NUM_STATS; s++) {
          sum[s] -= p.stats[s];
          sumTuneUp[s] -= p.tuneStatUpside[s];
          sumTuneDown[s] -= p.tuneStatDownside[s];
        }
        for (let j = 0; j < minsList.length; j++) {
          agg.feas[j] ||= child.feas[j];
          agg.feasLegal[j] ||= child.feasLegal[j];
        }
        agg.sets ||= child.sets;
        agg.setsLegalOther ||= child.setsLegalOther;
        agg.anyExotic ||= child.anyExotic;
        agg.exoLegal ||= child.exoLegal;
        agg.exoLegalFull ||= child.exoLegalFull;
        agg.power ||= child.power;
        agg.powerLegalOther ||= child.powerLegalOther;
        if (child.best > agg.best) agg.best = child.best;
        if (child.bestLegal > agg.bestLegal) agg.bestLegal = child.bestLegal;
      }
    }

    // Now compare each prune's claim with the brute-forced subtree.
    const ids = prefixIds(k);
    for (let j = 0; j < minsList.length; j++) {
      if (reach[j]) continue;
      fire(j === 0 ? "canReachMin" : "canReachMin-probe");
      if (agg.feas[j]) {
        violations.push({
          kind: j === 0 ? "canReachMin" : "canReachMin-probe",
          k,
          prefix: ids,
          detail: `mins=${minsList[j]} pruned but a completion is tuner-feasible`,
          legal: agg.feasLegal[j],
        });
      }
    }
    if (!setsOk) {
      fire("canReachSets");
      if (agg.sets) {
        violations.push({ kind: "canReachSets", k, prefix: ids, detail: "pruned but a completion meets sets", legal: agg.setsLegalOther });
      }
    }
    if (exoPrune) {
      fire("exoticSuffix");
      if (agg.anyExotic) {
        violations.push({ kind: "exoticSuffix", k, prefix: ids, detail: "pruned but a completion holds an exotic", legal: agg.exoLegalFull });
      }
    }
    if (!powerOk && k < NUM_SLOTS) {
      fire("powerPrefix");
      if (agg.power) {
        violations.push({
          kind: "powerPrefix",
          k,
          prefix: ids,
          detail: `pruned but a completion is in range ${JSON.stringify(input.powerRange)}`,
          legal: agg.powerLegalOther,
        });
      }
    }
    if (agg.best >= 0) {
      const slack = bound - agg.best;
      if (agg.bestLegal >= 0) {
        if (bound - agg.bestLegal < stats.admissionMinSlack) stats.admissionMinSlack = bound - agg.bestLegal;
        if (bound === agg.bestLegal) stats.admissionTight++;
      }
      if (slack < 0) fire("admission-violated");
      if (pos < agg.best) {
        violations.push({
          kind: "admission-positive",
          k,
          prefix: ids,
          detail: `positive=${pos} net=${net} best=${agg.best} bestLegal=${agg.bestLegal}`,
          legal: agg.bestLegal > pos,
        });
      }
      if (net < agg.best) {
        violations.push({
          kind: "admission-net",
          k,
          prefix: ids,
          detail: `positive=${pos} net=${net} best=${agg.best} bestLegal=${agg.bestLegal}`,
          legal: agg.bestLegal > net,
        });
      }
    }
    return agg;
  };
  rec(0, 0);
  return { violations, stats };
}

// ---------------------------------------------------------------------------
// Brute force over the RAW pool (no dedupe) for the end-to-end checks
// ---------------------------------------------------------------------------

export interface RawTruth {
  feasible: boolean;
  /** Every legal raw combo's maximize total, descending. */
  totals: number[];
  /** True per-stat max subject to the other five minimums (0 when nothing qualifies). */
  ceilings: number[];
}

export function rawTruth(input: OptimizerInput, withCeilings = true): RawTruth {
  const allowTuning = input.allowTuning ?? true;
  const allowBalanced = input.allowBalancedTuning ?? true;
  const mins = input.minimums;
  const frag = input.fragmentBonus ?? new Array(NUM_STATS).fill(0);
  const mods = input.mods ?? { major: 0, minor: 0 };
  const reqs = input.setRequirements ?? [];
  const tuner = createTuningSearcher(frag, mods);
  const slots = input.slots.map((s) => s.map((p) => ({ raw: p, ip: makeInternalPiece(p, allowTuning, allowBalanced, mins) })));
  const chosen: InternalPiece[] = new Array(NUM_SLOTS);
  const raws: OptimizerPiece[] = new Array(NUM_SLOTS);
  const sum = new Array(NUM_STATS).fill(0);
  const totals: number[] = [];
  const ceilings = new Array(NUM_STATS).fill(0);
  const probe = mins.slice();
  let feasible = false;
  const leaf = () => {
    if (!exoticLegal(raws, input) || !setsMet(raws, reqs) || !powerInRange(raws, input.powerRange)) return;
    const best = tuner(chosen, sum, mins, "maximize");
    if (best) {
      feasible = true;
      totals.push(best.total);
    }
    if (!withCeilings) return;
    for (let t = 0; t < NUM_STATS; t++) {
      // Find the highest v with the leaf feasible under mins[t] := v (monotone in v).
      const ok = (v: number) => {
        probe[t] = v;
        const r = tuner(chosen, sum, probe, "feasible") !== null;
        probe[t] = mins[t];
        return r;
      };
      if (ceilings[t] >= STAT_CAP || !ok(ceilings[t] + 1)) continue;
      let lo = ceilings[t] + 1;
      let hi = STAT_CAP;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (ok(mid)) lo = mid;
        else hi = mid - 1;
      }
      ceilings[t] = lo;
    }
  };
  const rec = (k: number) => {
    if (k === NUM_SLOTS) return leaf();
    for (const { raw, ip } of slots[k]) {
      chosen[k] = ip;
      raws[k] = raw;
      for (let s = 0; s < NUM_STATS; s++) sum[s] += raw.stats[s];
      rec(k + 1);
      for (let s = 0; s < NUM_STATS; s++) sum[s] -= raw.stats[s];
    }
  };
  rec(0);
  totals.sort((a, b) => b - a);
  return { feasible, totals, ceilings };
}

/** Every legal combo over the DEDUPED pool: maximize totals, descending. */
export function dedupedTotals(input: OptimizerInput): number[] {
  const slots = buildSlots(input);
  const out: number[] = [];
  if (slots.some((s) => s.length === 0)) return out;
  const frag = input.fragmentBonus ?? new Array(NUM_STATS).fill(0);
  const tuner = createTuningSearcher(frag, input.mods ?? { major: 0, minor: 0 });
  const reqs = input.setRequirements ?? [];
  const chosen: InternalPiece[] = new Array(NUM_SLOTS);
  const sum = new Array(NUM_STATS).fill(0);
  const rec = (k: number) => {
    if (k === NUM_SLOTS) {
      if (!exoticLegal(chosen, input) || !setsMet(chosen, reqs) || !powerInRange(chosen, input.powerRange)) return;
      const best = tuner(chosen, sum, input.minimums, "maximize");
      if (best) out.push(best.total);
      return;
    }
    for (const p of slots[k]) {
      chosen[k] = p;
      for (let s = 0; s < NUM_STATS; s++) sum[s] += p.stats[s];
      rec(k + 1);
      for (let s = 0; s < NUM_STATS; s++) sum[s] -= p.stats[s];
    }
  };
  rec(0);
  return out.sort((a, b) => b - a);
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

export interface GenCoverage {
  cases: number;
  withPower: number;
  withWeapons: number;
  powerMinGtMax: number;
  withSets: number;
  setReqs: number;
  exoticModes: Record<string, number>;
  withArtifice: number;
  noBalanced: number;
  noTuning: number;
  negFrag: number;
  profile: Record<string, number>;
  dupes: number;
}

export function emptyCoverage(): GenCoverage {
  return {
    cases: 0,
    withPower: 0,
    withWeapons: 0,
    powerMinGtMax: 0,
    withSets: 0,
    setReqs: 0,
    exoticModes: {},
    withArtifice: 0,
    noBalanced: 0,
    noTuning: 0,
    negFrag: 0,
    profile: {},
    dupes: 0,
  };
}

const shuffle = (rng: () => number, a: number[]) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(rng, 0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const pick = <T,>(rng: () => number, xs: readonly T[]): T => xs[randInt(rng, 0, xs.length - 1)];

type Profile = "random" | "tier5" | "nearCap" | "nearZero" | "lowGrain";

function genStats(rng: () => number, profile: Profile): number[] {
  switch (profile) {
    case "random":
      return Array.from({ length: NUM_STATS }, () => (rng() < 0.6 ? 5 * randInt(rng, 0, 11) : randInt(rng, 0, 55)));
    case "tier5": {
      const o = shuffle(rng, [0, 1, 2, 3, 4, 5]);
      const st = [5, 5, 5, 5, 5, 5];
      st[o[0]] = 30;
      st[o[1]] = 25;
      st[o[2]] = 20;
      return st;
    }
    case "nearCap":
      // Some stats ~38–44 per piece: five pieces land near 190–220, around the 200 cap.
      return Array.from({ length: NUM_STATS }, () => (rng() < 0.5 ? randInt(rng, 37, 44) : randInt(rng, 0, 30)));
    case "nearZero":
      return Array.from({ length: NUM_STATS }, () => (rng() < 0.5 ? randInt(rng, 0, 3) : randInt(rng, 0, 30)));
    case "lowGrain":
      return Array.from({ length: NUM_STATS }, () => randInt(rng, 0, 12));
  }
}

export interface GenOptions {
  /** Upper bound on the raw combo count (keeps brute force cheap). */
  maxCombos?: number;
  /**
   * Allow Balanced-only (`directional: false`) EXOTICS (default true). Production never
   * builds one (dream exotics always take directionals); dedupe merges them with
   * directional-capable twins (FINDING B), so the green end-to-end run turns them off.
   */
  exoticBalancedOnly?: boolean;
}

/**
 * A small random OptimizerInput with every constraint the walks prune on: set
 * requirements, exotic modes with hashes, a power range (+ weapons, unknown-power and
 * power-0 pieces, min>max, exact-boundary ranges), artifice, directional-capable
 * exotics, Balanced-only pieces, fragments (often negative), and minimums placed near a
 * real completion's Balanced/untuned values (±1 edges, 5-grain and off-grain deficits).
 */
export function genInput(rng: () => number, cov?: GenCoverage, gopts: GenOptions = {}): OptimizerInput {
  const maxCombos = gopts.maxCombos ?? 1000;
  const profile: Profile = pick(rng, ["random", "tier5", "nearCap", "nearZero", "lowGrain"] as const);
  const SETS = [11, 22];
  const HASHES = [901, 902, 903];
  const basePower = 2000;
  const usePower = rng() < 0.5;
  const powerSpread = pick(rng, [0, 1, 3, 10]);
  let id = 0;
  const mkPiece = (k: number): OptimizerPiece => {
    const stats = genStats(rng, profile);
    const exotic = rng() < 0.25;
    const p: OptimizerPiece = { id: `s${k}p${id++}`, stats, exotic };
    if (exotic && rng() < 0.9) p.hash = pick(rng, HASHES);
    if (rng() < 0.55) p.setHash = pick(rng, SETS);
    const roll = rng();
    if (roll < 0.2) p.artifice = true;
    else if (roll < 0.75) {
      const o = shuffle(rng, [0, 1, 2, 3, 4, 5]);
      p.tuning = { tuned: o[0], offStats: o.slice(1, 4).sort((a, b) => a - b) };
      if (rng() < 0.12) p.tuning.directional = false;
    }
    if (usePower) {
      const r = rng();
      if (r < 0.12) p.power = undefined;
      else if (r < 0.18) p.power = 0;
      else p.power = basePower + randInt(rng, -powerSpread, powerSpread);
    }
    return p;
  };
  const slots: OptimizerPiece[][] = [];
  let combos = 1;
  for (let k = 0; k < NUM_SLOTS; k++) {
    const room = Math.max(1, Math.floor(maxCombos / combos / Math.pow(2, NUM_SLOTS - k - 1)));
    const n = Math.min(randInt(rng, 1, 5), Math.max(1, room));
    const pieces: OptimizerPiece[] = [];
    for (let i = 0; i < n; i++) {
      if (pieces.length && rng() < 0.15) {
        // A near-duplicate: same stats, maybe a different power / tuned stat / id —
        // exercises dedupe's equivalence key.
        const src = pick(rng, pieces);
        const d: OptimizerPiece = { ...src, id: `s${k}p${id++}`, stats: src.stats.slice() };
        if (src.tuning) d.tuning = { ...src.tuning, offStats: src.tuning.offStats.slice() };
        if (rng() < 0.5 && d.power !== undefined) d.power = d.power + pick(rng, [-1, 0, 1]);
        if (rng() < 0.3 && d.tuning) d.tuning.tuned = pick(rng, [0, 1, 2, 3, 4, 5]);
        if (rng() < 0.2 && d.tuning) {
          if (d.tuning.directional === false) delete d.tuning.directional;
          else d.tuning.directional = false;
        }
        if (cov) cov.dupes++;
        pieces.push(d);
      } else pieces.push(mkPiece(k));
    }
    combos *= pieces.length;
    slots.push(pieces);
  }
  if (gopts.exoticBalancedOnly === false) {
    // Post-pass (keeps the rng stream, so a seed yields the same pool otherwise).
    for (const sp of slots) for (const p of sp) if (p.exotic && p.tuning?.directional === false) delete p.tuning.directional;
  }

  // Fragments: zero, small, negative, or chosen to pin a stat at exactly 0 / −5.
  const fragMode = rng();
  const frag = Array.from({ length: NUM_STATS }, () => {
    if (fragMode < 0.3) return 0;
    const r = rng();
    if (r < 0.4) return 0;
    if (r < 0.7) return 10 * randInt(rng, -3, 3);
    return randInt(rng, -30, 20);
  });
  const ref = slots.map((sp) => pick(rng, sp));
  if (rng() < 0.2) {
    // Fragment that makes the reference combo's stat exactly 0 or −5.
    const s = randInt(rng, 0, NUM_STATS - 1);
    let v = 0;
    for (const p of ref) v += p.stats[s];
    frag[s] = -v - pick(rng, [0, 5, 1, -1]);
  }
  if (rng() < 0.15) {
    // Fragment that puts the reference stat at exactly 200 / 205 / 195.
    const s = randInt(rng, 0, NUM_STATS - 1);
    let v = 0;
    for (const p of ref) v += p.stats[s];
    frag[s] = pick(rng, [195, 200, 205, 199, 201]) - v;
  }

  const allowTuning = rng() < 0.85;
  const allowBalancedTuning = rng() < 0.75;
  const major = randInt(rng, 0, 3);
  const minor = randInt(rng, 0, Math.min(3, 5 - major));

  // Minimums: random, or anchored on the reference combo's default-option values.
  const mins = new Array(NUM_STATS).fill(0);
  const anchor = rng() < 0.65;
  const refDefault = new Array(NUM_STATS).fill(0);
  for (let s = 0; s < NUM_STATS; s++) {
    refDefault[s] = frag[s];
    for (const p of ref) refDefault[s] += p.stats[s];
  }
  if (allowTuning && allowBalancedTuning) {
    for (const p of ref) if (p.tuning) for (const s of p.tuning.offStats) refDefault[s] += 1;
  }
  for (let s = 0; s < NUM_STATS; s++) {
    const r = rng();
    if (r < 0.5) continue;
    if (anchor) {
      const delta = pick(rng, [-3, -1, -1, 0, 0, 1, 1, 2, 3, 4, 5, 6, 9, 10, 11, 13]);
      mins[s] = Math.max(0, Math.min(200, refDefault[s] + delta));
    } else if (r < 0.75) mins[s] = 5 * randInt(rng, 1, 40);
    else mins[s] = pick(rng, [1, 2, 3, 4, 6, 199, 200, randInt(rng, 1, 200)]);
  }

  const input: OptimizerInput = {
    slots,
    minimums: mins,
    mods: { major, minor },
    fragmentBonus: frag,
    allowTuning,
    allowBalancedTuning,
  };

  // Sets.
  if (rng() < 0.45) {
    const n = randInt(rng, 1, 2);
    const reqs: SetRequirement[] = [];
    const hs = shuffle(rng, SETS.slice());
    for (let i = 0; i < n; i++) reqs.push({ setHash: hs[i], count: pick(rng, [1, 1, 2, 2, 2, 3, 3, 4, 5]) });
    input.setRequirements = reqs;
  }

  // Exotic mode.
  const m = pick(rng, ["any", "any", "none", "require", "specific", "specific"] as const);
  if (m === "specific") {
    input.exotic = { mode: "specific", hashes: pick(rng, [[901], [901], [901, 902], [902, 903], [999]]) };
  } else input.exotic = { mode: m };

  // Power range around the reference combo's gear power.
  if (usePower) {
    const weapons: number[] = [];
    const nw = pick(rng, [0, 0, 1, 2, 3]);
    for (let i = 0; i < nw; i++) weapons.push(basePower + randInt(rng, -powerSpread - 2, powerSpread + 2));
    const g = bruteGearPower(ref, weapons) ?? basePower;
    const lo = g + randInt(rng, -2, 2);
    const span = pick(rng, [-1, 0, 0, 1, 2, 5]);
    input.powerRange = { min: lo, max: lo + span, ...(nw > 0 ? { weapons } : {}) };
    if (rng() < 0.1) input.powerRange.min = 0;
  }

  input.maxResults = randInt(rng, 1, 4);

  // ---- Targeted post-passes (drawn AFTER everything above, so earlier seeds keep
  // their pools). Each one aims at a regime random generation almost never reaches.
  const edges: string[] = [];
  // (a) Mostly-unknown power (theoretical pieces), often with no weapons: the only way a
  //     loadout ends with zero known items, which passes any range.
  if (input.powerRange && rng() < 0.3) {
    for (const sp of slots) for (const p of sp) if (rng() < 0.7) p.power = undefined;
    if (rng() < 0.6) delete input.powerRange.weapons;
    edges.push("unknownPower");
  }
  // (b) A twin that differs from an existing piece in exactly one dedupe-relevant field
  //     (set, artifice, exotic, hash, power, tuned stat, offStats).
  if (rng() < 0.35) {
    const k = randInt(rng, 0, NUM_SLOTS - 1);
    const src = pick(rng, slots[k]);
    const d: OptimizerPiece = { ...src, id: `s${k}p${id++}`, stats: src.stats.slice() };
    if (src.tuning) d.tuning = { ...src.tuning, offStats: src.tuning.offStats.slice() };
    const field = pick(rng, ["set", "artifice", "exotic", "hash", "power", "tuned", "off"] as const);
    if (field === "set") d.setHash = d.setHash === SETS[0] ? SETS[1] : SETS[0];
    else if (field === "artifice") d.artifice = !d.artifice;
    else if (field === "exotic") d.exotic = !d.exotic;
    else if (field === "hash") d.hash = d.hash === 901 ? 902 : 901;
    else if (field === "power") d.power = d.power === undefined ? basePower : undefined;
    else if (d.tuning && field === "tuned") d.tuning.tuned = (d.tuning.tuned + 1) % NUM_STATS;
    else if (d.tuning) d.tuning.offStats = [0, 1, 2, 3, 4, 5].filter((s) => s !== d.tuning!.tuned).slice(0, 3);
    if (rng() < 0.5) slots[k].unshift(d);
    else slots[k].push(d);
    edges.push(`twin:${field}`);
  }
  // (c) A tiny positive minimum on a stat whose reference value is ≤ 0 (negative
  //     fragment), with artifice around: the zero-clamp slack's `fromMin` arm.
  if (rng() < 0.25) {
    const neg = [0, 1, 2, 3, 4, 5].filter((s) => refDefault[s] <= 0);
    if (neg.length) {
      const s = pick(rng, neg);
      mins[s] = pick(rng, [1, 2, 3, 4, 5, 6]);
      if (rng() < 0.7) for (const sp of slots) if (rng() < 0.5) pick(rng, sp).artifice = true;
      edges.push("tinyMinOnNegative");
    }
  }
  // (d) A small deficit a single minor closes with spare minors around and Balanced off:
  //     a directional's −5 on that stat is then absorbed by an extra minor (mods are
  //     free), which the mod-slack bound must still cover.
  if (allowTuning && rng() < 0.2) {
    input.allowBalancedTuning = false;
    input.mods = { major: randInt(rng, 0, 1), minor: randInt(rng, 2, 4) };
    let raw = new Array(NUM_STATS).fill(0);
    raw = raw.map((_, s) => frag[s] + ref.reduce((a, p) => a + p.stats[s], 0));
    const s = randInt(rng, 0, NUM_STATS - 1);
    mins[s] = Math.max(1, Math.min(200, raw[s] + pick(rng, [1, 2, 3, 4, 5])));
    // Another stat that only a directional can reach.
    const t = (s + randInt(rng, 1, NUM_STATS - 1)) % NUM_STATS;
    mins[t] = Math.max(1, Math.min(200, raw[t] + pick(rng, [1, 3, 5, 6, 8, 10])));
    edges.push("modAbsorbedMinus");
  }
  // (e) Exact-boundary power range: min = max = the reference gear power, or ±1.
  if (input.powerRange && rng() < 0.2) {
    const g = bruteGearPower(ref, input.powerRange.weapons ?? []);
    if (g !== null) {
      input.powerRange.min = g + pick(rng, [0, 0, 1]);
      input.powerRange.max = g + pick(rng, [0, 0, -1]);
      edges.push("exactPower");
    }
  }
  // (f) A negative fragment that puts the POOL's lowest completion of a stat at exactly
  //     −1 / 0 / +1 — the edge of fragmentCredit's "counts in full" rule.
  if (rng() < 0.15) {
    const s = randInt(rng, 0, NUM_STATS - 1);
    let poolMin = 0;
    for (const sp of slots) poolMin += Math.min(...sp.map((p) => p.stats[s]));
    frag[s] = -poolMin + pick(rng, [-1, -1, 0, 1]);
    edges.push("fragAtPoolMin");
  }
  if (cov) for (const e of edges) cov.profile[`edge:${e}`] = (cov.profile[`edge:${e}`] ?? 0) + 1;

  if (cov) {
    cov.cases++;
    cov.profile[profile] = (cov.profile[profile] ?? 0) + 1;
    if (input.powerRange) {
      cov.withPower++;
      if (input.powerRange.weapons?.length) cov.withWeapons++;
      if (input.powerRange.min > input.powerRange.max) cov.powerMinGtMax++;
    }
    if (input.setRequirements?.length) {
      cov.withSets++;
      cov.setReqs += input.setRequirements.length;
    }
    cov.exoticModes[m] = (cov.exoticModes[m] ?? 0) + 1;
    if (slots.some((sp) => sp.some((p) => p.artifice))) cov.withArtifice++;
    if (!input.allowBalancedTuning) cov.noBalanced++;
    if (!allowTuning) cov.noTuning++;
    if (frag.some((f) => f < 0)) cov.negFrag++;
  }
  return input;
}

/** Probe-mins variants for the ceiling walk: one stat raised (or lowered) at a time. */
export function genProbeMins(rng: () => number, input: OptimizerInput, n: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < n; i++) {
    const m = input.minimums.slice();
    const t = randInt(rng, 0, NUM_STATS - 1);
    m[t] = pick(rng, [0, 1, m[t] + 1, m[t] + 5, m[t] + 13, randInt(rng, 0, STAT_CAP), STAT_CAP]);
    m[t] = Math.max(0, Math.min(STAT_CAP, m[t]));
    out.push(m);
  }
  return out;
}

export function describeInput(input: OptimizerInput): string {
  return JSON.stringify(input);
}
