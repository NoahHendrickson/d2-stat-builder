// The optimizer's client-side state machine, held OUTSIDE React as a module singleton
// so a search survives route changes: leaving the builder tab no longer terminates
// the worker, and coming back re-attaches to the in-flight (or finished) run instead
// of starting over. `useOptimizer` is a thin subscription over this store.
//
// Hot-path values (raw progress, refinement progress, ceiling overlays) live in
// their own value stores and never touch the snapshot, so only the subscribed
// widgets re-render.
import { createValueStore, type ValueStore } from "../value-store";
import { computeCeilingCarry } from "./carryover";
import type {
  OptimizerInput,
  OptimizerOutput,
  OptimizerRequest,
  OptimizerResponse,
  RefinementState,
  StatArray,
} from "./types";

const IDLE: RefinementState = { phase: "idle" };
/** Ceiling overlay writes land in the value store at most this often. */
const CEILINGS_INTERVAL_MS = 100;

export type CeilingsView = {
  values: StatArray | null;
  exact: boolean;
};

export interface OptimizerSnapshot<O = unknown> {
  result: OptimizerOutput | null;
  /**
   * The caller-supplied context of the query that produced `result` (see `run`'s
   * `origin`) — null iff `result` is null. `result` is deliberately kept on screen while
   * a NEWER query runs (or after one was cancelled), so anything that acts on a shown
   * build (save, DIM export) must read its targets/fragments/etc. from HERE, never from
   * the live builder state, or two queries get combined into one loadout.
   */
  resultOrigin: O | null;
  running: boolean;
  /** Identity of the latest run — lets the UI restart progress animation per search. */
  runId: number;
  refinement: RefinementState;
}

/** The worker surface the store needs — lets tests substitute a fake. */
export interface WorkerLike {
  postMessage(msg: OptimizerRequest): void;
  terminate(): void;
  onmessage: ((e: MessageEvent<OptimizerResponse>) => void) | null;
  onerror: ((e: unknown) => void) | null;
}

export interface OptimizerStore<O = unknown> {
  subscribe(listener: () => void): () => void;
  getSnapshot(): OptimizerSnapshot<O>;
  /** Raw 0–1 progress of the current run, per worker message (not in the snapshot). */
  progress: ValueStore<number>;
  /** Background-refinement 0–1 progress; only SearchStatus subscribes. */
  refinementProgress: ValueStore<number>;
  /** Slider overlays; StatTargetRow subscribes so the rest of the panel can bail out. */
  ceilingsView: ValueStore<CeilingsView>;
  /**
   * Start (or re-attach to) a search. `origin` is whatever the caller needs to act on
   * this query's results later (its targets, subclass, snapshot…); it is echoed back as
   * `resultOrigin` alongside every result of this query. Re-running an identical query
   * only refreshes the origin — the newest context for the same optimizer input is the
   * right one to attach.
   */
  run(input: OptimizerInput, origin?: O): void;
  cancel(): void;
  applyPending(): void;
}

/**
 * Element-wise max of the displayed ceilings and an update. Every ceiling the app
 * shows is proven-achievable for the current query, so within one run the displayed
 * value must never regress — all ceiling writes during/after a refinement go through
 * this one helper.
 */
function mergeCeilingsMonotone(prev: StatArray | null, next: StatArray): StatArray {
  return prev ? next.map((v, s) => Math.max(v, prev[s])) : next;
}

