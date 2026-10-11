// Mutation check for the optimizer-store model harness. Applies one deliberate defect
// at a time to optimizer-store.ts, runs the green model-based properties, and restores
// the file. Usage (from the repo root): node src/lib/optimizer/discovery/mutate-store.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const FILE = "src/lib/optimizer/optimizer-store.ts";
const original = readFileSync(FILE, "utf8");

const MUTANTS = [
  ["M1 no stale-seq guard", "if (msg.seq !== seq) return; // superseded run — ignore", ""],
  ["M2 run() forgets dropPendingCeilings", "      refinementProgress.set(0);\n      dropPendingCeilings();\n", "      refinementProgress.set(0);\n"],
  ["M3 attach skips in-flight origin refresh", "      if (key === inFlightKey && (inFlight || (last?.key === key && snapshot.shown))) {\n        inFlightOrigin = origin;", "      if (key === inFlightKey && (inFlight || (last?.key === key && snapshot.shown))) {"],
  ["M4 attach skips shown origin refresh", "setState({ shown: { ...shown, origin } });", ""],
  ["M5 cancel does not bump seq", "    cancel() {\n      seq++;", "    cancel() {"],
  ["M6 cancel keeps inFlightKey", "      inFlightKey = null;\n", ""],
  ["M7 no monotone merge", "return prev ? next.map((v, s) => Math.max(v, prev[s])) : next;", "return next;"],
  ["M8 last only from final results", "          if (inFlightInput && inFlightKey) {", "          if (inFlightInput && inFlightKey && !msg.refining) {"],
  ["M9 superseded worker not terminated", "      if (inFlight) {\n        worker?.terminate();", "      if (false) {\n        worker?.terminate();"],
  ["M10 applyPending ignores phase", "if (ref.phase !== \"done\" || !ref.pending || !shown) return;", "if (!(\"pending\" in ref) || !ref.pending || !shown) return;"],
  ["M11 no throttle", "if (wait <= 0) {", "if (true) {"],
  ["M12 no trailing edge", "    if (ceilingsTimer === null) {\n      ceilingsTimer = setTimeout(", "    if (ceilingsTimer === 'never') {\n      ceilingsTimer = setTimeout("],
  ["M13 confirmed ignores ceilingsExact", ": msg.verified && msg.output.ceilingsExact", ": msg.verified"],
  ["M14 run overlay = last ceilings, not carry seed", "ceilingsView.set({ values: carry?.ceilingSeed ?? null, exact: false });", "ceilingsView.set({ values: last?.output.ceilings ?? null, exact: false });"],
  ["M15 cancel keeps held ceilings", "      inFlight = false;\n      dropPendingCeilings();\n      inFlightKey = null;", "      inFlight = false;\n      inFlightKey = null;"],
  ["M16 attach on any same key", "if (key === inFlightKey && (inFlight || (last?.key === key && snapshot.shown))) {", "if (key === inFlightKey) {"],
  ["M17 attach needs in-flight only", "if (key === inFlightKey && (inFlight || (last?.key === key && snapshot.shown))) {", "if (key === inFlightKey && inFlight) {"],
  ["M18 interim keeps refinementProgress", "            refinementProgress.set(0);\n            publishCeilings({", "            publishCeilings({"],
  ["M19 onerror keeps held ceilings", "      inFlight = false;\n      dropPendingCeilings();\n      setState({ running: false, refinement: IDLE });", "      inFlight = false;\n      setState({ running: false, refinement: IDLE });"],
  ["M20 refinement ceilings not merged", "ref.phase === \"running\" ? mergeCeilingsMonotone(shown, msg.ceilings) : msg.ceilings;", "msg.ceilings;"],
  ["M21 shown keeps previous origin", "origin: inFlightOrigin as QueryOrigin,", "origin: (snapshot.shown?.origin ?? inFlightOrigin) as QueryOrigin,"],
  ["M22 outcome 'rose' vs displayed", "const rose = msg.output.ceilings.some((v, s) => v > ref.interim.ceilings[s]);", "const rose = msg.output.ceilings.some((v, s) => v > (ceilingsView.get().values ?? ref.interim.ceilings)[s]);"],
  ["M23 better accepted when idle", "if (ref.phase === \"running\") setState({ refinement: { ...ref, pending: msg.output } });", "if (ref.phase !== \"done\") setState({ refinement: { ...ref, pending: msg.output } as RefinementState });"],
  ["M24 throttle window 50ms", "const CEILINGS_INTERVAL_MS = 100;", "const CEILINGS_INTERVAL_MS = 50;"],
  ["M25 result does not stop running", "              shown: shownFor(msg.output),\n              running: false,\n            };", "              shown: shownFor(msg.output),\n            };"],
];

const results = [];
try {
  for (const [name, from, to] of MUTANTS) {
    if (!original.includes(from)) {
      results.push(`${name}: PATTERN NOT FOUND`);
      continue;
    }
    writeFileSync(FILE, original.replace(from, to));
    const r = spawnSync(
      "./node_modules/.bin/vitest",
      ["run", "src/lib/optimizer/discovery/optimizer-store.model.test.ts", "-t", "model-based"],
      { encoding: "utf8", env: { ...process.env, PROP_RUNS: process.env.PROP_RUNS ?? "2000" } },
    );
    const out = r.stdout + r.stderr;
    const why = (out.match(/Caused by: (?:HarnessViolation|Error): ([^\n]*)/) ?? [])[1] ?? (r.status === 0 ? "" : out.slice(-400));
    results.push(`${name}: ${r.status === 0 ? "MISSED" : "caught"}${why ? " — " + why.slice(0, 200) : ""}`);
    process.stdout.write(results.at(-1) + "\n");
  }
} finally {
  writeFileSync(FILE, original);
}
