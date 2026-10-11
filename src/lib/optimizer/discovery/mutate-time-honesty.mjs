// Mutation-testing driver for the time-honesty suite (harness calibration). Applies one
// textual mutation at a time to a production file, runs src/lib/optimizer/discovery/,
// and ALWAYS restores the original content (finally). Do not run with a dev server up.
//   node src/lib/optimizer/discovery/mutate-time-honesty.mjs [M-prefix]   (PROP_RUNS=40)
// Afterwards `git diff -- src/lib/optimizer/*.ts` must be empty.
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const root = new URL("../../../../", import.meta.url).pathname;
const opt = (f) => `${root}src/lib/optimizer/${f}`;

const MUTANTS = [
  { id: "M1 timed-out probe treated as disproof", file: "ceilings.ts", from: "        if (aborted) {\n          stats.timedOut++;", to: "        if (false) {\n          stats.timedOut++;" },
  { id: "M2 harvest guard mid >= min[t] skipped", file: "ceilings.ts", from: "if (mid >= min[t]) {", to: "if (true) {" },
  { id: "M3 tuner onTick call removed", file: "tuning.ts", from: "if (onTick && (++tickNodes & (TICK_NODES - 1)) === 0) onTick();", to: "" },
  { id: "M4 exactness from optimistic window", file: "ceilings.ts", from: "    if (ceiling[t] < uppers[t]) exact = false;", to: "    if (ceiling[t] < optimistic[t]) exact = false;" },
  { id: "M5 timed-out probe also shrinks uppers by 1 extra (over-shrink on disproof)", file: "ceilings.ts", from: "uppers[t] = Math.min(uppers[t], mid - 1);", to: "uppers[t] = Math.min(uppers[t], mid - 2);" },
  { id: "M6 heapSeed duplicate guard removed", file: "solve.ts", from: "if (seededKeys.size > 0 && seededKeys.has(pieceIds.join(\"|\"))) return;", to: "" },
  { id: "M7 checkBudget stops without reporting capped", file: "solve.ts", from: "      stopped = true;\n      capped = true;", to: "      stopped = true;" },
  { id: "M8 probe mins not restored after a probe", file: "ceilings.ts", from: "      probeMins[t] = min[t];\n      onProbe?.();", to: "      onProbe?.();" },
  { id: "M9 upperSeed trusted below the seed (no max with ceiling)", file: "ceilings.ts", from: "? Math.max(ceiling[t], Math.min(init, upperSeed[t]))", to: "? Math.min(init, upperSeed[t])" },
  { id: "M10 aborted flag not reset between probes", file: "ceilings.ts", from: "    probeDeadline = deadline;\n    aborted = false;", to: "    probeDeadline = deadline;" },
  { id: "M11 witness after abort discarded and probe counted as disproof", file: "ceilings.ts", from: "      if (w) {\n        found = true;\n        witness = w;\n      }", to: "      if (w && !aborted) {\n        found = true;\n        witness = w;\n      }\n      if (aborted) aborted = false;" },
  { id: "M12 session final post claims verified always", file: "session.ts", from: "    false,\n    !second.capped,\n  );", to: "    false,\n    true,\n  );" },
  { id: "M13 walk aborts silently (no aborted flag) at its node check", file: "ceilings.ts", from: "    if ((nodes++ & 2047) === 0) {\n      tick();\n      if (aborted) return;\n    }", to: "    if ((nodes++ & 2047) === 0) {\n      tick();\n      if (aborted) { aborted = false; found = false; probeDeadline = -Infinity; return; }\n    }" },
  { id: "M14 global deadline break ignored, probes keep running on expired shares", file: "ceilings.ts", from: "    if (performance.now() >= globalDeadline) break; // budget spent", to: "    // budget spent" },
  { id: "M15 found witness after deadline harvested even when mid < min (raise own floor by witness)", file: "ceilings.ts", from: "        ceiling[t] = mid;\n", to: "        ceiling[t] = Math.max(mid, w.stats[t] + 5);\n" },
  // A timeout that lands INSIDE a leaf's tuning (aborted flips during the tuner call, the
  // leaf finds nothing) is forgiven after the walk unwinds: the cut-short probe reports
  // "complete, infeasible" — proof claimed after abort.
  { id: "M16 abort inside a leaf forgiven (proof claimed after abort)", file: "ceilings.ts", multi: [
    ["      const w = tuner(chosen, sum, probeMins, \"feasible\");\n", "      const wasAborted = aborted;\n      const w = tuner(chosen, sum, probeMins, \"feasible\");\n      if (!w && aborted && !wasAborted) leafAbort = true;\n"],
    ["    search(0, 0);\n    return witness;", "    leafAbort = false;\n    search(0, 0);\n    if (leafAbort) aborted = false;\n    return witness;"],
    ["  let aborted = false;\n", "  let aborted = false;\n  let leafAbort = false;\n"],
  ] },
  // Same, in the top-N: a deadline that trips inside a leaf stops the walk but is not
  // reported as capped.
  { id: "M17 top-N stop inside a leaf not reported capped", file: "solve.ts", multi: [
    ["      const best = tuner(chosen, sum, min, \"maximize\");\n", "      const wasStopped = stopped;\n      const best = tuner(chosen, sum, min, \"maximize\");\n      if (stopped && !wasStopped) capped = false;\n"],
  ] },
];

const only = process.argv[2];
const results = [];
for (const m of MUTANTS) {
  if (only && !m.id.startsWith(only)) continue;
  const path = opt(m.file);
  const orig = fs.readFileSync(path, "utf8");
  const pairs = m.multi ?? [[m.from, m.to]];
  if (pairs.some(([f]) => !orig.includes(f))) {
    results.push(`${m.id}: PATTERN NOT FOUND`);
    continue;
  }
  let mutated = orig;
  for (const [f, t] of pairs) mutated = mutated.replace(f, t);
  fs.writeFileSync(path, mutated);
  let verdict;
  let detail = "";
  try {
    execFileSync(`${root}node_modules/.bin/vitest`, ["run", "src/lib/optimizer/discovery/"], {
      cwd: root,
      env: { ...process.env, PROP_RUNS: process.env.PROP_RUNS ?? "40", PROP_NOSHRINK: "1" },
      stdio: "pipe",
      timeout: 600000,
    });
    verdict = "SURVIVED";
  } catch (e) {
    const out = String(e.stdout ?? "") + String(e.stderr ?? "");
    if (process.env.DUMP) fs.writeFileSync(`${root}mutate.out.txt`, out);
    const failed = [...out.matchAll(/FAIL .*?> (.*)/g)].map((x) => x[1].trim());
    const caused = [...out.matchAll(/Caused by: Error: (.*)/g)].map((x) => x[1].slice(0, 120));
    verdict = "KILLED";
    detail = `\n    failed: ${[...new Set(failed)].join(" | ")}\n    first cause: ${caused[0] ?? "(assertion)"}`;
  } finally {
    fs.writeFileSync(path, orig);
  }
  results.push(`${m.id}: ${verdict}${detail}`);
  console.log(results[results.length - 1]);
}
console.log("\n" + results.join("\n"));
