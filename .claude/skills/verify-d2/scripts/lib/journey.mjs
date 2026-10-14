// Runs one journey against a verify server: builds its stub from the fixture, launches a
// fresh headless Chrome, hands the journey its context, and writes the evidence.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { launchBrowser, sleep } from "../../../../../scripts/browser/browser.mjs";
import { route } from "../../../../../scripts/browser/routes.mjs";
import { createStub } from "../../../../../scripts/browser/stub.mjs";
import { CHECKOUT, ROOT, mainCheckout } from "./server.mjs";

export const CHROME_ROOT = path.join(ROOT, "chrome");

/** The fixture of this kind, here or (in a worktree) in the main checkout; they're gitignored. */
export function fixturePath(kind) {
  const name = kind === "small" ? ".profile.json" : ".profile-full.json";
  return [CHECKOUT, mainCheckout()].filter(Boolean).map((dir) => path.join(dir, "scripts/startup-bench", name)).find((f) => fs.existsSync(f)) ?? null;
}

/**
 * `file` exports `default async (ctx)` and optionally `meta`:
 * `{ fixture: "full" | "small", width, height, profile(profile) → profile, seed(profile) → stub seed }`.
 * Returns the run summary (also written to summary.json).
 */
export async function runJourney({ file, server }) {
  const mod = await import(pathToFileURL(file).href);
  const meta = { fixture: "full", width: 1600, height: 1000, ...mod.meta };
  const fixture = fixturePath(meta.fixture);
  if (!fixture) throw new Error(`fixture ${meta.fixture} missing; see \`verify-d2 doctor\``);
  // One parse: `meta.profile` can reshape the fixture for this journey's preconditions,
  // `meta.seed` builds the stub's starting store from the result.
  const base = JSON.parse(fs.readFileSync(fixture, "utf8"));
  const profile = meta.profile?.(base) ?? base;
  const stub = createStub({ profile: JSON.stringify(profile), seed: meta.seed?.(profile) ?? {} });

  // Port and pid keep two agents' runs of the same journey apart.
  const id = `${new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)}-${path.basename(file, ".mjs")}-p${server.port}-${process.pid}`;
  const out = path.join(ROOT, "runs", id);
  fs.mkdirSync(out, { recursive: true });
  const log = (line) => { const l = `${new Date().toISOString().slice(11, 23)} ${line}`; console.log(l); fs.appendFileSync(path.join(out, "steps.log"), l + "\n"); };

  // The What's new dialog opens on every fresh profile: mark the current release seen (read
  // from source, so it follows new releases).
  const release = /RELEASE_ID = "([^"]+)"/.exec(fs.readFileSync(path.join(CHECKOUT, "src/components/whats-new-dialog.tsx"), "utf8"))?.[1];
  const initScripts = release ? [`try { localStorage.setItem("stat-builder:whats-new-seen", ${JSON.stringify(release)}); } catch {}`] : [];

  log(`journey ${path.relative(CHECKOUT, file)} against ${server.url} (${server.mode} @ ${server.stamp.head}${server.stamp.dirty ? "+dirty" : ""}), fixture ${meta.fixture}, ${meta.width}x${meta.height}`);
  const t0 = Date.now();
  let error = null, browser = null;
  const evidence = [];
  try {
    browser = await launchBrowser({
      profileDir: path.join(CHROME_ROOT, id), width: meta.width, height: meta.height, initScripts,
      interceptPatterns: [`${new URL(server.url).origin}/api/*`], onRequest: stub.onRequest,
    });
    const { page } = browser;
    let shotN = 0;
    const shot = async (label, opts = {}) => {
      const base = path.join(out, `${String(++shotN).padStart(2, "0")}-${label.replace(/[^a-z0-9-]+/gi, "-")}`);
      await page.screenshot(`${base}.png`, opts);
      fs.writeFileSync(`${base}.aria.txt`, await page.aria(opts));
      evidence.push(`${base}.png`, `${base}.aria.txt`);
      log(`  📸 ${path.basename(base)}.png + .aria.txt`);
    };
    const app = {
      url: server.url,
      /** Load a route and wait until it's usable: loader gone, the view's own content on screen. */
      async open(p) {
        await page.goto(server.url + p);
        await page.waitFor({ css: '[aria-label="Loading progress"]' }, { gone: true, timeout: 120000 });
        const marker = route(p)?.marker;
        if (marker) await page.waitFor({ css: marker }, { timeout: 120000 });
        if (/sign in with bungie/i.test(await page.text())) throw new Error("the app shows the sign-in card: the session stub isn't being honoured");
      },
      /** Click the route's link in the desktop sidebar and wait for its content. */
      async nav(p) {
        const r = route(p);
        if (!r?.nav) throw new Error(`no sidebar link for ${p}`);
        await page.click({ role: "link", name: r.nav }, { within: { role: "navigation", name: "Main" } });
        await page.waitFor({ css: r.marker }, { timeout: 60000 });
      },
      /** Current toast titles, newest last. */
      toasts: () => page.evalJs(`[...document.querySelectorAll('[data-slot="toast-title"]')].map((e) => e.innerText.trim())`),
      /** Waits for a toast whose title matches and returns that title. */
      toast: (rx) => page.waitFor(async () => (await app.toasts()).find((t) => rx.test(t)), { timeout: 30000 }),
    };
    const expect = (cond, msg) => { if (!cond) throw new Error(`expectation failed: ${msg}`); log(`  ✔ ${msg}`); };
    const step = async (label, fn) => {
      const s0 = Date.now();
      log(`▶ ${label}`);
      await fn();
      log(`✓ ${label} (${Date.now() - s0} ms)`);
    };
    try {
      await mod.default({ page, app, stub, step, shot, expect, log, sleep });
    } catch (e) {
      error = e;
      log(`✗ ${e.message}`);
      try { await shot("failure"); } catch (e2) { log(`  (failure capture failed: ${e2.message})`); }
    }
  } catch (e) {
    error = e;
    log(`✗ ${e.message}`);
  } finally {
    fs.writeFileSync(path.join(out, "api.json"), JSON.stringify(stub.requests, null, 1));
    fs.writeFileSync(path.join(out, "console.txt"), (browser?.page.consoleLines ?? []).join("\n"));
    await browser?.close();
  }
  const summary = {
    journey: path.relative(CHECKOUT, file), ok: !error, error: error?.message ?? null, ms: Date.now() - t0,
    server: { url: server.url, mode: server.mode, source: server.stamp }, fixture: meta.fixture,
    writes: stub.writes().map((w) => `${w.method} ${w.path} → ${w.status}`), unstubbed: [...new Set(stub.unstubbed)],
    stubErrors: browser?.page.handlerErrors ?? [],
    consoleErrors: (browser?.page.consoleLines ?? []).filter((l) => !l.startsWith("warning")).length, evidence, dir: out,
  };
  fs.writeFileSync(path.join(out, "summary.json"), JSON.stringify(summary, null, 2));
  if (summary.unstubbed.length) log(`⚠ unstubbed API calls (answered 501): ${summary.unstubbed.join(", ")}`);
  if (summary.stubErrors.length) log(`⚠ the stub threw (answered 500): ${summary.stubErrors.join("; ")}`);
  log(`${error ? "FAILED" : "PASSED"} in ${Math.round(summary.ms / 1000)} s; evidence in ${out}`);
  return summary;
}
