// The optimizer's client-side state machine, held OUTSIDE React as a module singleton
// so a search survives route changes: leaving the builder tab no longer terminates
// the worker, and coming back re-attaches to the in-flight (or finished) run instead
// of starting over. `useOptimizer` is a thin subscription over this store.
//
// Hot-path values (raw progress, refinement progress, ceiling overlays) live in
// their own value stores and never touch the snapshot, so only the subscribed
// widgets re-render.
import { createValueStore, type ValueStore } from "../value-store";
import type { QueryOrigin } from "../loadouts/types";
import { computeCeilingCarry } from "./carryover";
import type {
  BuildList,
  OptimizerInput,
  OptimizerLoadout,
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

/**
 * The result on screen, paired with the query that produced it. A pair, not two
 * fields: the list deliberately stays on screen while a NEWER query runs (or after one
 * was cancelled), so anything that acts on a shown build (save, DIM export) must read
 * its targets/fragments from `origin`, never from the live builder state — and the two
 * can never drift apart because they only ever change together. `key` is the query's
 * serialized identity, so a re-run of the same query can refresh `origin` in place
 * without ever touching a result that belongs to a different query. `input` is the
 * query itself, for readers that need its pool or constraints (the armor usage history).
 *
 * `final` is the one place that says whether the maximums are in. A run's list goes up
 * as soon as its walk ends (`final: false`, a BuildList with no maximums to misread) and
 * the run's first result replaces it with the full output (`final: true`, the same list).
 * Anything that needs a maximum, or a settled result, has to narrow on `final` first.
 */
export type ShownResult = {
  origin: QueryOrigin;
  key: string;
  input: OptimizerInput;
} & ({ final: true; result: OptimizerOutput } | { final: false; result: BuildList });

export interface OptimizerSnapshot {
  shown: ShownResult | null;
  running: boolean;
  /** Identity of the latest run — lets the UI restart progress animation per search. */
  runId: number;
  refinement: RefinementState;
  /**
   * The latest run's worker crashed (or failed to load); cleared by the next run or a
   * cancel. A list still shown is the crashed query's own (only its maximums were left):
   * an older query's list is dropped with the crash, so `shown` is null then.
   */
  failed: boolean;
}

/** The worker surface the store needs — lets tests substitute a fake. */
export interface WorkerLike {
  postMessage(msg: OptimizerRequest): void;
  terminate(): void;
  onmessage: ((e: MessageEvent<OptimizerResponse>) => void) | null;
  onerror: ((e: unknown) => void) | null;
  /** A message the main thread couldn't deserialize; treated like a crash. */
  onmessageerror?: ((e: unknown) => void) | null;
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
  /**
   * Start (or re-attach to) a search. `origin` is the builder state the query is
   * dispatched from; it comes back paired with every result of this query (`shown`).
   * Re-running an identical query only refreshes the origin — the newest context for
   * the same optimizer input is the right one to attach.
   */
  run(input: OptimizerInput, origin: QueryOrigin): void;
  /** Spawn the worker ahead of the first run so its chunk fetch + module eval is off the first result's path. */
  warm(): void;
  cancel(): void;
  applyPending(): void;
  /** Run the failed query again on a fresh worker (the Retry button). No-op unless `failed`. */
  retry(): void;
}

/**
 * A query's serialized identity: two inputs with the same key are the same search. The
 * store keys runs and shown results on it.
 */
export const queryKey = (input: OptimizerInput): string => JSON.stringify(input);

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
    shown: null,
    running: false,
    runId: 0,
    refinement: IDLE,
    failed: false,
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
  // The builder state that run was dispatched from, paired with each of its results.
  let inFlightOrigin: QueryOrigin | null = null;
  // Serialized form of the in-flight / last input, so a remounted builder that
  // reproduces the same query re-attaches instead of restarting the search.
  let inFlightKey: string | null = null;
  // The most recent (input, output) pair — the source for cross-edit ceiling carryover.
  // Updated on EVERY result message (interim and final). cancel() leaves this intact.
  // Only full results feed it: never the early "builds" post, whose ceilings are seeds.
  let last: { input: OptimizerInput; key: string; output: OptimizerOutput } | null = null;
  // The list the current run first put on screen (its early "builds" post, or its first
  // result). Every later post of the run carries the same list by contract, so it reuses
  // this array: the cards don't replay their entrance, and the list's identity really
  // doesn't change until the user changes an input. Reset by run().
  let runLoadouts: OptimizerLoadout[] | null = null;
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

  // The shown pair for a result of the in-flight run.
  const inFlightQuery = () => ({
    origin: inFlightOrigin as QueryOrigin,
    key: inFlightKey as string,
    input: inFlightInput as OptimizerInput,
  });

  // A post of the current run, carrying the list the run already showed (see runLoadouts).
  const pinList = <T extends BuildList>(post: T): T => {
    if (!runLoadouts) {
      runLoadouts = post.loadouts;
      return post;
    }
    return post.loadouts === runLoadouts ? post : { ...post, loadouts: runLoadouts };
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
        case "builds": {
          // The walk's list, ahead of the in-line maximums proof. Shown at once (not
          // final: it has no maximums) and the progress ends here; the run stays in
          // flight, so a new query still terminates it. An empty list never comes early
          // (the session skips it); if one did, keep loading.
          if (!snapshot.running || msg.builds.loadouts.length === 0) break;
          setState({
            shown: { ...inFlightQuery(), final: false, result: pinList(msg.builds) },
            running: false,
          });
          break;
        }
        case "better":
          // The background search beat the frozen list — hold it, don't apply it.
          if (ref.phase === "running") setState({ refinement: { ...ref, pending: msg.output } });
          break;
        case "result": {
          const output = pinList(msg.output);
          if (inFlightInput && inFlightKey) {
            last = { input: inFlightInput, key: inFlightKey, output };
          }
          if (msg.refining) {
            // Time-capped search: its build list is final and shown now (and never
            // replaced); the worker is still refining, so stay "in flight" for cancellation.
            refinementProgress.set(0);
            publishCeilings({
              values: output.ceilings,
              exact: output.ceilingsExact,
            });
            setState({
              shown: { ...inFlightQuery(), final: true, result: output },
              running: false,
              refinement: { phase: "running", progress: 0, interim: output, pending: null },
            });
          } else {
            inFlight = false;
            const ceilings =
              ref.phase === "running"
                ? mergeCeilingsMonotone(ceilingsView.get().values, output.ceilings)
                : output.ceilings;
            publishCeilings({
              values: ceilings,
              exact: output.ceilingsExact,
            });
            const patch: Partial<OptimizerSnapshot> = {
              shown: { ...inFlightQuery(), final: true, result: output },
              running: false,
            };
            if (ref.phase === "running") {
              const rose = output.ceilings.some((v, s) => v > ref.interim.ceilings[s]);
              // "confirmed" is a proven claim about BOTH halves: the build walk ran to
              // exhaustion AND the ceilings are proven exact. Anything less → null.
              patch.refinement = {
                phase: "done",
                outcome: rose
                  ? "improved"
                  : msg.verified && output.ceilingsExact
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
    // A crash (or a worker chunk that failed to load) never answers again, so drop it:
    // the next run creates a fresh one. A run in flight fails visibly and can be retried;
    // clearing inFlightKey is what lets the very same query run again. A list on screen
    // from an OLDER query goes with it (it doesn't match these targets); the crashed
    // query's own list stays, only its maximums were left. A worker that fails while idle
    // (a warm-up) is just dropped.
    const fail = () => {
      w.terminate();
      if (worker !== w) return; // an already-replaced worker
      worker = null;
      dropPendingCeilings();
      if (!inFlight) return;
      inFlight = false;
      const patch: Partial<OptimizerSnapshot> = { running: false, refinement: IDLE, failed: true };
      if (snapshot.shown && snapshot.shown.key !== inFlightKey) patch.shown = null;
      inFlightKey = null;
      setState(patch);
    };
    w.onerror = fail;
    w.onmessageerror = fail;
    worker = w;
    return w;
  };

  const run = (input: OptimizerInput, origin: QueryOrigin): void => {
    const key = queryKey(input);
    // Same query as the run in flight, or as the one whose result is showing (and not
    // cancelled): nothing to search. This is what lets a re-mounted builder pick the
    // search back up instead of restarting it. The origin still refreshes: the same
    // optimizer input can come from a newer builder state (a fragment swap with the
    // same stat effect), and a result of this query belongs to that newest state. The
    // in-flight origin always takes it; the SHOWN pair takes it only if the result on
    // screen is this query's — while a replacement query runs, the screen still holds
    // the previous query's list, and that list keeps its own origin.
    if (key === inFlightKey && (inFlight || (last?.key === key && snapshot.shown))) {
      inFlightOrigin = origin;
      const shown = snapshot.shown;
      if (shown && shown.key === key && shown.origin !== origin) {
        setState({ shown: { ...shown, origin } });
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
    runLoadouts = null;
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
    setState({ running: true, refinement: IDLE, runId: s, failed: false });
    getWorker().postMessage({ seq: s, input, carry });
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

    run,

    warm() {
      getWorker();
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
      setState({ running: false, refinement: IDLE, failed: false });
    },

    retry() {
      if (!snapshot.failed || !inFlightInput || !inFlightOrigin) return;
      run(inFlightInput, inFlightOrigin);
    },

    // Swap the offered better list in — the explicit user action that lets a shown list
    // change. Ceilings only max-merge (both lists' ceilings are proven-achievable). The
    // offer came from the shown pair's own run, so it keeps that pair's origin and key.
    applyPending() {
      const ref = snapshot.refinement;
      const shown = snapshot.shown;
      if (ref.phase !== "done" || !ref.pending || !shown) return;
      const pending = ref.pending;
      const ceilings = mergeCeilingsMonotone(ceilingsView.get().values, pending.ceilings);
      publishCeilings({ values: ceilings, exact: pending.ceilingsExact });
      setState({
        refinement: IDLE,
        shown: { origin: shown.origin, key: shown.key, input: shown.input, final: true, result: pending },
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
