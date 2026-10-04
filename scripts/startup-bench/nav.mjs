// Navigation bench: with the app loaded and warm, click through the sidebar and time
// each view from the click until its content is in the DOM ("content") and until it is
// no longer faded by a page transition ("clear"). Also counts what the Items page mounts.
//
//   node scripts/startup-bench/nav.mjs [url] [--small] [--mobile] [--cpu=4] [--cycles=5]
//
// --small uses .profile.json instead of the full-inventory fixture; --mobile runs at
// 390x844 through the menu drawer; --cpu throttles the main thread (4 ≈ a mid phone).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch, sleep } from "./cdp.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))?.split("=")[1] ?? (args.includes(`--${name}`) ? "1" : undefined);
const APP = (args.find((a) => !a.startsWith("--")) ?? "https://localhost:4321").replace(/\/$/, "");
const mobile = Boolean(flag("mobile"));
const cpu = Number(flag("cpu") ?? 1);
const cycles = Number(flag("cycles") ?? 5);
const fixture = flag("small") ? ".profile.json" : ".profile-full.json";
const here = path.dirname(fileURLToPath(import.meta.url));
const profile = fs.readFileSync(path.join(here, fixture), "utf8");
const [width, height] = mobile ? [390, 844] : [1600, 1000];

// What "this view is showing its content" means, per route.
const MARKERS = {
  "/": '[aria-label="Health target"]',
  "/armor": "table tbody tr td",
  "/weapons": '[aria-label="Weapons"] [role=listitem]',
  "/loadouts": '[aria-label^="Search loadouts"]',
  "/manager": 'section[aria-label^="Characters"] [role=button][draggable]',
  "/settings": "#settings-appearance",
};
const ROUTES = ["/", "/armor", "/weapons", "/loadouts", "/manager"];

const b = await launch({ dir: "/tmp/d2-startup-bench/chrome-nav", profile, width, height });
const { product } = await b.s("Browser.getVersion");
await b.s("Page.addScriptToEvaluateOnNewDocument", { source: `window.__markers = ${JSON.stringify(MARKERS)};
window.__shown = (path) => { const el = document.querySelector(window.__markers[path]); return Boolean(el && el.getClientRects().length); };
// Product of the opacities from the marker up: below 1 while a transition still fades it.
window.__opacity = (path) => { let o = 1; for (let el = document.querySelector(window.__markers[path]); el; el = el.parentElement) o *= Number(getComputedStyle(el).opacity); return o; };
window.__go = async (path, viaDrawer) => {
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const find = () => [...document.querySelectorAll("a[href]")].find((a) => a.getAttribute("href") === path && a.getClientRects().length);
  if (viaDrawer && !find()) {
    document.querySelector('button[aria-label="Open menu"]').click();
    for (let i = 0; i < 120 && !find(); i++) await frame();
    await new Promise((r) => setTimeout(r, 500)); // the drawer's slide
  }
  const link = find();
  if (!link) return { error: "no link for " + path };
  const lt0 = window.__lt.length, t0 = performance.now();
  link.click();
  while (!(location.pathname === path && window.__shown(path))) { await frame(); if (performance.now() - t0 > 15000) return { error: "timeout " + path }; }
  const content = performance.now() - t0;
  while (window.__opacity(path) < 0.95) await frame();
  const clear = performance.now() - t0;
  await frame(); await frame();
  await new Promise((r) => setTimeout(r, 60)); // let the long-task observer deliver
  const tasks = window.__lt.slice(lt0);
  return { content: Math.round(content), clear: Math.round(clear), longest: Math.max(0, ...tasks.map((t) => t[1])), blocked: tasks.reduce((n, t) => n + t[1], 0) };
};` });

await b.s("Page.navigate", { url: APP + "/" });
// Loaded once the loading overlay has come and gone and the builder is up.
for (let i = 0, seen = false; i < 1200; i++) {
  await sleep(50);
  const st = JSON.parse(await b.evalJs(`JSON.stringify({ overlay: Boolean(document.querySelector('[aria-label="Loading progress"]')), shown: window.__shown?.("/") ?? false })`).catch(() => "{}"));
  if (st.overlay) seen = true;
  if ((seen || i > 100) && st.overlay === false && st.shown) break;
}
await sleep(2500); // caches written, prefetches done
if (cpu > 1) await b.s("Emulation.setCPUThrottlingRate", { rate: cpu });
const heap = async () => { await b.s("HeapProfiler.collectGarbage"); return Math.round((await b.evalJs("performance.memory.usedJSHeapSize")) / 1e5) / 10; };
const go = async (route) => {
  const r = JSON.parse(await b.evalJs(`window.__go(${JSON.stringify(route)}, ${mobile}).then(JSON.stringify)`));
  if (r.error) { await b.close(); throw new Error(r.error); } // don't leave Chrome holding the profile dir
  await sleep(400);
  return r;
};

const samples = { first: {}, cycle: {}, revisit: {} };
const record = (kind, route, r) => (samples[kind][route] ??= []).push(r);
const heapStart = await heap();
for (const route of [...ROUTES.slice(1), "/settings"]) record("first", route, await go(route));
const items = JSON.parse(await b.evalJs(`JSON.stringify({ tiles: document.querySelectorAll("[role=button][draggable]").length, vaultTiles: document.querySelectorAll('[aria-label="Vault"] [role=button][draggable]').length, nodes: document.querySelectorAll("*").length, images: document.images.length })`));
for (let i = 0; i < cycles; i++) for (const route of ROUTES) record("cycle", route, await go(route));
const heapEnd = await heap();
// Straight back: the route is still mounted (hidden), so this is a show, not a mount.
for (let i = 0; i < cycles; i++) for (const [a, z] of [["/manager", "/armor"], ["/", "/weapons"]]) { await go(a); await go(z); record("revisit", a, await go(a)); }

const pct = (xs, p) => { const s = [...xs].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]; };
const row = (kind, route, rs) => `${kind.padEnd(8)} ${route.padEnd(10)} n=${String(rs.length).padEnd(3)} content p50 ${String(pct(rs.map((r) => r.content), 0.5)).padStart(4)} p95 ${String(pct(rs.map((r) => r.content), 0.95)).padStart(4)}   clear p50 ${String(pct(rs.map((r) => r.clear), 0.5)).padStart(4)} p95 ${String(pct(rs.map((r) => r.clear), 0.95)).padStart(4)}   longest task ${String(Math.max(...rs.map((r) => r.longest))).padStart(4)}   blocked p50 ${String(pct(rs.map((r) => r.blocked), 0.5)).padStart(4)}`;
console.log(`${product}, ${width}x${height}${mobile ? " (drawer)" : ""}, CPU x${cpu}, ${fixture}, warm, ${APP}`);
console.log(`Items page: ${items.tiles} tiles mounted (${items.vaultTiles} in the vault); whole document ${items.nodes} nodes, ${items.images} images`);
console.log("ms from the click:");
for (const kind of Object.keys(samples)) for (const [route, rs] of Object.entries(samples[kind])) console.log(row(kind, route, rs));
console.log(`heap after GC: ${heapStart} MB before, ${heapEnd} MB after ${cycles} cycles`);
if (b.logs.length) console.log("console:", b.logs.slice(0, 12));
await b.close();
