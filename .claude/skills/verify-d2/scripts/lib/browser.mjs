// Headless Chrome over CDP, driven the way a user drives the page: elements are found
// by ARIA role + accessible name (Chrome's own accessibility tree), clicks and keys are
// real input events at the element's position, and a click on something covered by
// another element fails instead of reaching it anyway.
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function chromePath() {
  return CHROME;
}

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

// String names match case- and whitespace-insensitively: CSS text-transform leaks into the
// names Chrome computes ("Save" renders as "SAVE"). RegExp names match the raw name.
const norm = (v) => String(v ?? "").replace(/\s+/g, " ").trim().toLowerCase();

const KEYS = {
  Enter: [13, "\r"], Escape: [27], Tab: [9], Backspace: [8], Delete: [46], Space: [32, " "],
  ArrowLeft: [37], ArrowUp: [38], ArrowRight: [39], ArrowDown: [40], Home: [36], End: [35], PageUp: [33], PageDown: [34],
};

/** Describes a target for error messages. */
const show = (t) => (typeof t === "string" ? t : t.css ? `css ${t.css}` : `${t.role ?? "*"} ${t.name instanceof RegExp ? t.name : JSON.stringify(t.name ?? "")}${t.nth != null ? ` #${t.nth}` : ""}`);

/**
 * Launch Chrome on a fresh profile in `profileDir` and attach to one page.
 * `onRequest(params)` answers paused requests matching `interceptPatterns`; it must call
 * `fulfill` or `continueRequest` on the returned page object.
 */
export async function launchBrowser({ profileDir, width = 1600, height = 1000, interceptPatterns = [], onRequest, initScripts = [] }) {
  fs.rmSync(profileDir, { recursive: true, force: true });
  fs.mkdirSync(profileDir, { recursive: true });
  const port = await freePort();
  const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, "--ignore-certificate-errors", "--no-first-run", "--no-default-browser-check", "--disable-background-timer-throttling", `--window-size=${width},${height}`], { stdio: "ignore" });
  let wsUrl;
  for (let i = 0; i < 100 && !wsUrl; i++) {
    try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl; } catch { await sleep(100); }
  }
  if (!wsUrl) { chrome.kill(); throw new Error(`Chrome did not open its debugging port (${CHROME})`); }
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map(), handlers = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej, method } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) rej(new Error(`${method}: ${m.error.message}`)); else res(m.result);
    } else if (m.method) for (const h of handlers) h(m);
  };
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej, method }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const s = (m, p) => send(m, p, sessionId);

  const consoleLines = [];
  handlers.push(async (m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === "Fetch.requestPaused") await onRequest?.(m.params);
    else if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning")) consoleLines.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 400)}`);
    else if (m.method === "Runtime.exceptionThrown") consoleLines.push(`exception: ${(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 600)}`);
  });
  if (interceptPatterns.length) await s("Fetch.enable", { patterns: interceptPatterns.map((urlPattern) => ({ urlPattern })) });
  await s("Runtime.enable");
  await s("Page.enable");
  await s("DOM.enable");
  await s("Accessibility.enable");
  await s("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  for (const source of initScripts) await s("Page.addScriptToEvaluateOnNewDocument", { source });

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
    if (typeof target === "string") target = { css: target };
    let root = within ? (await resolve(within)).backendNodeId : await rootId();
    let ids;
    if (target.css) {
      const { object } = await s("DOM.resolveNode", { backendNodeId: root });
      const { result } = await s("Runtime.callFunctionOn", { objectId: object.objectId, functionDeclaration: "function (css) { return [...(this.querySelectorAll ? this : document).querySelectorAll(css)]; }", arguments: [{ value: target.css }] });
      const { result: props } = await s("Runtime.getProperties", { objectId: result.objectId, ownProperties: true });
      ids = [];
      for (const p of props) if (/^\d+$/.test(p.name)) ids.push((await s("DOM.describeNode", { objectId: p.value.objectId })).node.backendNodeId);
    } else {
      const params = { backendNodeId: root };
      if (target.role) params.role = target.role;
      const { nodes } = await s("Accessibility.queryAXTree", params);
      ids = nodes
        .filter((n) => !n.ignored && n.backendDOMNodeId)
        .filter((n) => target.name === undefined || (target.name instanceof RegExp ? target.name.test(n.name?.value ?? "") : norm(n.name?.value) === norm(target.name)))
        .map((n) => n.backendDOMNodeId);
    }
    const visible = [];
    for (const backendNodeId of ids) {
      const box = await callOn(backendNodeId, function () { const r = this.getBoundingClientRect(); const cs = getComputedStyle(this); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden"; }).catch(() => false);
      if (box) visible.push({ backendNodeId, target });
    }
    return visible;
  }

  /** Exactly one visible match (or the `nth`), else throws with the count. */
  async function resolve(target, within) {
    if (target?.backendNodeId) return target;
    const all = await findAll(target, within);
    const t = typeof target === "string" ? { css: target } : target;
    if (t.nth != null) {
      if (!all[t.nth]) throw new Error(`no match #${t.nth} for ${show(t)} (${all.length} visible)`);
      return all[t.nth];
    }
    if (all.length === 0) throw new Error(`nothing visible matches ${show(t)}`);
    if (all.length > 1) throw new Error(`${all.length} visible elements match ${show(t)}; narrow it with a name, \`within\`, or \`nth\``);
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
    s, evalJs, consoleLines,
    async findAll(target, opts = {}) { return findAll(target, opts.within); },
    async count(target, opts = {}) { return (await findAll(target, opts.within)).length; },
    async exists(target, opts = {}) { return (await findAll(target, opts.within)).length > 0; },
    resolve: (t, opts = {}) => resolve(t, opts.within),
    /** Text content of the element (innerText). */
    async text(target, opts = {}) {
      if (!target) return evalJs("document.body.innerText");
      return callOn((await resolve(target, opts.within)).backendNodeId, function () { return this.innerText ?? this.textContent; });
    },
    /** The accessible name Chrome computed for the element. */
    async name(target, opts = {}) {
      const el = await resolve(target, opts.within);
      const { nodes } = await s("Accessibility.getPartialAXTree", { backendNodeId: el.backendNodeId, fetchRelatives: false });
      return nodes[0]?.name?.value ?? "";
    },
    /** Reads attributes / properties: `attr(t, "aria-valuenow")`, `attr(t, "value")`. */
    async attr(target, name, opts = {}) {
      return callOn((await resolve(target, opts.within)).backendNodeId, function (n) { return n in this && typeof this[n] !== "function" && n !== "className" && !n.startsWith("aria") ? this[n] : this.getAttribute(n); }, [name]);
    },
    async hover(target, opts = {}) {
      const { x, y } = await center(await resolve(target, opts.within));
      await mouse("mouseMoved", x, y, { button: "none" });
    },
    async click(target, opts = {}) {
      const el = await resolve(target, opts.within);
      const { x, y, covered } = await center(el);
      if (covered && !opts.force) throw new Error(`click on ${show(target)} would land on ${covered}`);
      await mouse("mouseMoved", x, y, { button: "none" });
      for (let n = 1; n <= (opts.count ?? 1); n++) {
        await mouse("mousePressed", x, y, { clickCount: n, buttons: 1 });
        await mouse("mouseReleased", x, y, { clickCount: n });
      }
      await sleep(opts.settle ?? 120);
    },
    /** Drag from one element's centre to another's, in steps, with real mouse events. */
    async drag(from, to, opts = {}) {
      const a = await center(await resolve(from, opts.within));
      const b = await center(await resolve(to, opts.withinTo));
      await mouse("mouseMoved", a.x, a.y, { button: "none" });
      await mouse("mousePressed", a.x, a.y, { clickCount: 1, buttons: 1 });
      for (let i = 1; i <= 12; i++) { await mouse("mouseMoved", a.x + ((b.x - a.x) * i) / 12, a.y + ((b.y - a.y) * i) / 12, { buttons: 1 }); await sleep(16); }
      await mouse("mouseReleased", b.x, b.y, { clickCount: 1 });
      await sleep(opts.settle ?? 200);
    },
    /** Focus a text field by clicking it, select what's there, and type `text` over it. */
    async fill(target, text, opts = {}) {
      await page.click(target, opts);
      const el = await resolve(target, opts.within);
      await callOn(el.backendNodeId, function () { if (this.select) this.select(); else { const r = document.createRange(); r.selectNodeContents(this); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); } });
      if (text === "") await page.press("Backspace");
      else await s("Input.insertText", { text });
      await sleep(opts.settle ?? 150);
    },
    async type(text) { await s("Input.insertText", { text }); await sleep(100); },
    async press(key, opts = {}) {
      const [code, text] = KEYS[key] ?? [key.toUpperCase().charCodeAt(0), key];
      const modifiers = (opts.alt ? 1 : 0) | (opts.ctrl ? 2 : 0) | (opts.meta ? 4 : 0) | (opts.shift ? 8 : 0);
      await s("Input.dispatchKeyEvent", { type: "keyDown", key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, windowsVirtualKeyCode: code, text: modifiers ? undefined : text, modifiers });
      await s("Input.dispatchKeyEvent", { type: "keyUp", key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, windowsVirtualKeyCode: code, modifiers });
      await sleep(opts.settle ?? 60);
    },
    /** Moves a role=slider with the keyboard until aria-valuenow reaches `value`. */
    async setSlider(target, value, opts = {}) {
      await page.click(target, opts);
      for (let i = 0; i < 400; i++) {
        const now = Number(await page.attr(target, "aria-valuenow", opts));
        if (now === value) return;
        await page.press(now < value ? "ArrowRight" : "ArrowLeft", { settle: 10 });
        const after = Number(await page.attr(target, "aria-valuenow", opts));
        if (after === now) throw new Error(`slider ${show(target)} stuck at ${now} on the way to ${value}`);
      }
      throw new Error(`slider ${show(target)} never reached ${value}`);
    },
    /** Polls until the target is visible (or gone, with `{ gone: true }`), or a predicate returns truthy. */
    async waitFor(target, opts = {}) {
      const timeout = opts.timeout ?? 20000, t0 = Date.now();
      let last;
      while (Date.now() - t0 < timeout) {
        try {
          if (typeof target === "function") { if ((last = await target())) return last; }
          else if (typeof target === "string" && !opts.css && target.startsWith("js:")) { if ((last = await evalJs(target.slice(3)))) return last; }
          else {
            const n = (await findAll(target, opts.within)).length;
            if (opts.gone ? n === 0 : n > 0) return true;
          }
        } catch (e) { last = e.message; }
        await sleep(opts.interval ?? 100);
      }
      throw new Error(`timed out after ${timeout} ms waiting for ${typeof target === "function" ? "condition" : show(target)}${opts.gone ? " to go away" : ""}${last && typeof last === "string" ? ` (last: ${last})` : ""}`);
    },
    async waitForText(re, opts = {}) {
      const rx = re instanceof RegExp ? re : new RegExp(re.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      return page.waitFor(async () => { const t = opts.within ? await page.text(opts.within) : await evalJs("document.body.innerText"); return rx.test(t) && t.match(rx)[0]; }, opts);
    },
    async screenshot(file, opts = {}) {
      const params = { format: "png" };
      if (opts.within) {
        const el = await resolve(opts.within);
        const { model } = await s("DOM.getBoxModel", { backendNodeId: el.backendNodeId });
        const q = model.border;
        params.clip = { x: Math.min(q[0], q[6]), y: Math.min(q[1], q[3]), width: model.width, height: model.height, scale: 1 };
        params.captureBeyondViewport = true;
      } else if (opts.full) params.captureBeyondViewport = true;
      const { data } = await s("Page.captureScreenshot", params);
      fs.writeFileSync(file, Buffer.from(data, "base64"));
      return file;
    },
    /** Indented role "name" outline of the accessibility tree (or the subtree under `within`). */
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
        if (lines.length > (opts.maxLines ?? 4000)) return;
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
    /** `"coarse"` makes the page see a touch-first device (pointer: coarse, hover: none); `"fine"` restores a mouse. */
    async emulatePointer(kind) {
      // Media-feature overrides alone don't flip (pointer: coarse); touch emulation does.
      await s("Emulation.setTouchEmulationEnabled", kind === "coarse" ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
      return evalJs("matchMedia('(pointer: coarse)').matches");
    },
    async goto(url) { await s("Page.navigate", { url }); },
    async reload() { await s("Page.reload", { ignoreCache: false }); },
    fulfill: (requestId, status, body, headers = { "content-type": "application/json" }) =>
      s("Fetch.fulfillRequest", { requestId, responseCode: status, responseHeaders: Object.entries(headers).map(([name, value]) => ({ name, value })), body: Buffer.from(body).toString("base64") }).catch(() => {}),
    continueRequest: (requestId) => s("Fetch.continueRequest", { requestId }).catch(() => {}),
  };

  const close = async () => {
    try { ws.close(); } catch {}
    if (chrome.exitCode === null) {
      const exited = new Promise((r) => chrome.on("exit", r));
      chrome.kill();
      await Promise.race([exited, sleep(3000)]);
      if (chrome.exitCode === null) chrome.kill("SIGKILL");
    }
    fs.rmSync(profileDir, { recursive: true, force: true });
  };
  return { page, close, pid: chrome.pid, profileDir: path.resolve(profileDir) };
}
