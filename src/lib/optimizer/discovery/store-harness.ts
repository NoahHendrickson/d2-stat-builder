// Model-based operation-sequence harness for optimizer-store.ts (discovery suite).
//
// An op list (run / cancel / applyPending / warm / worker messages / worker errors /
// clock advances) is replayed against the real store wired to scripted fake workers,
// and after EVERY op the store is compared with an independent reference model of
// what the snapshot and the slider-ceiling overlay should claim to the user.
//
// Two modes:
//  - "protocol": each fake worker emits a protocol-plausible message sequence per
//    request (progress*, ceilings*, then either one final result, or an interim
//    refining:true result, more progress/ceilings, an optional "better", and a final
//    refining:false result). Messages are delivered in order per worker, but from ANY
//    worker ever created (late messages from terminated workers included). The model
//    predicts the exact snapshot.
//  - "adversarial": additionally re-delivers arbitrary scripted messages (duplicates,
//    out of order, other requests' messages) — only safety invariants are checked.
//
// Outputs carry ceilings in a per-seq value band (seq*1000 + …), so any overlay value
// identifies the request it came from.
import { vi } from "vitest";
import {
  createOptimizerStore,
  type CeilingsView,
  type OptimizerSnapshot,
  type OptimizerStore,
  type WorkerLike,
} from "../optimizer-store";
import { computeCeilingCarry } from "../carryover";
import { mulberry32, randInt } from "../test-rng";
import type {
  CeilingCarry,
  OptimizerInput,
  OptimizerLoadout,
  OptimizerOutput,
  OptimizerRequest,
  OptimizerResponse,
  RefinementState,
  StatArray,
} from "../types";
import type { QueryOrigin } from "../../loadouts/types";

// ---------------------------------------------------------------------------------------
// Input domain

const mk = (minimums: number[], extra: Partial<OptimizerInput> = {}): OptimizerInput => ({
  slots: [[], [], [], [], []],
  minimums,
  ...extra,
});

/**
 * Small query domain: Q1 tightens Q0, Q2 tightens Q0 but is MIXED vs Q1, Q3 tightens
 * Q1/Q2 (and Q1/Q2 loosen it), Q4 differs in mods (no carry from anything else).
 */
export const QUERIES: OptimizerInput[] = [
  mk([0, 0, 0, 0, 0, 0]),
  mk([10, 0, 0, 0, 0, 0]),
  mk([0, 10, 0, 0, 0, 0]),
  mk([10, 10, 0, 0, 0, 0]),
  mk([0, 0, 0, 0, 0, 0], { mods: { major: 1, minor: 0 } }),
];
/** Builder states; index ≥ ORIGINS.length means "a fresh object every time". */
export const ORIGINS: QueryOrigin[] = [
  { targets: [1, 0, 0, 0, 0, 0] },
  { targets: [2, 0, 0, 0, 0, 0] },
  { targets: [3, 0, 0, 0, 0, 0], setBonuses: { 7: 2 } },
];

// ---------------------------------------------------------------------------------------
// Ops

export type Op =
  | { k: "run"; q: number; o: number; script: number }
  | { k: "cancel" }
  | { k: "apply" }
  | { k: "warm" }
  /** Deliver the next n queued messages of a worker (w < 0 → the newest worker). */
  | { k: "deliver"; w: number; n: number }
  | { k: "advance"; ms: number }
  /** onerror on a worker; `dead` = the worker can never run anything again. */
  | { k: "error"; w: number; dead: boolean }
  /** Adversarial: re-deliver any message ever scripted for a worker. */
  | { k: "chaos"; w: number; pick: number };

export interface HarnessOptions {
  mode: "protocol" | "adversarial";
  /** Strict: a query whose refinement died with the worker must restart on re-run. */
  checkErrorRestart: boolean;
  /** Strict: shown.origin is the origin of the LATEST run() of shown.key. */
  checkOriginFresh: boolean;
  /** Generate onerror on the current worker while it is idle (after the final result / warm). */
  allowIdleErrors: boolean;
  /** Generate onerror on terminated workers. */
  allowStaleErrors: boolean;
  /** Generate errors that leave the worker dead (script load failure / crash). */
  allowDeadWorkers: boolean;
  /** Adversarial: refinement ceilings streams may dip below what is shown (store must max-merge). */
  noisyCeilings?: boolean;
  /** Log every delivered message. */
  debug?: boolean;
}

