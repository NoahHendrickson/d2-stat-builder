// Mutation-calibration runner for the carryover/session discovery suite.
// Usage (from the repo root): node src/lib/optimizer/discovery/mutate.mjs [name-filter]
// Applies each deliberate defect to production code, runs the discovery tests, records
// caught/missed, and ALWAYS restores the original file (even on crash).
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const C = "src/lib/optimizer/carryover.ts";
const S = "src/lib/optimizer/session.ts";
const M = [
  ["classify ignores stat 5", C, "  for (let s = 0; s < NUM_STATS; s++) {\n    if (next[s] > prev[s])", "  for (let s = 0; s < NUM_STATS - 1; s++) {\n    if (next[s] > prev[s])"],
  ["loosened carries uppers", C, "return { ceilingSeed: prevOutput.ceilings };", "return { ceilingSeed: prevOutput.ceilings, ceilingUpperSeed: prevOutput.ceilingUppers };"],
  ["tightened carries prev lows", C, "if (anySurvivor) carry.ceilingSeed = seed;", "carry.ceilingSeed = prevOutput.ceilings;"],
  ["tightened skips survivor check", C, "if (lo.stats[s] < nextMins[s]) {", "if (false) {"],
  ["mixed carries lows", C, 'if (dir === "mixed") return undefined;', 'if (dir === "mixed") return { ceilingSeed: prevOutput.ceilings };'],
  ["mixed carries uppers", C, 'if (dir === "mixed") return undefined;', 'if (dir === "mixed") return { ceilingUpperSeed: prevOutput.ceilingUppers };'],
  ["drop powerRange compare", C, "if (!powerRangeEqual(aPower, bPower)) return false;", ""],
  ["drop weapons compare", C, "a.min === b.min && a.max === b.max && numArrayEqual(a.weapons ?? [], b.weapons ?? [])", "a.min === b.min && a.max === b.max"],
  ["drop setReq compare", C, "if (!setReqsEqual(aReqs, bReqs)) return false;", ""],
  ["drop frag compare", C, "if (!fragEqual(aFrag, bFrag)) return false;", ""],
  ["drop minor mods compare", C, "ma.major !== mb.major || ma.minor !== mb.minor", "ma.major !== mb.major"],
  ["drop maxResults compare", C, "if ((aMax ?? 200) !== (bMax ?? 200)) return false;", ""],
  ["drop balanced compare", C, "if (tuningOn && (aBalanced ?? true) !== (bBalanced ?? true)) return false;", ""],
  ["exotic hashes ignored", C, 'hashes: exotic?.mode === "specific" ? [...(exotic.hashes ?? [])] : [],', "hashes: [],"],
  ["piece power ignored", C, "if (a.power !== b.power) return false;", ""],
  ["piece artifice ignored", C, "if (Boolean(a.artifice) !== Boolean(b.artifice)) return false;", ""],
  ["piece directional ignored", C, "if (at.directional !== bt.directional) return false;", ""],
  ["beats uses >=", S, "(lo, i) => lo.total > (prev.loadouts[i]?.total ?? -1),", "(lo, i) => lo.total >= (prev.loadouts[i]?.total ?? -1),"],
  ["beats ignores length", S, "if (next.loadouts.length > prev.loadouts.length) return true;", ""],
  ["final post always verified", S, "    { ...first, ceilings, ceilingUppers, ceilingsExact },\n    false,\n    !second.capped,", "    { ...first, ceilings, ceilingUppers, ceilingsExact },\n    false,\n    true,"],
  ["final post unfrozen", S, "    { ...first, ceilings, ceilingUppers, ceilingsExact },\n    false,", "    { ...second, ceilings, ceilingUppers, ceilingsExact },\n    false,"],
  ["uppers from phase 2", S, "const ceilingUppers = phase1.uppers;", "const ceilingUppers = second.ceilingUppers;"],
  ["exact from phase1 flag", S, "const ceilingsExact = ceilings.every((v, s) => v === ceilingUppers[s]);", "const ceilingsExact = phase1.exact;"],
  ["no interim post", S, "  cb.onResult(first, true, !first.capped);", ""],
  ["interim verified always", S, "  cb.onResult(first, true, !first.capped);", "  cb.onResult(first, true, true);"],
  ["skip phase-1 progress pin", S, "  cb.onProgress(share);\n", ""],
  ["phase 2 not heap-seeded", S, "    heapSeed: first.loadouts,\n", ""],
  ["uncapped-inexact skips phase 1", S, "  const share = first.capped ? CEILING_PROGRESS_SHARE : 1;", "  if (!first.capped) { cb.onResult(first, false, true); return; }\n  const share = first.capped ? CEILING_PROGRESS_SHARE : 1;"],
  ["carry dropped in session", S, "    ceilingUpperSeed: carry?.ceilingUpperSeed,", "    ceilingUpperSeed: carry?.ceilingSeed,"],
];

const filter = process.argv[2];
let restore = null;
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { if (restore) restore(); process.exit(1); });
const results = [];
for (const [name, file, from, to] of M) {
  if (filter && !new RegExp(filter).test(name)) continue;
  const orig = readFileSync(file, "utf8");
  const n = orig.split(from).length - 1;
  if (n !== 1) {
    results.push([name, `SKIPPED (pattern found ${n}x)`]);
    continue;
  }
  restore = () => writeFileSync(file, orig);
  writeFileSync(file, orig.replace(from, to));
  let caught;
  try {
    execSync("./node_modules/.bin/vitest run src/lib/optimizer/discovery/ --bail=1 2>&1", {
      stdio: "pipe",
      maxBuffer: 1 << 28,
      env: { ...process.env, PROP_RUNS: process.env.PROP_RUNS ?? "60" },
    });
    caught = "MISSED";
  } catch (e) {
    const out = String(e.stdout ?? "");
    const failing = [...out.matchAll(/FAIL\s+\S+ > (.*)/g)].map((m) => m[1].trim()).slice(0, 2).join(" | ");
    const why = (out.match(/Caused by: ([^\n]{0,240})/) ?? out.match(/Error: ([^\n]{0,240})/) ?? [])[1] ?? "?";
    caught = `caught [${failing || "?"}] ${why}`;
  } finally {
    writeFileSync(file, orig);
    restore = null;
  }
  results.push([name, caught]);
  console.log(name, "→", caught);
}
console.log("\nSUMMARY");
for (const [n, c] of results) console.log(`${c.startsWith("caught") ? "✔" : "✘"} ${n}: ${c}`);
