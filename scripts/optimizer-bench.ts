/**
 * Optimizer benchmark + result-regression gate.
 *
 *   npx tsx scripts/optimizer-bench.ts time [filter]      full real pool, production budgets:
 *                                                         wall time, leaves, capped, ceilings exact
 *   npx tsx scripts/optimizer-bench.ts verify [filter]    subsampled pool, exhaustive budgets: hash
 *                                                         every query's full output and compare with
 *                                                         scripts/optimizer-bench.snapshot.json
 *   npx tsx scripts/optimizer-bench.ts snapshot           (re)write the snapshot from the current code
 *
 * `verify` is the gate every pruning/bound change must pass: a pure-speed change leaves every
 * hash identical (build set AND order, tuning, mods, artifice, ceilings, proven uppers). Only
 * a deliberate ranking/policy change may regenerate the snapshot, and the commit doing so must
 * say why. The subsample keeps the pool small enough that the UNoptimized solver finishes every
 * query exhaustively (so the snapshot is timing-independent), while keeping every query shape:
 * exotics in every slot, both fixture set bonuses, artifice/legacy pieces, power ranges.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { solve } from "../src/lib/optimizer/solve";
import { realWarlockSlots } from "../src/lib/optimizer/real-pool.fixture";
import type { OptimizerInput, OptimizerOutput, OptimizerPiece } from "../src/lib/optimizer/types";

const CODA = 1490136267;
const SET_B = 3734029045;
const SNAPSHOT_PATH = resolve(__dirname, "optimizer-bench.snapshot.json");

type Pool = OptimizerPiece[][];

/** Every 8th legendary, every 4th exotic, every 2nd piece of the two fixture sets. */
function subsample(full: Pool): Pool {
  return full.map((slot) => {
    let leg = 0;
    let exo = 0;
    let set = 0;
    return slot.filter((p) => {
      if (p.exotic) return exo++ % 4 === 0;
      if (p.setHash === CODA || p.setHash === SET_B) return set++ % 2 === 0;
      return leg++ % 8 === 0;
    });
  });
}

const base = (slots: Pool, over: Partial<OptimizerInput>): OptimizerInput => ({
  slots,
  minimums: [0, 0, 0, 0, 0, 0],
  mods: { major: 0, minor: 5 },
  exotic: { mode: "any" },
  allowTuning: true,
  fragmentBonus: [0, 0, 0, 0, 0, 0],
  maxResults: 200,
  ...over,
});

/** Every 4th legendary becomes a legacy artifice piece (no tuning, free +3, weaker roll). */
function artificePool(slots: Pool): Pool {
  return slots.map((slot) =>
    slot.map((p, i) =>
      !p.exotic && i % 4 === 0
        ? { ...p, tuning: undefined, artifice: true, stats: p.stats.map((v) => Math.max(2, v - 8)) }
        : p,
    ),
  );
}
function poweredPool(slots: Pool): Pool {
  return slots.map((slot) => slot.map((p, i) => ({ ...p, power: 400 + (i % 11) })));
}
const SPECIFIC_HASH = 4242;
/** Every exotic gets a hash; only helmet exotics get the one the "specific" query asks for. */
function specificExoticPool(slots: Pool): Pool {
  return slots.map((slot, k) =>
    slot.map((p) => (p.exotic ? { ...p, hash: k === 0 ? SPECIFIC_HASH : 999 } : p)),
  );
}
/** Same shape as realWarlockTwoSetInput: one exotic (on legs), exotic required, two 2pc sets. */
function twoSetInput(slots: Pool): OptimizerInput {
  let kept = false;
  const filtered = slots.map((slot, i) =>
    slot.filter((p) => {
      if (!p.exotic) return true;
      if (i === 3 && !kept) {
        kept = true;
        return true;
      }
      return false;
    }),
  );
  return {
    slots: filtered,
    minimums: [180, 0, 0, 105, 0, 0],
    mods: { major: 0, minor: 5 },
    exotic: { mode: "require" },
    setRequirements: [
      { setHash: CODA, count: 2 },
      { setHash: SET_B, count: 2 },
    ],
    allowTuning: true,
  };
}
function codaInput(slots: Pool): OptimizerInput {
  return {
    slots,
    minimums: [190, 0, 0, 120, 0, 0],
    mods: { major: 3, minor: 2 },
    setRequirements: [{ setHash: CODA, count: 4 }],
    exotic: { mode: "any" },
    allowTuning: true,
    fragmentBonus: [0, 0, 10, -20, 0, 0],
  };
}

const M150 = { minimums: [150, 0, 0, 150, 0, 0], mods: { major: 3, minor: 2 } };

