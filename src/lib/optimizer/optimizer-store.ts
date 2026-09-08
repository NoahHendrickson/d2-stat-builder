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

export interface OptimizerSnapshot {
  result: OptimizerOutput | null;
  ceilings: StatArray | null;
  /** Are the displayed ceilings PROVEN maxima? (solve.ts contract — see use-optimizer). */
  ceilingsExact: boolean;
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

export interface OptimizerStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): OptimizerSnapshot;
  /** Raw 0–1 progress of the current run, per worker message (not in the snapshot). */
  progress: ValueStore<number>;
  /** Background-refinement 0–1 progress; only SearchStatus subscribes. */
  refinementProgress: ValueStore<number>;
  /** Slider overlays; StatTargetRow subscribes so the rest of the panel can bail out. */
  ceilingsView: ValueStore<CeilingsView>;
  run(input: OptimizerInput): void;
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

export function createOptimizerStore(
  makeWorker: () => WorkerLike,
  now: () => number = () => Date.now(),
): OptimizerStore {
  let snapshot: OptimizerSnapshot = {
    result: null,
    ceilings: null,
    ceilingsExact: false,
    running: false,
    runId: 0,
    refinement: IDLE,
  };
  const listeners = new Set<() => void>();
  const setState = (patch: Partial<OptimizerSnapshot>) => {
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
  // Serialized form of the in-flight / last input, so a remounted builder that
  // reproduces the same query re-attaches instead of restarting the search.
  let inFlightKey: string | null = null;
  // The most recent (input, output) pair — the source for cross-edit ceiling carryover.
  // Updated on EVERY result message (interim and final). cancel() leaves this intact.
  let last: { input: OptimizerInput; key: string; output: OptimizerOutput } | null = null;
  let lastCeilingsAt = Number.NEGATIVE_INFINITY;

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
          const values =
            ref.phase === "running"
              ? mergeCeilingsMonotone(ceilingsView.get().values, msg.ceilings)
              : msg.ceilings;
          const t = now();
          if (t - lastCeilingsAt >= CEILINGS_INTERVAL_MS) {
            lastCeilingsAt = t;
            ceilingsView.set({ values, exact: snapshot.ceilingsExact });
          }
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
            lastCeilingsAt = now();
            ceilingsView.set({
              values: msg.output.ceilings,
              exact: msg.output.ceilingsExact,
            });
            setState({
              result: msg.output,
              ceilings: msg.output.ceilings,
              ceilingsExact: msg.output.ceilingsExact,
              running: false,
              refinement: { phase: "running", progress: 0, interim: msg.output, pending: null },
            });
          } else {
            inFlight = false;
            const ceilings =
              ref.phase === "running"
                ? mergeCeilingsMonotone(snapshot.ceilings, msg.output.ceilings)
                : msg.output.ceilings;
            lastCeilingsAt = now();
            ceilingsView.set({
              values: ceilings,
              exact: msg.output.ceilingsExact,
            });
            const patch: Partial<OptimizerSnapshot> = {
              result: msg.output,
              ceilingsExact: msg.output.ceilingsExact,
              ceilings,
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

    run(input) {
      const key = JSON.stringify(input);
      // Same query as the run in flight, or as the one whose result is showing (and not
      // cancelled): nothing to do. This is what lets a re-mounted builder pick the
      // search back up instead of restarting it.
      if (key === inFlightKey && (inFlight || (last?.key === key && snapshot.result))) return;

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
      inFlightKey = key;
      progress.set(0);
      refinementProgress.set(0);
      ceilingsView.set({ values: ceilingsView.get().values, exact: false });
      setState({ running: true, ceilingsExact: false, refinement: IDLE, runId: s });
      // Carry proven ceiling bounds from the previous query when this edit only changed
      // the minimums — lets the worker skip re-proving what the last query established.
      const carry = last ? computeCeilingCarry(last.input, last.output, input) : undefined;
      getWorker().postMessage({ seq: s, input, carry });
    },

    // Abandon the in-flight run: bump the seq (so any late messages are ignored) and tear
    // the worker down so its CPU work stops.
    cancel() {
      seq++;
      inFlight = false;
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
      const ceilings = mergeCeilingsMonotone(snapshot.ceilings, pending.ceilings);
      lastCeilingsAt = now();
      ceilingsView.set({ values: ceilings, exact: pending.ceilingsExact });
      setState({
        refinement: IDLE,
        result: pending,
        ceilings,
        ceilingsExact: pending.ceilingsExact,
      });
    },
  };
}

let singleton: OptimizerStore | null = null;

/** The app-wide optimizer (one worker, one search, independent of which page is mounted). */
export function getOptimizerStore(): OptimizerStore {
  if (!singleton) {
    singleton = createOptimizerStore(
      () =>
        new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }) as WorkerLike,
    );
  }
  return singleton;
}
