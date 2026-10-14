// Headless Chrome over CDP for the benches and the verify-d2 skill, driven the way a user
// drives the page: elements are found by ARIA role + accessible name (Chrome's own
// accessibility tree), clicks and keys are real input events at the element's position,
// and a click on something covered by another element fails instead of reaching it anyway.
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

// Override with CHROME=/path/to/chrome (Linux, or a Playwright/Chromium build).
export const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Written into each profile dir: which Chrome runs there and which process drives it.
const OWNER = "owner.json";

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const argsOf = (pid) => { try { return execFileSync("ps", ["-o", "args=", "-p", String(pid)], { encoding: "utf8" }); } catch { return ""; } };

async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Profiles under `root` whose Chrome is still running but whose driving process is gone
 * (a run killed before it could close its browser). Live runs are never strays.
 */
export function strayBrowsers(root) {
  const out = [];
  for (const name of fs.existsSync(root) ? fs.readdirSync(root) : []) {
    const dir = path.join(root, name);
    let owner;
    try { owner = JSON.parse(fs.readFileSync(path.join(dir, OWNER), "utf8")); } catch { continue; }
    if (alive(owner.runnerPid)) continue;
    out.push({ dir, chromePid: owner.chromePid, running: alive(owner.chromePid) && argsOf(owner.chromePid).includes(dir) });
  }
  return out;
}