export const STRICT: HarnessOptions = {
  mode: "protocol",
  checkErrorRestart: true,
  checkOriginFresh: true,
  allowIdleErrors: true,
  allowStaleErrors: true,
  allowDeadWorkers: true,
};
/** Known-finding gates off: what the green suite runs. */
export const GREEN: HarnessOptions = {
  mode: "protocol",
  checkErrorRestart: false,
  checkOriginFresh: false,
  allowIdleErrors: false,
  allowStaleErrors: false,
  allowDeadWorkers: false,
};

// ---------------------------------------------------------------------------------------
// Coverage

export type Stats = Record<string, number>;
export const coverage: Stats = {};
const bump = (k: string, n = 1) => {
  coverage[k] = (coverage[k] ?? 0) + n;
};

// ---------------------------------------------------------------------------------------
// Fake worker + scripts

const IDLE: RefinementState = { phase: "idle" };
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const fmt = (v: unknown) => JSON.stringify(v);

class FW implements WorkerLike {
  onmessage: ((e: MessageEvent<OptimizerResponse>) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  posted: OptimizerRequest[] = [];
  queue: OptimizerResponse[] = [];
  scripted: OptimizerResponse[] = [];
  terminated = false;
  dead = false;
  constructor(
    readonly id: number,
    private readonly onPost: (w: FW, req: OptimizerRequest) => void,
  ) {}
  postMessage(req: OptimizerRequest) {
    this.onPost(this, req);
  }
  terminate() {
    this.terminated = true;
  }
  emit(msg: OptimizerResponse) {
    this.onmessage?.({ data: msg } as MessageEvent<OptimizerResponse>);
  }
}

function mkLoadouts(rng: () => number): OptimizerLoadout[] {
  const n = randInt(rng, 0, 2);
  const out: OptimizerLoadout[] = [];
  for (let i = 0; i < n; i++) {
    const stats = [0, 1, 2, 3, 4, 5].map(() => randInt(rng, 0, 80));
    out.push({
      pieceIds: [`h${i}`, "a", "c", "l", "k"],
      baseStats: stats,
      stats,
      tuningBonus: [0, 0, 0, 0, 0, 0],
      tuning: [null, null, null, null, null],
      modBonus: [0, 0, 0, 0, 0, 0],
      modsUsed: { major: 0, minor: 0 },
      artificeBonus: [0, 0, 0, 0, 0, 0],
      artifice: [null, null, null, null, null],
      total: stats.reduce((a, b) => a + b, 0),
      exotic: false,
      power: null,
    });
  }
  return out;
}

/** What each scripted output is: which request produced it. */
interface Prov {
  seq: number;
  key: string;
}

/**
 * Protocol-plausible message sequence for one request (mirrors session.ts): ceilings
 * stream monotone non-decreasing within the request, the interim and final results
 * share the frozen loadouts, the final's ceilings dominate everything streamed, and
 * "better" (capped runs only) precedes the final and carries the final's ceilings.
 */
function makeScript(
  seq: number,
  scriptSeed: number,
  reg: (o: OptimizerOutput) => void,
  noisy = false,
): OptimizerResponse[] {
  const rng = mulberry32(scriptSeed);
  const base = seq * 1000;
  let k = 0;
  const vec = (): StatArray => [0, 1, 2, 3, 4, 5].map((s) => base + k * 10 + s);
  const step = () => {
    k += randInt(rng, 0, 2);
  };
  const out = (
    ceilings: StatArray,
    exact: boolean,
    capped: boolean,
    loadouts: OptimizerLoadout[],
  ): OptimizerOutput => {
    const o: OptimizerOutput = {
      loadouts,
      combosTried: 0,
      combosValid: loadouts.length,
      combosValidExact: true,
      ceilings,
      ceilingUppers: exact ? ceilings : ceilings.map((v) => v + 500),
      ceilingsExact: exact,
      capped,
    };
    reg(o);
    return o;
  };
  const msgs: OptimizerResponse[] = [];
  let p = 0;
  let refining = false;
  const stream = (n: number, ceilings = true) => {
    for (let i = 0; i < n; i++) {
      if (!ceilings || rng() < 0.4) {
        p = Math.min(1, p + Math.round(rng() * 30) / 100);
        msgs.push({ seq, kind: "progress", progress: p });
      } else {
        step();
        const c = vec();
        msgs.push({ seq, kind: "ceilings", ceilings: noisy && refining ? c.map((v) => v - randInt(rng, 0, 40)) : c });
      }
    }
  };
  const loadouts = mkLoadouts(rng);
  stream(randInt(rng, 0, 5));
  step();
  const shape = randInt(rng, 0, 2);
  if (shape === 0) {
    // Uncapped, exact: the single final post.
    msgs.push({ seq, kind: "result", output: out(vec(), true, false, loadouts), refining: false, verified: true });
    return msgs;
  }
  const capped = shape === 2;
  const exact1 = capped && rng() < 0.2;
  const interim = out(vec(), exact1, capped, loadouts);
  msgs.push({ seq, kind: "result", output: interim, refining: true, verified: !capped });
  p = 0;
  // Exact interim ceilings (= proven uppers) cannot move during refinement.
  refining = true;
  stream(randInt(rng, 0, 5), !exact1);
  if (!exact1 && rng() < 0.4) step();
  const cf = vec();
  const exactF = exact1 || rng() < 0.5;
  if (capped && rng() < 0.5) {
    msgs.push({ seq, kind: "better", output: out(cf, exactF, rng() < 0.5, mkLoadouts(rng)) });
  }
  const final: OptimizerOutput = {
    ...interim,
    ceilings: cf,
    ceilingUppers: exactF ? cf : cf.map((v) => v + 500),
    ceilingsExact: exactF,
  };
  reg(final);
  msgs.push({ seq, kind: "result", output: final, refining: false, verified: capped ? rng() < 0.5 : true });
  return msgs;
}

// ---------------------------------------------------------------------------------------
// Reference model

interface Run {
  seq: number;
  key: string;
  input: OptimizerInput;
  origin: QueryOrigin;
  worker: FW;
  cancelled: boolean;
  errored: boolean;
  interim: OptimizerOutput | null;
  final: OptimizerOutput | null;
  carry: CeilingCarry | undefined;
  /** Every per-stat value this run may legitimately put on the overlay. */
  allowed: Set<number>[];
  /** Every output of this run the store accepted. */
  outputs: OptimizerOutput[];
  /** Last overlay values observed while this run was the latest (for monotonicity). */
  lastShown: StatArray | null;
}

export class HarnessViolation extends Error {}

export function replay(ops: Op[], opt: HarnessOptions): void {
  vi.useFakeTimers({ now: 0 });
  try {
    replayInner(ops, opt);
  } finally {
    vi.useRealTimers();
  }
}

function replayInner(ops: Op[], opt: HarnessOptions): void {
  const workers: FW[] = [];
  const prov = new WeakMap<OptimizerOutput, Prov>();
  let nextScriptSeed = 0;
  let lastPost = null as { w: FW; req: OptimizerRequest } | null;
  let posts = 0;
  const trace: string[] = [];
  const fail = (msg: string): never => {
    throw new HarnessViolation(`${msg}\n--- trace ---\n${trace.join("\n")}`);
  };

  const onPost = (w: FW, req: OptimizerRequest) => {
    posts++;
    lastPost = { w, req };
    if (w.terminated) fail(`request seq ${req.seq} posted to a TERMINATED worker #${w.id}`);
    if (w.dead) fail(`request seq ${req.seq} posted to a DEAD worker #${w.id} — the run would spin forever`);
    // (adversarial chaos can deliver a final result ahead of its queued messages, so the
    // store legitimately reuses a worker the fake still has queued output for)
    if (opt.mode === "protocol" && w.queue.length > 0)
      fail(`request seq ${req.seq} posted to worker #${w.id} that is still busy with seq ${w.queue[0].seq} — it queues behind`);
    w.posted.push(req);
    const key = JSON.stringify(req.input);
    const script = makeScript(req.seq, nextScriptSeed, (o) => prov.set(o, { seq: req.seq, key }), !!opt.noisyCeilings);
    w.queue.push(...script);
    w.scripted.push(...script);
  };
  const store: OptimizerStore = createOptimizerStore(
    () => {
      const w = new FW(workers.length, onPost);
      workers.push(w);
      return w;
    },
    () => Date.now(),
  );

  // Overlay publish log (time + which op was running).
  let curOpKind = "";
  let lastHelperPublishAt = Number.NEGATIVE_INFINITY;
  store.ceilingsView.subscribe(() => {
    const at = Date.now();
    if (curOpKind === "run") return; // run()'s direct seed write is not a throttled publish
    if (curOpKind === "ceilings" || curOpKind === "advance") {
      if (curOpKind === "advance") bump("trailing-edge publishes");
      if (at - lastHelperPublishAt < 100)
        fail(`streamed overlay publish at t=${at} only ${at - lastHelperPublishAt}ms after the previous publish`);
    }
    lastHelperPublishAt = at;
  });

  // ---- model state
  let cur = null as Run | null;
  let maxSeq = 0;
  let last = null as { input: OptimizerInput; key: string; output: OptimizerOutput } | null;
  let shown = null as { result: OptimizerOutput; origin: QueryOrigin; key: string } | null;
  let shownFinal = false;
  let running = false;
  let runId = 0;
  let ref: RefinementState = IDLE;
  let progress = 0;
  let refProgress = 0;
  let offer = null as { values: StatArray; at: number } | null;
  const latestOrigin = new Map<string, QueryOrigin>();
  const originsSeen = new Map<string, Set<QueryOrigin>>();
  // adversarial mode: the full model is not maintained once chaos lands
  let modelValid = true;
  let mono: { seq: number; values: StatArray } | null = null;
  let monoBroken = false;

  const inFlight = (r: Run | null) => !!r && !r.cancelled && !r.errored && !r.final;
  const storeWorker = (): FW | null => {
    const w = workers.at(-1);
    return w && !w.terminated ? w : null;
  };
  const pickWorker = (w: number): FW | null => {
    if (workers.length === 0) return null;
    return w < 0 ? workers.at(-1)! : workers[w % workers.length];
  };
  const allowAdd = (r: Run, v: StatArray | undefined | null) => {
    if (!v) return;
    v.forEach((x, s) => r.allowed[s].add(x));
  };

  const expectCeilings = (values: StatArray | null, exact: boolean, what: string) => {
    if (opt.mode !== "protocol" || !modelValid) return;
    const v = store.ceilingsView.get();
    if (!eq(v.values, values) || v.exact !== exact)
      fail(`${what}: overlay ${fmt(v)} expected ${fmt({ values, exact })}`);
  };

  // ---- invariants after every op
  const checkAll = (where: string) => {
    const snap = store.getSnapshot();
    const view = store.ceilingsView.get();
    // Safety (both modes) -------------------------------------------------------------
    if (snap.shown) {
      const p = prov.get(snap.shown.result);
      if (!p) fail(`${where}: shown.result is not an output any worker produced`);
      if (p!.key !== snap.shown.key)
        fail(`${where}: shown.result was produced by ${p!.key} but shown.key is ${snap.shown.key}`);
      if (!originsSeen.get(snap.shown.key)?.has(snap.shown.origin))
        fail(`${where}: shown.origin ${fmt(snap.shown.origin)} was never passed to run() with key ${snap.shown.key}`);
      if (opt.checkOriginFresh && snap.shown.origin !== latestOrigin.get(snap.shown.key))
        fail(
          `${where}: shown.origin ${fmt(snap.shown.origin)} is stale — the latest run() of that query passed ${fmt(latestOrigin.get(snap.shown.key))}`,
        );
    }
    if (snap.refinement.phase === "done" && snap.refinement.pending) {
      const p = prov.get(snap.refinement.pending);
      if (!snap.shown || p?.key !== snap.shown.key)
        fail(`${where}: pending offer belongs to ${p?.key} but the shown list is ${snap.shown?.key}`);
    }
    if (snap.refinement.phase === "done" && snap.refinement.outcome === "confirmed" && !view.exact)
      fail(`${where}: "Verified" claim while the overlay is not exact`);
    if (workers.filter((w) => !w.terminated).length > 1) fail(`${where}: more than one live worker`);
    // Never regress during a refinement (the store max-merges every write; holds even for
    // noisy streams). Tracked across running → done; chaos-delivered results re-seed it.
    const phase = snap.refinement.phase;
    if (cur && view.values && !monoBroken && (phase === "running" || (phase === "done" && mono))) {
      if (mono && mono.seq === cur.seq && view.values.some((x, s) => x < mono!.values[s]))
        fail(`${where}: overlay regressed during refinement of seq ${cur.seq}: ${fmt(mono.values)} → ${fmt(view.values)}`);
    }
    mono = cur && view.values && phase === "running" ? { seq: cur.seq, values: view.values } : null;
    // Overlay provenance: every value is the run's carry seed or something THIS run posted.
    if (view.values) {
      if (!cur) fail(`${where}: overlay values before any run`);
      view.values.forEach((x, s) => {
        if (!cur!.allowed[s].has(x))
          fail(
            `${where}: overlay stat ${s} = ${x} is neither run seq ${cur!.seq}'s carry seed nor anything it posted (value band ⇒ seq ${Math.floor(x / 1000)})`,
          );
      });
      // (protocol only: a ceilings message arriving AFTER an exact final result inherits
      // its exact flag — impossible from one in-order worker; see finding A1)
      if (opt.mode === "protocol" && view.exact && !cur!.outputs.some((o) => o.ceilingsExact && eq(o.ceilings, view.values)))
        fail(`${where}: overlay claims exact ${fmt(view.values)} but no exact output of seq ${cur!.seq} says so`);
    } else if (view.exact) fail(`${where}: exact with no values`);

    if (opt.mode !== "protocol" || !modelValid) return;
    // Exact model (protocol mode) ----------------------------------------------------
    if (snap.running !== running) fail(`${where}: running ${snap.running}, model ${running}`);
    if (snap.runId !== runId) fail(`${where}: runId ${snap.runId}, model ${runId}`);
    const ss = snap.shown;
    if (!!ss !== !!shown || (ss && shown && (ss.result !== shown.result || ss.origin !== shown.origin || ss.key !== shown.key)))
      fail(
        `${where}: shown {key:${ss?.key}, origin:${fmt(ss?.origin)}, seq:${ss && prov.get(ss.result)?.seq}} model {key:${shown?.key}, origin:${fmt(shown?.origin)}, seq:${shown && prov.get(shown.result)?.seq}}`,
      );
    const r = snap.refinement;
    const sameRef =
      r.phase === ref.phase &&
      (r.phase === "idle" ||
        (r.phase === "running" && ref.phase === "running" && r.interim === ref.interim && r.pending === ref.pending) ||
        (r.phase === "done" &&
          ref.phase === "done" &&
          r.outcome === ref.outcome &&
          r.pending === ref.pending &&
          r.verified === ref.verified));
    if (!sameRef) fail(`${where}: refinement ${fmt(summRef(r))} model ${fmt(summRef(ref))}`);
    if (store.progress.get() !== progress) fail(`${where}: progress ${store.progress.get()} model ${progress}`);
    if (store.refinementProgress.get() !== refProgress)
      fail(`${where}: refinementProgress ${store.refinementProgress.get()} model ${refProgress}`);
    // Monotone overlay within one run (protocol streams are monotone).
    if (cur) {
      if (cur.lastShown && !view.values) fail(`${where}: overlay went dark mid-run (seq ${cur.seq})`);
      if (cur.lastShown && view.values && view.values.some((x, s) => x < cur!.lastShown![s]))
        fail(`${where}: overlay decreased within seq ${cur.seq}: ${fmt(cur.lastShown)} → ${fmt(view.values)}`);
      cur.lastShown = view.values;
    }
    // Trailing edge: an offered update is on screen within one window.
    if (offer && Date.now() - offer.at >= 100) {
      if (!eq(view.values, offer.values))
        fail(`${where}: held overlay update ${fmt(offer.values)} still not published after ${Date.now() - offer.at}ms (shows ${fmt(view.values)})`);
      offer = null;
    }
  };

  // ---- message handling
  const deliver = (w: FW, msg: OptimizerResponse, chaos: boolean) => {
    if (opt.debug)
      console.log(`deliver t=${Date.now()} w#${w.id}`, JSON.stringify(msg).slice(0, 240));
    const stale = !cur || msg.seq !== cur.seq || cur.cancelled;
    curOpKind = msg.kind;
    if (stale) {
      bump(`stale ${msg.kind}${w.terminated ? " (terminated worker)" : ""}`);
      const before = [store.getSnapshot(), store.ceilingsView.get(), store.progress.get(), store.refinementProgress.get(), vi.getTimerCount()];
      w.emit(msg);
      const after = [store.getSnapshot(), store.ceilingsView.get(), store.progress.get(), store.refinementProgress.get(), vi.getTimerCount()];
      if (after.some((x, i) => x !== before[i]))
        fail(`stale ${msg.kind} (seq ${msg.seq}, current ${cur?.seq}${cur?.cancelled ? " cancelled" : ""}) changed the store`);
      return;
    }
    const r = cur!;
    if (chaos || r.errored) modelValid = false;
    if (chaos && msg.kind === "result") monoBroken = true;
    if (msg.kind === "ceilings") allowAdd(r, msg.ceilings);
    if (msg.kind === "better" || msg.kind === "result") {
      allowAdd(r, msg.output.ceilings);
      r.outputs.push(msg.output);
    }
    if (msg.kind === "result") last = { input: r.input, key: r.key, output: msg.output };
    const prevValues = store.ceilingsView.get().values;
    const prevView = store.ceilingsView.get();
    const helperAtBefore = lastHelperPublishAt;
    w.emit(msg);
    if (!modelValid) return;
    switch (msg.kind) {
      case "progress":
        if (ref.phase === "running") refProgress = msg.progress;
        else progress = msg.progress;
        break;
      case "ceilings": {
        const now = Date.now();
        if (now - helperAtBefore >= 100) {
          expectCeilings(msg.ceilings, prevView.exact, "streamed ceilings outside the window");
          offer = null;
        } else {
          if (store.ceilingsView.get() !== prevView) fail("ceilings inside the throttle window published immediately");
          offer = { values: msg.ceilings, at: now };
          bump("held ceilings");
        }
        break;
      }
      case "better":
        if (ref.phase === "running") {
          ref = { ...ref, pending: msg.output };
          bump("better offered");
        }
        break;
      case "result": {
        shown = { result: msg.output, origin: r.origin, key: r.key };
        running = false;
        offer = null;
                if (msg.refining) {
          bump("interim result");
          r.interim = msg.output;
          shownFinal = false;
          refProgress = 0;
          ref = { phase: "running", progress: 0, interim: msg.output, pending: null };
          expectCeilings(msg.output.ceilings, msg.output.ceilingsExact, "interim result");
        } else {
          r.final = msg.output;
          shownFinal = true;
          let values = msg.output.ceilings;
          if (ref.phase === "running") {
            const interim = ref.interim;
            const rose = msg.output.ceilings.some((v, s) => v > interim.ceilings[s]);
            const outcome = rose ? "improved" : msg.verified && msg.output.ceilingsExact ? "confirmed" : null;
            bump(`outcome ${outcome}${ref.pending ? " +pending" : ""}`);
            ref = { phase: "done", outcome, pending: ref.pending, verified: msg.verified };
            values = prevValues ? values.map((v, s) => Math.max(v, prevValues[s])) : values;
          } else bump("single final result");
          expectCeilings(values, msg.output.ceilingsExact, "final result");
        }
        break;
      }
    }
  };

  // ---- replay
  for (const [i, op] of ops.entries()) {
    trace.push(`${i}: ${fmt(op)}`);
    curOpKind = op.k;
    switch (op.k) {
      case "run": {
        const input = structuredClone(QUERIES[op.q % QUERIES.length]);
        const origin =
          op.o < ORIGINS.length ? ORIGINS[op.o] : { targets: [9, op.o, 0, 0, 0, 0] };
        const key = JSON.stringify(input);
        latestOrigin.set(key, origin);
        if (!originsSeen.has(key)) originsSeen.set(key, new Set());
        originsSeen.get(key)!.add(origin);
        const postsBefore = posts;
        const workersBefore = workers.length;
        const snapBefore = store.getSnapshot();
        const prevWorker = storeWorker();
        nextScriptSeed = op.script;
        // Classify for coverage.
        if (shown && shown.key === key && cur && cur.key !== key && !cur.cancelled) bump("A→B→A re-run while A shown");
        if (cur && cur.key === key && cur.errored && shown?.key === key && !shownFinal) bump("same-key re-run after refinement died");
        if (cur && cur.key === key && cur.cancelled) bump("same-key re-run after cancel");

        // Model: attach (no new search) iff the latest, uncancelled run is this query and
        // it is still in flight, or its complete result is on screen.
        const shownOk = shown?.key === key && (shownFinal || (!opt.checkErrorRestart && !!cur?.errored));
        const attach = !!cur && !cur.cancelled && cur.key === key && (inFlight(cur) || shownOk);
        const expectedCarry = last ? computeCeilingCarry(last.input, last.output, input) : undefined;
        store.run(input, origin);
        const posted = posts !== postsBefore;
        const decide = opt.mode === "protocol" && modelValid;
        if (posts > postsBefore + 1) fail("run() posted twice");
        if (decide && posted === attach)
          fail(
            attach
              ? `run(${key}) restarted a search that should re-attach (latest seq ${cur?.seq}${cur?.errored ? " errored" : ""}, shown ${shown?.key === key ? (shownFinal ? "final" : "interim") : "other"})`
              : `run(${key}) re-attached but should have started a search (latest seq ${cur?.seq} key ${cur?.key}${cur?.errored ? " errored" : ""}${cur?.cancelled ? " cancelled" : ""}, shown ${shown?.key === key ? (shownFinal ? "final" : "interim") : "other"})`,
          );
        if (!posted) {
          if (!cur || cur.cancelled || cur.key !== key)
            fail(`run(${key}) attached to ${cur?.key}${cur?.cancelled ? " (cancelled)" : ""}`);
          bump(inFlight(cur) ? "attach (in flight)" : "attach (shown)");
          if (workers.length !== workersBefore) fail(`attach spawned a worker`);
          cur!.origin = origin;
          let changed = false;
          if (shown && shown.key === key && shown.origin !== origin) {
            shown = { ...shown, origin };
            changed = true;
            bump("shown origin refreshed");
          }
          if (decide && !changed && store.getSnapshot() !== snapBefore) fail("attach changed the snapshot");
        } else {
          const { w, req } = lastPost!;
          if (req.seq <= maxSeq) fail(`seq ${req.seq} not above ${maxSeq}`);
          if (req.input !== input) fail("posted input is not the run's input");
          if (!eq(req.carry, expectedCarry))
            fail(`carry ${fmt(req.carry)} ≠ computeCeilingCarry(last=${last?.key}) ${fmt(expectedCarry)}`);
          bump(
            !last
              ? "carry: no last"
              : !expectedCarry
                ? "carry: none"
                : expectedCarry.ceilingSeed && expectedCarry.ceilingUpperSeed
                  ? "carry: seed+upper"
                  : expectedCarry.ceilingSeed
                    ? "carry: seed only"
                    : "carry: upper only",
          );
          if (decide && cur && inFlight(cur)) {
            bump(cur.interim ? "superseded mid-refinement" : "superseded mid-inline");
            if (!cur.worker.terminated) fail(`superseded seq ${cur.seq}'s worker was not terminated`);
          }
          if (decide && prevWorker && w !== prevWorker && !prevWorker.terminated) fail("old worker left running");
          maxSeq = req.seq;
          cur = {
            seq: req.seq,
            key,
            input,
            origin,
            worker: w,
            cancelled: false,
            errored: false,
            interim: null,
            final: null,
            carry: expectedCarry,
            allowed: [0, 1, 2, 3, 4, 5].map(() => new Set<number>()),
            outputs: [],
            lastShown: null,
          };
          allowAdd(cur, expectedCarry?.ceilingSeed);
          running = true;
          runId = req.seq;
          ref = IDLE;
          progress = 0;
          refProgress = 0;
          offer = null;
          bump("search started");
          monoBroken = false;
          expectCeilings(expectedCarry?.ceilingSeed ?? null, false, "run start");
          cur.lastShown = store.ceilingsView.get().values;
        }
        break;
      }
      case "cancel": {
        const w = storeWorker();
        if (cur && inFlight(cur)) bump(cur.interim ? "cancel mid-refinement" : "cancel mid-inline");
        store.cancel();
        if (w && !w.terminated) fail("cancel left the worker running");
        if (cur) cur.cancelled = true;
        running = false;
        ref = IDLE;
        offer = null;
        break;
      }
      case "apply": {
        const before = store.getSnapshot();
        const prev = store.ceilingsView.get().values;
        store.applyPending();
        if (ref.phase === "done" && ref.pending && shown && modelValid) {
          bump("applyPending applied");
          const pending = ref.pending;
          shown = { ...shown, result: pending };
          ref = IDLE;
          offer = null;
                    expectCeilings(
            prev ? pending.ceilings.map((v, s) => Math.max(v, prev[s])) : pending.ceilings,
            pending.ceilingsExact,
            "applyPending",
          );
        } else if (modelValid && opt.mode === "protocol" && store.getSnapshot() !== before) {
          fail("applyPending with nothing to apply changed the snapshot");
        }
        break;
      }
      case "warm": {
        const had = storeWorker();
        const n = workers.length;
        store.warm();
        if (had && workers.length !== n) fail("warm spawned a second worker");
        if (!had && workers.length !== n + 1) fail("warm did not spawn a worker");
        break;
      }
      case "deliver": {
        const w = pickWorker(op.w);
        if (!w) break;
        for (let j = 0; j < op.n && w.queue.length > 0; j++) {
          const msg = w.queue.shift()!;
          deliver(w, msg, false);
          checkAll(`op ${i} msg ${j} (${msg.kind} seq ${msg.seq})`);
          curOpKind = op.k;
        }
        break;
      }
      case "chaos": {
        if (opt.mode !== "adversarial") break;
        const w = pickWorker(op.w);
        if (!w || w.scripted.length === 0) break;
        const msg = w.scripted[op.pick % w.scripted.length];
        bump("chaos delivery");
        deliver(w, msg, true);
        break;
      }
      case "advance": {
        const viewBefore = store.ceilingsView.get();
        const snapBefore = store.getSnapshot();
        vi.advanceTimersByTime(op.ms);
        // A timer may only ever publish an update the CURRENT run offered and the
        // throttle held — nothing after cancel / error / a newer run / a result.
        if (opt.mode === "protocol" && modelValid && !offer && store.ceilingsView.get() !== viewBefore)
          fail(
            `overlay changed on a timer with no held update for seq ${cur?.seq}: ${fmt(viewBefore)} → ${fmt(store.ceilingsView.get())}`,
          );
        if (store.getSnapshot() !== snapBefore) fail("a timer changed the snapshot");
        break;
      }
      case "error": {
        const w = pickWorker(op.w);
        if (!w) break;
        const active = !w.terminated && w.queue.length > 0;
        if (w.terminated && !opt.allowStaleErrors) break;
        if (!w.terminated && !active && !opt.allowIdleErrors) break;
        if (op.dead && !opt.allowDeadWorkers) break;
        if (w.terminated) bump("error on terminated worker");
        else if (active) bump(cur?.interim ? "error mid-refinement" : "error mid-inline");
        else bump("error on idle worker");
        const snapBefore = store.getSnapshot();
        w.queue.length = 0; // the session died with the error
        if (op.dead) w.dead = true;
        w.onerror?.(new Event("error"));
        if (active && cur && w === cur.worker && inFlight(cur)) {
          cur.errored = true;
          running = false;
          ref = IDLE;
          offer = null;
        } else if (opt.mode === "protocol" && modelValid && !sameContent(store.getSnapshot(), snapBefore)) {
          fail(
            `onerror from a worker with nothing in flight for the current run (${w.terminated ? "terminated" : "idle"}) changed the snapshot: refinement ${fmt(summRef(snapBefore.refinement))} → ${fmt(summRef(store.getSnapshot().refinement))}, running ${snapBefore.running} → ${store.getSnapshot().running}`,
          );
        }
        break;
      }
    }
    checkAll(`op ${i} ${op.k}`);
  }
}

/** Field-wise snapshot equality (a re-render with identical content is not a state change). */
function sameContent(a: OptimizerSnapshot, b: OptimizerSnapshot): boolean {
  const ra = a.refinement as Record<string, unknown>;
  const rb = b.refinement as Record<string, unknown>;
  return (
    a.shown === b.shown &&
    a.running === b.running &&
    a.runId === b.runId &&
    Object.keys({ ...ra, ...rb }).every((k) => ra[k] === rb[k])
  );
}

function summRef(r: RefinementState) {
  if (r.phase === "idle") return r;
  if (r.phase === "running") return { phase: r.phase, interim: r.interim.ceilings, pending: !!r.pending };
  return { phase: r.phase, outcome: r.outcome, pending: !!r.pending, verified: r.verified };
}

export type { CeilingsView };
