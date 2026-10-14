// The app server a verification run drives: started by `verify-d2 up` from this checkout
// on its own port, tracked in a state file, stopped only by `verify-d2 down`.
import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = "/tmp/verify-d2";
export const DEFAULT_PORT = 4400;
// .claude/skills/verify-d2/scripts/lib → the checkout this skill lives in.
export const CHECKOUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");

const statePath = (port) => path.join(ROOT, "servers", `${port}.json`);
export const readState = (port) => { try { return JSON.parse(fs.readFileSync(statePath(port), "utf8")); } catch { return null; } };
const writeState = (st) => { fs.mkdirSync(path.join(ROOT, "servers"), { recursive: true }); fs.writeFileSync(statePath(st.port), JSON.stringify(st, null, 2)); };
export const allStates = () => { try { return fs.readdirSync(path.join(ROOT, "servers")).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(fs.readFileSync(path.join(ROOT, "servers", f), "utf8"))); } catch { return []; } };

const sh = (cmd, args, opts = {}) => { try { return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], ...opts }).trim(); } catch { return ""; } };
export const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
export const listeners = (port) => sh("lsof", ["-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"]).split("\n").filter(Boolean).map(Number);
export const pgidOf = (pid) => Number(sh("ps", ["-o", "pgid=", "-p", String(pid)])) || null;
export const cwdOf = (pid) => sh("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]).split("\n").find((l) => l.startsWith("n"))?.slice(1) ?? null;

/** HEAD plus a hash of uncommitted changes under src/ and config: what a build was made from. */
export function sourceStamp() {
  const head = sh("git", ["-C", CHECKOUT, "rev-parse", "--short", "HEAD"]);
  const dirty = sh("git", ["-C", CHECKOUT, "status", "--porcelain", "--", "src", "public", "next.config.ts", "package.json", "postcss.config.mjs"]);
  const diff = dirty ? sh("git", ["-C", CHECKOUT, "diff", "HEAD", "--", "src", "public", "next.config.ts", "package.json", "postcss.config.mjs"]) + dirty : "";
  return { head, dirty: Boolean(dirty), hash: crypto.createHash("sha1").update(head + diff).digest("hex").slice(0, 10) };
}

/** The main checkout of this repository (first entry of `git worktree list`). */
function mainCheckout() {
  const first = sh("git", ["-C", CHECKOUT, "worktree", "list", "--porcelain"]).split("\n")[0];
  return first?.startsWith("worktree ") ? first.slice(9) : null;
}

/**
 * Worktrees have no node_modules or .env.local. Borrow the main checkout's as symlinks
 * (verification scaffolding, removed by `down`). Returns the links created.
 */
function scaffold(log) {
  const created = [];
  const main = mainCheckout();
  for (const name of ["node_modules", ".env.local"]) {
    const here = path.join(CHECKOUT, name);
    if (fs.existsSync(here) || fs.lstatSync(here, { throwIfNoEntry: false })) continue;
    const there = main && path.join(main, name);
    if (!there || there === here || !fs.existsSync(there)) throw new Error(`${name} is missing here and in the main checkout (${main}); run npm install / create .env.local first`);
    fs.symlinkSync(there, here);
    created.push(here);
    log(`scaffold: linked ${name} → ${there}`);
  }
  return created;
}

/** Another `next dev` serving this checkout (it would share .next/dev with ours). */
function otherDevServer() {
  const pids = sh("pgrep", ["-f", "next dev"]).split("\n").filter(Boolean).map(Number);
  return pids.find((pid) => cwdOf(pid) === CHECKOUT) ?? null;
}

async function waitReady(port, scheme, logFile, pid, timeoutMs) {
  const t0 = Date.now();
  // Ready means the pages render, not only that the port answers: in dev each route
  // compiles on its first request, so warm all of them before handing over.
  const routes = ["/", "/armor", "/weapons", "/loadouts", "/manager", "/settings"];
  let pending = [...routes];
  while (Date.now() - t0 < timeoutMs) {
    if (!alive(pid)) throw new Error(`server exited during startup; see ${logFile}`);
    const next = [];
    for (const r of pending) {
      try {
        const res = await fetch(`${scheme}://localhost:${port}${r}`, { redirect: "manual", signal: AbortSignal.timeout(120000) });
        const body = await res.text();
        if (res.status !== 200 || !body.includes("<html")) next.push(r);
      } catch { next.push(r); }
    }
    pending = next;
    if (!pending.length) return Date.now() - t0;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`not ready after ${timeoutMs} ms (still failing: ${pending.join(", ")}); see ${logFile}`);
}

/**
 * Start the app from this checkout. `mode`:
 *  - "prod" (default): `next build` then `next start`. Matches production, drives fast,
 *    and coexists with a `next dev` in the same checkout (dev writes .next/dev).
 *  - "dev": `next dev`. Faster to start; refuses if another `next dev` serves this checkout.
 */
export async function up({ port = DEFAULT_PORT, mode = "prod", log = console.log }) {
  const existing = readState(port);
  if (existing && alive(existing.pid)) throw new Error(`a verify server is already up on ${port} (pid ${existing.pid}, ${existing.mode}, ${existing.checkout}); run \`verify-d2 down --port ${port}\` first`);
  const holders = listeners(port);
  if (holders.length) throw new Error(`port ${port} is taken by pid ${holders.join(", ")} (not started by verify-d2); pick another with --port`);
  if (mode === "dev") {
    const other = otherDevServer();
    if (other) throw new Error(`pid ${other} already runs \`next dev\` in ${CHECKOUT}; two dev servers would share .next/dev. Use prod mode (the default) instead`);
  }
  fs.mkdirSync(path.join(ROOT, "servers"), { recursive: true });
  const created = scaffold(log);
  // Turbopack refuses a node_modules symlink that points outside the checkout.
  const webpack = fs.lstatSync(path.join(CHECKOUT, "node_modules")).isSymbolicLink();
  const next = path.join(CHECKOUT, "node_modules/.bin/next");
  const logFile = path.join(ROOT, "servers", `${port}.log`);
  fs.writeFileSync(logFile, "");
  const stamp = sourceStamp();
  const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };
  delete env.NODE_ENV;

  if (mode === "prod") {
    log(`building (${webpack ? "webpack" : "turbopack"}) from ${CHECKOUT} @ ${stamp.head}${stamp.dirty ? " + uncommitted changes" : ""}…`);
    const t0 = Date.now();
    const out = fs.openSync(logFile, "a");
    const build = spawn(next, ["build", ...(webpack ? ["--webpack"] : [])], { cwd: CHECKOUT, env, stdio: ["ignore", out, out] });
    const code = await new Promise((r) => build.on("exit", r));
    if (code !== 0) {
      for (const p of created) fs.rmSync(p, { force: true });
      throw new Error(`next build failed (exit ${code}); see ${logFile}`);
    }
    log(`built in ${Math.round((Date.now() - t0) / 1000)} s`);
  }
  const out = fs.openSync(logFile, "a");
  const args = mode === "prod" ? ["start", "-p", String(port)] : ["dev", ...(webpack ? ["--webpack"] : []), "-p", String(port)];
  // Detached: its own process group, so `down` can stop it and everything it spawned.
  const child = spawn(next, args, { cwd: CHECKOUT, env, stdio: ["ignore", out, out], detached: true });
  child.unref();
  const state = { port, pid: child.pid, pgid: child.pid, mode, bundler: webpack ? "webpack" : "turbopack", checkout: CHECKOUT, url: `http://localhost:${port}`, stamp, scaffolding: created, log: logFile, startedAt: new Date().toISOString() };
  writeState(state);
  try {
    const ms = await waitReady(port, "http", logFile, child.pid, mode === "dev" ? 600000 : 120000);
    log(`ready at ${state.url} after ${Math.round(ms / 1000)} s (pid ${child.pid}, ${mode}, ${state.bundler})`);
  } catch (e) {
    await down({ port, log });
    throw e;
  }
  return state;
}

export async function down({ port = DEFAULT_PORT, log = console.log }) {
  const st = readState(port);
  if (!st) { log(`no verify server recorded on ${port}`); return; }
  if (alive(st.pid)) {
    try { process.kill(-st.pgid, "SIGTERM"); } catch {}
    for (let i = 0; i < 50 && alive(st.pid); i++) await new Promise((r) => setTimeout(r, 100));
    if (alive(st.pid)) try { process.kill(-st.pgid, "SIGKILL"); } catch {}
    log(`stopped pid ${st.pid} (group ${st.pgid}) on ${port}`);
  }
  // Scaffolding links go once no other recorded server still needs them.
  const others = allStates().filter((o) => o.port !== port && alive(o.pid));
  for (const p of st.scaffolding ?? []) {
    if (others.some((o) => o.scaffolding?.includes(p))) continue;
    if (fs.lstatSync(p, { throwIfNoEntry: false })?.isSymbolicLink()) { fs.rmSync(p); log(`scaffold: removed ${p}`); }
  }
  fs.rmSync(statePath(port), { force: true });
}