export function queries(pool: Pool): Record<string, () => OptimizerInput> {
  return {
    "loose (all 0)": () => base(pool, {}),
    "loose, tuning off": () => base(pool, { allowTuning: false }),
    "loose, balanced off": () => base(pool, { allowBalancedTuning: false }),
    "one stat 200 (weapons)": () => base(pool, { minimums: [200, 0, 0, 0, 0, 0] }),
    "one stat 100 (health), 5 minor": () => base(pool, { minimums: [0, 100, 0, 0, 0, 0] }),
    "two stats 150/150 (w/g)": () => base(pool, M150),
    "three stats 120/100/100": () =>
      base(pool, { minimums: [120, 0, 100, 100, 0, 0], mods: { major: 3, minor: 2 } }),
    "six stats 70 each, frag": () =>
      base(pool, {
        minimums: [70, 70, 70, 70, 70, 70],
        mods: { major: 2, minor: 3 },
        fragmentBonus: [10, -10, 0, 10, 0, -10],
      }),
    "infeasible 200/200": () =>
      base(pool, { minimums: [200, 200, 0, 0, 0, 0], mods: { major: 5, minor: 0 } }),
    "fixture two-set": () => twoSetInput(pool),
    "fixture coda": () => codaInput(pool),
    "specific exotic, loose": () =>
      base(pool, { slots: specificExoticPool(pool), exotic: { mode: "specific", hashes: [SPECIFIC_HASH] } }),
    "specific exotic, 150/150": () =>
      base(pool, { slots: specificExoticPool(pool), exotic: { mode: "specific", hashes: [SPECIFIC_HASH] }, ...M150 }),
    "no exotic, 150/150": () => base(pool, { exotic: { mode: "none" }, ...M150 }),
    "artifice pool, loose": () => base(pool, { slots: artificePool(pool) }),
    "artifice pool, 150/150": () => base(pool, { slots: artificePool(pool), ...M150 }),
    "power range 402-408, loose": () =>
      base(pool, { slots: poweredPool(pool), powerRange: { min: 402, max: 408 } }),
    "power range, 150/150": () =>
      base(pool, { slots: poweredPool(pool), powerRange: { min: 402, max: 408 }, ...M150 }),
  };
}

/** Everything a user could observe from a result, in order. */
function canonical(out: OptimizerOutput): string {
  const rows = out.loadouts.map((l) =>
    JSON.stringify([
      l.pieceIds, l.baseStats, l.stats, l.total, l.tuningBonus, l.tuning, l.modBonus,
      l.modsUsed, l.artificeBonus, l.artifice, l.exotic, l.power,
    ]),
  );
  rows.push(JSON.stringify([out.ceilings, out.ceilingUppers, out.ceilingsExact]));
  return createHash("sha1").update(rows.join("\n")).digest("hex").slice(0, 16);
}

interface SnapshotEntry {
  hash: string;
  n: number;
  best: number | null;
  ceilings: number[];
  uppers: number[];
  exact: boolean;
}

function main(): void {
  const mode = process.argv[2] ?? "time";
  const filter = process.argv[3];
  const full = realWarlockSlots();

  if (mode === "time") {
    const rows: Record<string, unknown>[] = [];
    for (const [name, mk] of Object.entries(queries(full))) {
      if (filter && !name.includes(filter)) continue;
      solve(mk(), { topNBudgetMs: 200, ceilingBudgetMs: 0 }); // JIT warm-up
      const input = mk();
      const t0 = performance.now();
      const top = solve(input, { ceilingBudgetMs: 0 });
      const tTop = performance.now() - t0;
      const t1 = performance.now();
      const out = solve(input);
      const tAll = performance.now() - t1;
      rows.push({
        query: name,
        topNms: Math.round(tTop),
        ceilMs: Math.round(tAll - tTop),
        tried: top.combosTried,
        valid: top.combosValid,
        results: out.loadouts.length,
        best: out.loadouts[0]?.total ?? null,
        capped: out.capped,
        exact: out.ceilingsExact,
      });
      console.error("done", name);
    }
    console.table(rows);
    return;
  }

  if (mode !== "verify" && mode !== "snapshot") {
    console.error("usage: optimizer-bench.ts time|verify|snapshot [filter]");
    process.exit(2);
  }
  const pool = subsample(full);
  console.error("subsampled slots:", pool.map((s) => s.length).join("/"));
  const EXHAUSTIVE = { topNBudgetMs: 600_000, ceilingBudgetMs: 300_000 };
  const current: Record<string, SnapshotEntry> = {};
  for (const [name, mk] of Object.entries(queries(pool))) {
    if (filter && !name.includes(filter)) continue;
    const t0 = performance.now();
    const out = solve(mk(), EXHAUSTIVE);
    const ms = Math.round(performance.now() - t0);
    if (out.capped || !out.ceilingsExact) {
      console.error(`${name}: not exhaustive (capped=${out.capped} exact=${out.ceilingsExact}) — enlarge the budget or shrink the subsample`);
      process.exit(1);
    }
    current[name] = {
      hash: canonical(out),
      n: out.loadouts.length,
      best: out.loadouts[0]?.total ?? null,
      ceilings: out.ceilings,
      uppers: out.ceilingUppers,
      exact: out.ceilingsExact,
    };
    console.error(`${name.padEnd(34)} ${String(ms).padStart(6)} ms  leaves ${out.combosTried}  ${current[name].hash}`);
  }
  if (mode === "snapshot") {
    writeFileSync(SNAPSHOT_PATH, JSON.stringify(current, null, 2) + "\n");
    console.error("wrote", SNAPSHOT_PATH);
    return;
  }
  const expected = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as Record<string, SnapshotEntry>;
  let failed = 0;
  for (const [name, entry] of Object.entries(current)) {
    const want = expected[name];
    if (!want) {
      console.error(`MISSING in snapshot: ${name}`);
      failed++;
    } else if (want.hash !== entry.hash) {
      console.error(`MISMATCH ${name}: snapshot ${want.hash} (n=${want.n} best=${want.best} ceil=${want.ceilings}) vs now ${entry.hash} (n=${entry.n} best=${entry.best} ceil=${entry.ceilings})`);
      failed++;
    }
  }
  if (failed) {
    console.error(`${failed} quer${failed === 1 ? "y" : "ies"} changed output`);
    process.exit(1);
  }
  console.error(`all ${Object.keys(current).length} queries identical to the snapshot`);
}

if (process.argv[1]?.endsWith("optimizer-bench.ts")) main();