export function createOptimizerStore<O = unknown>(
  makeWorker: () => WorkerLike,
  now: () => number = () => Date.now(),
): OptimizerStore<O> {
  let snapshot: OptimizerSnapshot<O> = {
    result: null,
    resultOrigin: null,
    running: false,
    runId: 0,
    refinement: IDLE,
  };
  const listeners = new Set<() => void>();
  const setState = (patch: Partial<OptimizerSnapshot<O>>) => {
    snapshot = { ...snapshot, ...patch };
    for (const l of listeners) l();
  };
  const progress = createValueStore(0);
  const refinementProgress = createValueStore(0);
  const ceilingsView = createValueStore<CeilingsView>({
    values: null,
    exact: false,
  });

  let worker: WorkerLike | null = null;
  let seq = 0;
  // Whether a solve is in flight on the current worker. A worker is single-threaded, so a
  // message posted mid-solve would queue behind it — run() checks this to terminate first.
  let inFlight = false;
  // The input of the run currently producing messages, paired with each result so `last`
  // can be updated with a matching (input, output). Set on every run() before postMessage.
  let inFlightInput: OptimizerInput | null = null;
  // The caller's context for that run, echoed as `resultOrigin` with each of its results.
  let inFlightOrigin: O | null = null;
  // Serialized form of the in-flight / last input, so a remounted builder that
  // reproduces the same query re-attaches instead of restarting the search.
  let inFlightKey: string | null = null;
  // The most recent (input, output) pair — the source for cross-edit ceiling carryover.
  // Updated on EVERY result message (interim and final). cancel() leaves this intact.
  let last: { input: OptimizerInput; key: string; output: OptimizerOutput } | null = null;
  // Ceiling updates arrive up to ~50 times during the inline phase and land straight in
  // ceilingsView, whose only subscribers are the StatTargetRows. They are throttled to one
  // publish per CEILINGS_INTERVAL_MS; an update that lands inside the window is held and
  // published when the window closes, so the ticks never sit stale between the last
  // throttled message and the result.
  let lastCeilingsAt = Number.NEGATIVE_INFINITY;
  let pendingCeilings: CeilingsView | null = null;
  let ceilingsTimer: ReturnType<typeof setTimeout> | null = null;

  const dropPendingCeilings = () => {
    if (ceilingsTimer !== null) {
      clearTimeout(ceilingsTimer);
      ceilingsTimer = null;
    }
    pendingCeilings = null;
  };
  // Immediate publish: results, applyPending, and the trailing edge of the throttle.
  const publishCeilings = (view: CeilingsView) => {
    dropPendingCeilings();
    lastCeilingsAt = now();
    ceilingsView.set(view);
  };
  // Throttled publish for streamed updates.
  const offerCeilings = (view: CeilingsView) => {
    const wait = CEILINGS_INTERVAL_MS - (now() - lastCeilingsAt);
    if (wait <= 0) {
      publishCeilings(view);
      return;
    }
    pendingCeilings = view;
    if (ceilingsTimer === null) {
      ceilingsTimer = setTimeout(() => {
        ceilingsTimer = null;
        if (pendingCeilings) publishCeilings(pendingCeilings);
      }, wait);
    }
  };

  const getWorker = () => {
    if (worker) return worker;
    const w = makeWorker();
    w.onmessage = (e) => {
      const msg = e.data;
      if (msg.seq !== seq) return; // superseded run — ignore
      const ref = snapshot.refinement;
      switch (msg.kind) {
        case "progress":
          if (ref.phase === "running") {
            refinementProgress.set(msg.progress);
          } else {
            progress.set(msg.progress);
          }
          break;
        case "ceilings": {
          const shown = (pendingCeilings ?? ceilingsView.get()).values;
          const values =
            ref.phase === "running" ? mergeCeilingsMonotone(shown, msg.ceilings) : msg.ceilings;
          offerCeilings({ values, exact: ceilingsView.get().exact });
          break;
        }
        case "better":
          // The background search beat the frozen list — hold it, don't apply it.
          if (ref.phase === "running") setState({ refinement: { ...ref, pending: msg.output } });
          break;
        case "result": {
          if (inFlightInput && inFlightKey) {
            last = { input: inFlightInput, key: inFlightKey, output: msg.output };
          }
          if (msg.refining) {
            // Time-capped search: its build list is final and shown now (and never
            // replaced); the worker is still refining, so stay "in flight" for cancellation.
            refinementProgress.set(0);
            publishCeilings({
              values: msg.output.ceilings,
              exact: msg.output.ceilingsExact,
            });
            setState({
              result: msg.output,
              resultOrigin: inFlightOrigin,
              running: false,
              refinement: { phase: "running", progress: 0, interim: msg.output, pending: null },
            });
          } else {
            inFlight = false;
            const ceilings =
              ref.phase === "running"
                ? mergeCeilingsMonotone(ceilingsView.get().values, msg.output.ceilings)
                : msg.output.ceilings;
            publishCeilings({
              values: ceilings,
              exact: msg.output.ceilingsExact,
            });
            const patch: Partial<OptimizerSnapshot<O>> = {
              result: msg.output,
              resultOrigin: inFlightOrigin,
              running: false,
            };
            if (ref.phase === "running") {
              const rose = msg.output.ceilings.some((v, s) => v > ref.interim.ceilings[s]);
              // "confirmed" is a proven claim about BOTH halves: the build walk ran to
              // exhaustion AND the ceilings are proven exact. Anything less → null.
              patch.refinement = {
                phase: "done",
                outcome: rose
                  ? "improved"
                  : msg.verified && msg.output.ceilingsExact
                    ? "confirmed"
                    : null,
                pending: ref.pending,
                verified: msg.verified,
              };
            }
            setState(patch);
          }
          break;
        }
        default: {
          const _exhaustive: never = msg;
          void _exhaustive;
        }
      }
    };
    w.onerror = () => {
      inFlight = false;
      dropPendingCeilings();
      setState({ running: false, refinement: IDLE });
    };
    worker = w;
    return w;
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    progress,
    refinementProgress,
    ceilingsView,

    run(input, origin = null as O) {
      const key = JSON.stringify(input);
      // Same query as the run in flight, or as the one whose result is showing (and not
      // cancelled): nothing to search. This is what lets a re-mounted builder pick the
      // search back up instead of restarting it. The origin still refreshes: the same
      // optimizer input can come from a newer builder state (a fragment swap with the
      // same stat effect), and the shown result belongs to that newest state.
      if (key === inFlightKey && (inFlight || (last?.key === key && snapshot.result))) {
        inFlightOrigin = origin;
        if (snapshot.result && snapshot.resultOrigin !== origin) {
          setState({ resultOrigin: origin });
        }
        return;
      }

      const s = ++seq;
      // Kill a superseded solve so this one starts immediately instead of queueing
      // behind it (the worker is stateless — recreating it costs single-digit ms).
      // inFlight covers background refinement too: its CPU work dies here.
      if (inFlight) {
        worker?.terminate();
        worker = null;
      }
      inFlight = true;
      inFlightInput = input;
      inFlightOrigin = origin;
      inFlightKey = key;
      progress.set(0);
      refinementProgress.set(0);
      dropPendingCeilings();
      // Carry proven ceiling bounds from the previous query when this edit only changed
      // the minimums — lets the worker skip re-proving what the last query established.
      const carry = last ? computeCeilingCarry(last.input, last.output, input) : undefined;
      // The slider overlays claim "achievable for THIS query". The previous query's values
      // are that only when the carry says so (its `ceilingSeed` is exactly the set of
      // prior values still proven achievable here); otherwise they belong to a different
      // query and must not be shown as current — the overlays go dark until this run's
      // own seed streams in.
      ceilingsView.set({ values: carry?.ceilingSeed ?? null, exact: false });
      setState({ running: true, refinement: IDLE, runId: s });
      getWorker().postMessage({ seq: s, input, carry });
    },

    // Abandon the in-flight run: bump the seq (so any late messages are ignored) and tear
    // the worker down so its CPU work stops.
    cancel() {
      seq++;
      inFlight = false;
      dropPendingCeilings();
      inFlightKey = null;
      worker?.terminate();
      worker = null;
      setState({ running: false, refinement: IDLE });
    },

    // Swap the offered better list in — the explicit user action that lets a shown list
    // change. Ceilings only max-merge (both lists' ceilings are proven-achievable).
    applyPending() {
      const ref = snapshot.refinement;
      if (ref.phase !== "done" || !ref.pending) return;
      const pending = ref.pending;
      const ceilings = mergeCeilingsMonotone(ceilingsView.get().values, pending.ceilings);
      publishCeilings({ values: ceilings, exact: pending.ceilingsExact });
      setState({
        refinement: IDLE,
        result: pending,
      });
    },
  };
}

let singleton: OptimizerStore<unknown> | null = null;

/**
 * The app-wide optimizer (one worker, one search, independent of which page is mounted).
 * `O` is the origin type the single caller (the builder panel) attaches to its queries;
 * there is one store, so every caller must agree on it.
 */
export function getOptimizerStore<O = unknown>(): OptimizerStore<O> {
  if (!singleton) {
    singleton = createOptimizerStore<unknown>(
      () =>
        new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }) as WorkerLike,
    );
  }
  return singleton as OptimizerStore<O>;
}
