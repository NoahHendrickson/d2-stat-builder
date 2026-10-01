// Headless Chrome over CDP for the benches: one page, with /api/auth/session,
// /api/bungie/profile, and /api/loadouts stubbed so no Bungie sign-in is needed.
import { spawn } from "node:child_process";
import fs from "node:fs";

// Override with CHROME=/path/to/chrome (Linux, or a Playwright/Chromium build).
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SESSION = JSON.stringify({ authenticated: true, user: { membershipId: "e2e-user", destinyMembershipId: "d1", destinyMembershipType: 3, displayName: "E2E" } });
const SIGNED_OUT = JSON.stringify({ authenticated: false });
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Start Chrome and attach to a blank page. `profile` is the GetProfile body to serve;
 * `fresh` wipes the Chrome profile first (cold caches). Returns `s` (send a CDP command
 * to the page), `evalJs`, `logs` (console errors and warnings), and `close`. `signedIn: false`
 * answers the session check as a signed-out visitor.
 */
export async function launch({ port = 9333, dir, fresh = false, profile, width = 1280, height = 800, signedIn = true }) {
  if (fresh) fs.rmSync(dir, { recursive: true, force: true });
  const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, "--ignore-certificate-errors", "--no-first-run", "--no-default-browser-check", `--window-size=${width},${height}`], { stdio: "ignore" });
  let wsUrl;
  for (let i = 0; i < 50 && !wsUrl; i++) { try { wsUrl = (await (await fetch(`http://localhost:${port}/json/version`)).json()).webSocketDebuggerUrl; } catch { await sleep(100); } }
  const ws = new WebSocket(wsUrl); await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map(); const handlers = [];
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); if (m.error) rej(new Error(JSON.stringify(m.error))); else res(m.result); } else if (m.method) for (const h of handlers) h(m); };
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const s = (m, p) => send(m, p, sessionId);
  const logs = [];
  handlers.push(async (m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === "Fetch.requestPaused") {
      const { url, method } = m.params.request;
      // Moves and other writes just succeed; reads get the fixtures.
      const body = url.includes("/api/auth/session") ? (signedIn ? SESSION : SIGNED_OUT) : url.includes("/api/loadouts") ? '{"loadouts":[]}' : method === "POST" ? '{"ok":true}' : profile;
      await s("Fetch.fulfillRequest", { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: "content-type", value: "application/json" }], body: Buffer.from(body).toString("base64") }).catch(() => {});
    } else if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning")) logs.push(m.params.type + ": " + m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 200));
    else if (m.method === "Runtime.exceptionThrown") logs.push("exception: " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 300));
  });
  await s("Fetch.enable", { patterns: [{ urlPattern: "*/api/auth/session*" }, { urlPattern: "*/api/bungie/*" }, { urlPattern: "*/api/loadouts*" }] });
  await s("Runtime.enable"); await s("Page.enable");
  await s("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await s("Page.addScriptToEvaluateOnNewDocument", { source: "window.__lt=[];new PerformanceObserver(l=>{for(const e of l.getEntries())window.__lt.push([Math.round(e.startTime),Math.round(e.duration)])}).observe({type:'longtask',buffered:true});" });
  const evalJs = async (expression) => {
    const out = await s("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (out.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description ?? out.exceptionDetails.text);
    return out.result.value;
  };
  const close = async () => { ws.close(); if (chrome.exitCode !== null) return; const exited = new Promise((r) => chrome.on("exit", r)); chrome.kill(); await exited; };
  return { s, evalJs, logs, close };
}