/** Stops the strays' Chrome and deletes their profiles. Returns what it stopped. */
export function killStrayBrowsers(root) {
  const strays = strayBrowsers(root);
  for (const s of strays) {
    if (s.running) try { process.kill(s.chromePid, "SIGKILL"); } catch {}
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
  return strays;
}

// String names match case- and whitespace-insensitively: CSS text-transform leaks into the
// names Chrome computes ("Save" renders as "SAVE"). RegExp names match the raw name.
const norm = (v) => String(v ?? "").replace(/\s+/g, " ").trim().toLowerCase();
const show = (t) => (t.css ? `css ${t.css}` : `${t.role ?? "*"} ${t.name instanceof RegExp ? t.name : JSON.stringify(t.name ?? "")}${t.nth != null ? ` #${t.nth}` : ""}`);

// Named keys → [key, code, keyCode]. Single characters are derived in keyInfo().
const KEYS = {
  Enter: ["Enter", "Enter", 13], Escape: ["Escape", "Escape", 27], Tab: ["Tab", "Tab", 9], Backspace: ["Backspace", "Backspace", 8],
  Space: [" ", "Space", 32], ArrowLeft: ["ArrowLeft", "ArrowLeft", 37], ArrowUp: ["ArrowUp", "ArrowUp", 38],
  ArrowRight: ["ArrowRight", "ArrowRight", 39], ArrowDown: ["ArrowDown", "ArrowDown", 40], Home: ["Home", "Home", 36], End: ["End", "End", 35],
};
function keyInfo(key) {
  if (KEYS[key]) return KEYS[key];
  if (/^[0-9]$/.test(key)) return [key, `Digit${key}`, key.charCodeAt(0)];
  if (/^[a-z]$/i.test(key)) return [key, `Key${key.toUpperCase()}`, key.toUpperCase().charCodeAt(0)];
  throw new Error(`press(): no key mapping for ${JSON.stringify(key)}`);
}

// Runs in the page: what a sighted user could see. Rejects screen-reader-only boxes (1px or
// clipped), and anything hidden by visibility or by opacity 0 on it or an ancestor. Elements
// merely scrolled out of view still count: click() scrolls them in first.
function visibleInPage() {
  const r = this.getBoundingClientRect();
  if (r.width <= 1 || r.height <= 1) return false;
  const hides = (el) => {
    const cs = getComputedStyle(el);
    return cs.visibility === "hidden" || cs.display === "none" || cs.opacity === "0" || /^rect\(0(px)?,? 0(px)?,? 0(px)?,? 0(px)?\)$/.test(cs.clip) || cs.clipPath === "inset(50%)";
  };
  if (hides(this)) return false;
  for (let el = this.parentElement; el; el = el.parentElement) if (hides(el)) return false;
  return true;
}

/**
 * Launch Chrome on the profile in `profileDir` and attach to one page. `fresh` (default)
 * starts from an empty profile and `keepProfile: false` (default) deletes it on close; the
 * benches keep theirs to measure warm loads. Paused requests matching `interceptPatterns`
 * go to `onRequest(params, page)`, which must answer with `page.fulfill` or
 * `page.continueRequest`; if it throws, the request gets a 500 and the error lands in
 * `handlerErrors` instead of crashing the process.
 */
export async function launchBrowser({ profileDir, fresh = true, keepProfile = false, width = 1600, height = 1000, interceptPatterns = [], onRequest, initScripts = [] }) {
  if (fresh) fs.rmSync(profileDir, { recursive: true, force: true });
  fs.mkdirSync(profileDir, { recursive: true });
  const port = await freePort();
  const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, "--ignore-certificate-errors", "--no-first-run", "--no-default-browser-check", "--disable-background-timer-throttling", `--window-size=${width},${height}`], { stdio: "ignore" });
  fs.writeFileSync(path.join(profileDir, OWNER), JSON.stringify({ chromePid: chrome.pid, runnerPid: process.pid }));
  let ws;
  const stop = async () => {
    try { ws?.close(); } catch {}
    if (chrome.exitCode === null && chrome.signalCode === null) {
      const exited = new Promise((r) => chrome.once("exit", r));
      chrome.kill();
      await Promise.race([exited, sleep(3000)]);
      if (chrome.exitCode === null && chrome.signalCode === null) chrome.kill("SIGKILL");
    }
    if (!keepProfile) fs.rmSync(profileDir, { recursive: true, force: true });
    else fs.rmSync(path.join(profileDir, OWNER), { force: true });
  };
  try {
    return await attach();
  } catch (e) {
    // Setup failed after Chrome started: don't leave it running.
    await stop();
    throw e;
  }

  async function attach() {
    let wsUrl;
    for (let i = 0; i < 100 && !wsUrl; i++) {
      try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl; } catch { await sleep(100); }
    }
    if (!wsUrl) throw new Error(`Chrome did not open its debugging port (${CHROME})`);
    ws = new WebSocket(wsUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error("CDP WebSocket failed to open")); });
    let id = 0;
    const pending = new Map(), handlers = [];
    // Register before the first command so no event is missed.
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) {
        const { res, rej, method } = pending.get(m.id);
        pending.delete(m.id);
        if (m.error) rej(new Error(`${method}: ${m.error.message}`)); else res(m.result);
      } else if (m.method) for (const h of handlers) Promise.resolve(h(m)).catch(() => {});
    };
    const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej, method }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const s = (m, p) => send(m, p, sessionId);

    const consoleLines = [], handlerErrors = [];
    handlers.push(async (m) => {
      if (m.sessionId !== sessionId) return;
      if (m.method === "Fetch.requestPaused") {
        try { await onRequest(m.params, page); } catch (e) {
          handlerErrors.push(`${m.params.request.method} ${m.params.request.url}: ${e.message}`);
          await page.fulfill(m.params.requestId, 500, JSON.stringify({ error: `request handler threw: ${e.message}` }));
        }
      } else if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning")) consoleLines.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 400)}`);
      else if (m.method === "Runtime.exceptionThrown") consoleLines.push(`exception: ${(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 600)}`);
    });

    const evalJs = async (expression) => {
      const out = await s("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (out.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description ?? out.exceptionDetails.text);
      return out.result.value;
    };
    const callOn = async (backendNodeId, fn, args = []) => {
      const { object } = await s("DOM.resolveNode", { backendNodeId });
      const out = await s("Runtime.callFunctionOn", { objectId: object.objectId, functionDeclaration: fn.toString(), arguments: args.map((value) => ({ value })), returnByValue: true, awaitPromise: true });
      if (out.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description ?? out.exceptionDetails.text);
      return out.result.value;
    };
    const rootId = async () => (await s("DOM.getDocument", { depth: 0 })).root.backendNodeId;

    /** All visible matches for a target, in document order. */
    async function findAll(target, within) {
      const root = within ? (await resolve(within)).backendNodeId : await rootId();
      if (target.css) {
        // One call: query and filter for visibility in the page, then name each match.
        const { object } = await s("DOM.resolveNode", { backendNodeId: root });
        const { result } = await s("Runtime.callFunctionOn", {
          objectId: object.objectId,
          functionDeclaration: `function (css) { const visible = ${visibleInPage.toString()}; return [...(this.querySelectorAll ? this : document).querySelectorAll(css)].filter((el) => visible.call(el)); }`,
          arguments: [{ value: target.css }],
        });
        const { result: props } = await s("Runtime.getProperties", { objectId: result.objectId, ownProperties: true });
        const els = props.filter((p) => /^\d+$/.test(p.name)).sort((a, b) => a.name - b.name);
        return Promise.all(els.map(async (p) => ({ backendNodeId: (await s("DOM.describeNode", { objectId: p.value.objectId })).node.backendNodeId })));
      }
      const params = { backendNodeId: root };
      if (target.role) params.role = target.role;
      const { nodes } = await s("Accessibility.queryAXTree", params);
      const ids = nodes
        .filter((n) => !n.ignored && n.backendDOMNodeId)
        .filter((n) => target.name === undefined || (target.name instanceof RegExp ? target.name.test(n.name?.value ?? "") : norm(n.name?.value) === norm(target.name)))
        .map((n) => n.backendDOMNodeId);
      const shown = await Promise.all(ids.map((backendNodeId) => callOn(backendNodeId, visibleInPage).catch(() => false)));
      return ids.filter((_, i) => shown[i]).map((backendNodeId) => ({ backendNodeId }));
    }

    /** Exactly one visible match (or the `nth`), else throws with the count. */
    async function resolve(target, within) {
      if (target?.backendNodeId) return target;
      const all = await findAll(target, within);
      if (target.nth != null) {
        if (!all[target.nth]) throw new Error(`no match #${target.nth} for ${show(target)} (${all.length} visible)`);
        return all[target.nth];
      }
      if (all.length === 0) throw new Error(`nothing visible matches ${show(target)}`);
      if (all.length > 1) throw new Error(`${all.length} visible elements match ${show(target)}; narrow it with a name, \`within\`, or \`nth\``);
      return all[0];
    }

    async function center(el) {
      await s("DOM.scrollIntoViewIfNeeded", { backendNodeId: el.backendNodeId }).catch(() => {});
      const { model } = await s("DOM.getBoxModel", { backendNodeId: el.backendNodeId });
      const q = model.border;
      const x = (q[0] + q[2] + q[4] + q[6]) / 4, y = (q[1] + q[3] + q[5] + q[7]) / 4;
      const covered = await callOn(el.backendNodeId, function (x, y) {
        const hit = document.elementFromPoint(x, y);
        if (!hit || this === hit || this.contains(hit) || hit.contains(this)) return null;
        return `${hit.tagName.toLowerCase()}${hit.id ? "#" + hit.id : ""}${hit.getAttribute("aria-label") ? `[aria-label="${hit.getAttribute("aria-label")}"]` : ""}.${String(hit.className).slice(0, 80)}`;
      }, [x, y]);
      return { x, y, covered };
    }
    const mouse = (type, x, y, extra = {}) => s("Input.dispatchMouseEvent", { type, x, y, button: "left", pointerType: "mouse", ...extra });

    const page = {
      s, evalJs, consoleLines, handlerErrors,
      findAll: (t, opts = {}) => findAll(t, opts.within),
      count: async (t, opts = {}) => (await findAll(t, opts.within)).length,
      exists: async (t, opts = {}) => (await findAll(t, opts.within)).length > 0,
      resolve: (t, opts = {}) => resolve(t, opts.within),
      /** The accessible name Chrome computed for the element. */
      async name(target, opts = {}) {
        const el = await resolve(target, opts.within);
        const { nodes } = await s("Accessibility.getPartialAXTree", { backendNodeId: el.backendNodeId, fetchRelatives: false });
        return nodes[0]?.name?.value ?? "";
      },
      /** Rendered text (innerText; follows CSS text-transform), or the whole body's. */
      async text(target, opts = {}) {
        if (!target) return evalJs("document.body.innerText");
        return callOn((await resolve(target, opts.within)).backendNodeId, function () { return this.innerText ?? this.textContent; });
      },
      /** An attribute as written in the DOM (`getAttribute`), e.g. "aria-pressed". */
      async attr(target, name, opts = {}) {
        return callOn((await resolve(target, opts.within)).backendNodeId, function (n) { return this.getAttribute(n); }, [name]);
      },
      /** A form control's current `value`. */
      async value(target, opts = {}) {
        return callOn((await resolve(target, opts.within)).backendNodeId, function () { return this.value; });
      },
      async hover(target, opts = {}) {
        const { x, y } = await center(await resolve(target, opts.within));
        await mouse("mouseMoved", x, y, { button: "none" });
      },
      async click(target, opts = {}) {
        const { x, y, covered } = await center(await resolve(target, opts.within));
        if (covered) throw new Error(`click on ${show(target.backendNodeId ? { css: "<element>" } : target)} would land on ${covered}`);
        await mouse("mouseMoved", x, y, { button: "none" });
        await mouse("mousePressed", x, y, { clickCount: 1, buttons: 1 });
        await mouse("mouseReleased", x, y, { clickCount: 1 });
        await sleep(opts.settle ?? 120);
      },
      /** Click a text field, select what's there, and type `text` over it ("" clears it). */
      async fill(target, text, opts = {}) {
        const el = await resolve(target, opts.within);
        await page.click(el, opts);
        await callOn(el.backendNodeId, function () { if (this.select) this.select(); else { const r = document.createRange(); r.selectNodeContents(this); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); } });
        if (text === "") await page.press("Backspace");
        else await s("Input.insertText", { text });
        await sleep(opts.settle ?? 150);
      },
      /** Type into whatever has focus. */
      async type(text) { await s("Input.insertText", { text }); await sleep(100); },
      async press(keyName, opts = {}) {
        const [key, code, keyCode] = keyInfo(keyName);
        const text = key.length === 1 ? key : key === "Enter" ? "\r" : undefined;
        await s("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: keyCode, text });
        await s("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: keyCode });
        await sleep(opts.settle ?? 60);
      },
      /** Polls until the target is visible (or gone, with `{ gone: true }`), or `fn()` returns truthy (its value is returned). */
      async waitFor(target, opts = {}) {
        const timeout = opts.timeout ?? 20000, t0 = Date.now();
        let last;
        while (Date.now() - t0 < timeout) {
          try {
            if (typeof target === "function") { if ((last = await target())) return last; }
            else {
              const n = (await findAll(target, opts.within)).length;
              if (opts.gone ? n === 0 : n > 0) return true;
            }
          } catch (e) { last = e.message; }
          await sleep(opts.interval ?? 100);
        }
        throw new Error(`timed out after ${timeout} ms waiting for ${typeof target === "function" ? "condition" : show(target)}${opts.gone ? " to go away" : ""}${typeof last === "string" ? ` (last: ${last})` : ""}`);
      },
      async waitForText(re, opts = {}) {
        return page.waitFor(async () => {
          const t = opts.within ? await page.text(opts.within) : await evalJs("document.body.innerText");
          return re.exec(t)?.[0];
        }, opts);
      },
      async screenshot(file, opts = {}) {
        const params = { format: "png" };
        if (opts.within) {
          const el = await resolve(opts.within);
          await s("DOM.scrollIntoViewIfNeeded", { backendNodeId: el.backendNodeId }).catch(() => {});
          const { model } = await s("DOM.getBoxModel", { backendNodeId: el.backendNodeId });
          // The box model is viewport-relative; the clip is document-relative.
          const { cssVisualViewport: vp } = await s("Page.getLayoutMetrics");
          const q = model.border;
          params.clip = { x: Math.min(q[0], q[6]) + vp.pageX, y: Math.min(q[1], q[3]) + vp.pageY, width: model.width, height: model.height, scale: 1 };
          params.captureBeyondViewport = true;
        }
        const { data } = await s("Page.captureScreenshot", params);
        fs.writeFileSync(file, Buffer.from(data, "base64"));
        return file;
      },
      /** Indented `role "name"` outline of the accessibility tree (or the subtree under `within`). */
      async aria(opts = {}) {
        const { nodes } = await s("Accessibility.getFullAXTree");
        const byId = new Map(nodes.map((n) => [n.nodeId, n]));
        let roots = nodes.filter((n) => !n.parentId);
        if (opts.within) {
          const el = await resolve(opts.within);
          roots = nodes.filter((n) => n.backendDOMNodeId === el.backendNodeId);
        }
        const SKIP = new Set(["generic", "none", "InlineTextBox", "LineBreak", "presentation"]);
        const lines = [];
        // `owner` is the nearest printed ancestor's name: text already spelled out in it is not repeated.
        const walk = (n, depth, owner = "") => {
          if (lines.length > 4000) return;
          const role = n.role?.value, name = (n.name?.value ?? "").replace(/\s+/g, " ").trim();
          const keep = !n.ignored && !SKIP.has(role) && !(role === "StaticText" && (!name || owner.toLowerCase().includes(name.toLowerCase())));
          if (keep) {
            const props = Object.fromEntries((n.properties ?? []).map((p) => [p.name, p.value?.value]));
            const flags = [];
            if (n.value?.value !== undefined && n.value.value !== "") flags.push(`value=${JSON.stringify(n.value.value)}`);
            for (const k of ["checked", "pressed", "expanded"]) if (props[k] !== undefined) flags.push(`${k}=${props[k]}`);
            for (const k of ["selected", "disabled", "busy", "invalid"]) if (props[k] === true) flags.push(k);
            if (props.valuetext !== undefined && String(props.valuetext) !== String(n.value?.value)) flags.push(`valuetext=${props.valuetext}`);
            lines.push(`${"  ".repeat(depth)}${role === "StaticText" ? "text" : role}${name ? ` ${JSON.stringify(name.slice(0, 160))}` : ""}${flags.length ? ` [${flags.join(", ")}]` : ""}`);
          }
          for (const c of n.childIds ?? []) { const child = byId.get(c); if (child) walk(child, keep ? depth + 1 : depth, keep && name ? name : owner); }
        };
        for (const r of roots) walk(r, 0);
        return lines.join("\n");
      },
      async goto(url) { await s("Page.navigate", { url }); },
      /** `"coarse"`: a touch-first device, so (pointer: coarse) matches; `"fine"`: a mouse. Returns whether coarse now matches. */
      async emulatePointer(kind) {
        // Media-feature overrides alone don't flip (pointer: coarse); touch emulation does.
        await s("Emulation.setTouchEmulationEnabled", kind === "coarse" ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
        return evalJs("matchMedia('(pointer: coarse)').matches");
      },
      fulfill: (requestId, status, body, headers = { "content-type": "application/json" }) =>
        s("Fetch.fulfillRequest", { requestId, responseCode: status, responseHeaders: Object.entries(headers).map(([name, value]) => ({ name, value })), body: Buffer.from(body).toString("base64") }).catch(() => {}),
      continueRequest: (requestId) => s("Fetch.continueRequest", { requestId }).catch(() => {}),
    };

    if (interceptPatterns.length) await s("Fetch.enable", { patterns: interceptPatterns.map((urlPattern) => ({ urlPattern })) });
    await s("Runtime.enable");
    await s("Page.enable");
    await s("DOM.enable");
    await s("Accessibility.enable");
    await s("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    for (const source of initScripts) await s("Page.addScriptToEvaluateOnNewDocument", { source });
    return { page, close: stop, pid: chrome.pid };
  }
}
