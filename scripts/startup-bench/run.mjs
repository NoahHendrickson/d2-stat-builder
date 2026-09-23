// Headless Chrome over CDP: stub /api/auth/session + /api/bungie/profile, load the app, time stages.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const PORT = 9333, APP = process.argv[2] ?? "https://localhost:4321/", DIR = process.argv[3] ?? "/tmp/d2-startup-bench/chrome-profile";
if (process.argv[4] === "fresh") fs.rmSync(DIR, { recursive: true, force: true });
const here = path.dirname(new URL(import.meta.url).pathname);
const profileBody = fs.readFileSync(path.join(here, ".profile.json"), "utf8");
const sessionBody = JSON.stringify({ authenticated: true, user: { membershipId: "e2e-user", destinyMembershipId: "d1", destinyMembershipType: 3, displayName: "E2E" } });
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${DIR}`, "--ignore-certificate-errors", "--no-first-run", "--no-default-browser-check", "--window-size=1280,800"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let wsUrl; for (let i = 0; i < 50 && !wsUrl; i++) { try { wsUrl = (await (await fetch(`http://localhost:${PORT}/json/version`)).json()).webSocketDebuggerUrl; } catch { await sleep(100); } }
const ws = new WebSocket(wsUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const handlers = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } else if (m.method) for (const h of handlers) h(m); };
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
const s = (m, p) => send(m, p, sessionId);
const logs = [];
handlers.push(async (m) => {
  if (m.sessionId !== sessionId) return;
  if (m.method === "Fetch.requestPaused") {
    const url = m.params.request.url; const body = url.includes("/api/auth/session") ? sessionBody : profileBody;
    await s("Fetch.fulfillRequest", { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: "content-type", value: "application/json" }], body: Buffer.from(body).toString("base64") });
  } else if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning")) logs.push(m.params.type + ": " + m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 200));
  else if (m.method === "Runtime.exceptionThrown") logs.push("exception: " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 300));
});
await s("Fetch.enable", { patterns: [{ urlPattern: "*/api/auth/session*" }, { urlPattern: "*/api/bungie/profile*" }] });
await s("Runtime.enable"); await s("Page.enable");
await s("Page.addScriptToEvaluateOnNewDocument", { source: "window.__lt=[];new PerformanceObserver(l=>{for(const e of l.getEntries())window.__lt.push([Math.round(e.startTime),Math.round(e.duration)])}).observe({type:'longtask',buffered:true});" });
const evalJs = async (expression) => (await s("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;
async function run(label) {
  const t0 = Date.now();
  await s("Page.navigate", { url: APP });
  let ready = false, state = "", readyMs = 0, resultMs = 0;
  for (let i = 0; i < 1200 && !(ready && resultMs); i++) {
    await sleep(20);
    state = await evalJs(`(() => { const t = document.body?.innerText ?? ""; return JSON.stringify({ now: Math.round(performance.now()), overlay: t.includes("Loading your armor"), done: t.includes("Armor ready"), result: /Builds\\s+\\d[\\d,]* \\/ \\d/.test(t), signin: t.includes("SIGN IN WITH BUNGIE"), text: t.slice(0, 120) }); })()`).catch(() => "{}");
    const st = JSON.parse(state || "{}");
    if (!ready && st.signin === false && st.text?.length > 0 && (st.done === true || st.overlay === false)) { ready = true; readyMs = st.now; }
    if (!resultMs && st.result) resultMs = st.now;
  }
  console.log(`\n=== ${label}: ready at ${readyMs} ms, first results at ${resultMs} ms (page clock)`);
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
const shot = await s("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/d2-startup-bench/builder.png", Buffer.from(shot.data, "base64")); console.log("screenshot saved");
await sleep(3000); // let the armory cache write + any background revalidation settle
await run("warm");
await sleep(500);
await run("warm2");
ws.close(); const exited = new Promise((r) => chrome.on("exit", r)); chrome.kill(); await exited;
