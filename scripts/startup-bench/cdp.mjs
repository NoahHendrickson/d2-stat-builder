// The benches' browser: the shared headless-Chrome driver (scripts/browser/) with every
// /api/* request answered by the shared stub, plus a long-task observer the benches read
// from `window.__lt`.
import { launchBrowser, sleep } from "../browser/browser.mjs";
import { createStub } from "../browser/stub.mjs";

export { sleep };

const LONG_TASKS = "window.__lt=[];new PerformanceObserver(l=>{for(const e of l.getEntries())window.__lt.push([Math.round(e.startTime),Math.round(e.duration)])}).observe({type:'longtask',buffered:true});";

/**
 * Start Chrome on the profile in `dir` and attach to a blank page. `profile` is the
 * GetProfile body to serve; `fresh` wipes the Chrome profile first (cold caches). The
 * profile dir is kept afterwards so later runs can measure warm loads. Returns `s` (send a
 * CDP command to the page), `evalJs`, `logs` (console errors and warnings), and `close`.
 */
export async function launch({ dir, fresh = false, profile, width = 1280, height = 800 }) {
  const stub = createStub({ profile });
  const { page, close } = await launchBrowser({ profileDir: dir, fresh, keepProfile: true, width, height, interceptPatterns: ["*/api/*"], onRequest: stub.onRequest, initScripts: [LONG_TASKS] });
  return { s: page.s, evalJs: page.evalJs, logs: page.consoleLines, close };
}
