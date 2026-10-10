// Startup bench: load the app signed in (session + profile stubbed) and time the stages.
//
//   node scripts/startup-bench/run.mjs [url] [chrome profile dir] [fresh] [--full]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch, sleep } from "./cdp.mjs";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const APP = args[0] ?? "https://localhost:4321/", DIR = args[1] ?? "/tmp/d2-startup-bench/chrome-profile";
const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = process.argv.includes("--full") ? ".profile-full.json" : ".profile.json";
const { s, evalJs, logs, close } = await launch({ dir: DIR, fresh: args[2] === "fresh", profile: fs.readFileSync(path.join(here, fixture), "utf8") });

async function run(label) {
  await s("Page.navigate", { url: APP });
  // Three moments, all on the page clock:
  //   ready     — the data is in and the app takes clicks (the overlay lets them through)
  //   uncovered — the overlay has faded out, so the content is actually visible
  //   results   — the first builds are on screen
  // Before hydration the page can have text but no overlay yet, so "no overlay" only
  // counts once the overlay has been up.
  let sawOverlay = false, state = "", readyMs = 0, uncoveredMs = 0, resultMs = 0;
  for (let i = 0; i < 1200 && !(readyMs && uncoveredMs && resultMs); i++) {
    await sleep(20);
    state = await evalJs(`(() => { const t = document.body?.innerText ?? ""; const o = document.querySelector('[aria-label="Loading progress"]')?.closest('[role=status]'); return JSON.stringify({ now: Math.round(performance.now()), overlay: Boolean(o), released: o ? getComputedStyle(o).pointerEvents === "none" : false, opacity: o ? Number(getComputedStyle(o).opacity) : 0, result: /Builds\\s+\\d[\\d,]* \\/ \\d/.test(t), signin: /sign in with bungie/i.test(t), text: t.slice(0, 120) }); })()`).catch(() => "{}");
    const st = JSON.parse(state || "{}");
    if (st.overlay) sawOverlay = true;
    const loaded = st.signin === false && st.text?.length > 0 && sawOverlay;
    if (!readyMs && loaded && (st.released || !st.overlay)) readyMs = st.now;
    if (!uncoveredMs && loaded && (!st.overlay || st.opacity < 0.1)) uncoveredMs = st.now;
    if (!resultMs && st.result) resultMs = st.now;
  }
  console.log(`\n=== ${label}: ready at ${readyMs} ms, uncovered at ${uncoveredMs} ms, first results at ${resultMs} ms (page clock)`);
  const info = await evalJs(`(async () => {
    const res = performance.getEntriesByType("resource").filter(e => /api\\/auth\\/session|api\\/bungie\\/profile|Destiny2\\/Manifest|destiny2_content\\/json/.test(e.name)).map(e => ({ n: e.name.replace(/^https?:\\/\\/[^/]+/, "").replace(/-[0-9a-f-]{20,}\\.json/, ".json").slice(0, 70), start: Math.round(e.startTime), end: Math.round(e.responseEnd) }));
    const nav = performance.getEntriesByType("navigation")[0];
    const marks = performance.getEntriesByType("mark").map(m => ({ n: m.name, t: Math.round(m.startTime) }));
    const early = Object.keys(window.__d2Early ?? {});
    const lt = window.__lt ?? []; const longTasks = { count: lt.length, totalMs: lt.reduce((a, b) => a + b[1], 0), maxMs: Math.max(0, ...lt.map((x) => x[1])), top: lt.slice().sort((a, b) => b[1] - a[1]).slice(0, 5) };
    return { longTasks, readyAt: Math.round(performance.now()), dcl: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd), res, marks, earlyLeft: early, text: document.body.innerText.replace(/\\s+/g, " ").slice(0, 400) };
  })()`);

  console.log(JSON.stringify({ dcl: info.dcl, load: info.load, earlyLeft: info.earlyLeft, longTasks: info.longTasks }));
  for (const r of info.res) console.log(`  ${String(r.start).padStart(6)} → ${String(r.end).padStart(6)}  ${r.n}`);
  console.log("  text:", info.text);
  if (logs.length) { console.log("  console:", logs.slice(0, 12)); logs.length = 0; }
}
await run("cold");
await sleep(2000);
const shot = await s("Page.captureScreenshot", { format: "png" }); fs.mkdirSync("/tmp/d2-startup-bench", { recursive: true }); fs.writeFileSync("/tmp/d2-startup-bench/builder.png", Buffer.from(shot.data, "base64")); console.log("screenshot saved");
await sleep(3000); // let the armory cache write + any background revalidation settle
await run("warm");
await sleep(500);
await run("warm2");
await close();
