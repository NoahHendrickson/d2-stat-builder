import { test, expect, describe, vi, afterEach } from "vitest";

afterEach(() => {
  vi.useRealTimers();
});
import { createOptimizerStore, type WorkerLike } from "./optimizer-store";
import type { OptimizerInput, OptimizerOutput, OptimizerRequest, OptimizerResponse } from "./types";
import type { QueryOrigin } from "../loadouts/types";

/** A stand-in origin for tests that don't care which builder state a query came from. */
const ORIGIN: QueryOrigin = { targets: [0, 0, 0, 0, 0, 0] };

class FakeWorker implements WorkerLike {
  static instances: FakeWorker[] = [];
  posted: OptimizerRequest[] = [];
  terminated = false;
  onmessage: ((e: MessageEvent<OptimizerResponse>) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(msg: OptimizerRequest) {
    this.posted.push(msg);
  }
  terminate() {
    this.terminated = true;
  }
  emit(msg: OptimizerResponse) {
    this.onmessage?.({ data: msg } as MessageEvent<OptimizerResponse>);
  }
}

const input = (min = 0): OptimizerInput => ({
  slots: [[], [], [], [], []],
  minimums: [min, 0, 0, 0, 0, 0],
});

const output = (over: Partial<OptimizerOutput> = {}): OptimizerOutput => ({
  loadouts: [],
  combosTried: 0,
  combosValid: 0,
  ceilings: [1, 1, 1, 1, 1, 1],
  ceilingUppers: [1, 1, 1, 1, 1, 1],
  ceilingsExact: true,
  capped: false,
  ...over,
});

function setup() {
  FakeWorker.instances = [];
  let t = 0;
  const store = createOptimizerStore(() => new FakeWorker(), () => t);
  const events: string[] = [];
  store.subscribe(() => events.push("snapshot"));
  return { store, events, tick: (ms: number) => (t += ms), worker: () => FakeWorker.instances.at(-1)! };
}

describe("re-attaching instead of restarting", () => {
  test("the same input while a run is in flight does not post a second request", () => {
    const { store, worker } = setup();
    store.run(input(), ORIGIN);
    store.run(input(), ORIGIN); // builder re-mounted, auto-search fired again
    expect(worker().posted).toHaveLength(1);
    expect(FakeWorker.instances).toHaveLength(1);
    expect(store.getSnapshot().running).toBe(true);
  });

  test("the same input after a finished run keeps the shown result", () => {
    const { store, worker } = setup();
    store.run(input(), ORIGIN);
    const seq = worker().posted[0].seq;
    worker().emit({ seq, kind: "result", output: output(), refining: false, verified: true });
    const before = store.getSnapshot();
    store.run(input(), ORIGIN);
    expect(store.getSnapshot()).toBe(before);
    expect(worker().posted).toHaveLength(1);
  });

  test("a different input supersedes the in-flight run (worker recreated)", () => {
    const { store, worker } = setup();
    store.run(input(10), ORIGIN);
    const first = worker();
    store.run(input(20), ORIGIN);
    expect(first.terminated).toBe(true);
    expect(FakeWorker.instances).toHaveLength(2);
    expect(worker().posted[0].input.minimums[0]).toBe(20);
  });

  test("after cancel, the same input runs again", () => {
    const { store, worker } = setup();
    store.run(input(), ORIGIN);
    store.cancel();
    expect(store.getSnapshot().running).toBe(false);
    store.run(input(), ORIGIN);
    expect(worker().posted).toHaveLength(1);
    expect(store.getSnapshot().running).toBe(true);
  });
});

describe("progress stays out of the snapshot", () => {
  test("raw progress updates the value store without notifying snapshot subscribers", () => {
    const { store, events, worker } = setup();
    store.run(input(), ORIGIN);
    const n = events.length;
    const seq = worker().posted[0].seq;
    worker().emit({ seq, kind: "progress", progress: 0.5 });
    worker().emit({ seq, kind: "progress", progress: 0.6 });
    expect(store.progress.get()).toBe(0.6);
    expect(events.length).toBe(n);
  });

  test("refinement progress updates the value store without notifying snapshot subscribers", () => {
    const { store, events, worker } = setup();
    store.run(input(), ORIGIN);
    const seq = worker().posted[0].seq;
    worker().emit({ seq, kind: "result", output: output({ capped: true }), refining: true, verified: false });
    expect(store.getSnapshot().refinement.phase).toBe("running");
    const n = events.length;
    worker().emit({ seq, kind: "progress", progress: 0.1 });
    worker().emit({ seq, kind: "progress", progress: 0.2 });
    expect(store.refinementProgress.get()).toBe(0.2);
    expect(events.length).toBe(n);
  });

  test("ceiling messages are throttled into the ceilings view, not the snapshot", () => {
    const { store, events, worker, tick } = setup();
    store.run(input(), ORIGIN);
    const seq = worker().posted[0].seq;
    const n = events.length;
    worker().emit({ seq, kind: "ceilings", ceilings: [10, 0, 0, 0, 0, 0] });
    worker().emit({ seq, kind: "ceilings", ceilings: [20, 0, 0, 0, 0, 0] });
    expect(events.length).toBe(n);
    expect(store.ceilingsView.get().values?.[0]).toBe(10);
    tick(100);
    worker().emit({ seq, kind: "ceilings", ceilings: [30, 0, 0, 0, 0, 0] });
    expect(store.ceilingsView.get().values?.[0]).toBe(30);
    expect(events.length).toBe(n);
  });

  test("a ceiling update dropped by the throttle is published when the window closes", () => {
    vi.useFakeTimers();
    const { store, worker, tick } = setup();
    store.run(input(), ORIGIN);
    const seq = worker().posted[0].seq;
    worker().emit({ seq, kind: "ceilings", ceilings: [10, 0, 0, 0, 0, 0] });
    tick(40);
    worker().emit({ seq, kind: "ceilings", ceilings: [20, 0, 0, 0, 0, 0] });
    worker().emit({ seq, kind: "ceilings", ceilings: [25, 0, 0, 0, 0, 0] });
    expect(store.ceilingsView.get().values?.[0]).toBe(10);
    vi.advanceTimersByTime(60);
    expect(store.ceilingsView.get().values?.[0]).toBe(25);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("a result flushes the throttle, and a new run drops a held update", () => {
    vi.useFakeTimers();
    const { store, worker, tick } = setup();
    store.run(input(), ORIGIN);
    let seq = worker().posted[0].seq;
    worker().emit({ seq, kind: "ceilings", ceilings: [10, 0, 0, 0, 0, 0] });
    worker().emit({ seq, kind: "ceilings", ceilings: [20, 0, 0, 0, 0, 0] });
    worker().emit({
      seq,
      kind: "result",
      output: output({ ceilings: [30, 0, 0, 0, 0, 0] }),
      refining: false,
      verified: true,
    });
    expect(store.ceilingsView.get().values?.[0]).toBe(30);
    expect(vi.getTimerCount()).toBe(0);

    tick(1000);
    store.run(input(1), ORIGIN);
    seq = worker().posted.at(-1)!.seq;
    worker().emit({ seq, kind: "ceilings", ceilings: [40, 0, 0, 0, 0, 0] });
    worker().emit({ seq, kind: "ceilings", ceilings: [50, 0, 0, 0, 0, 0] });
    store.run(input(2), ORIGIN);
    vi.advanceTimersByTime(200);
    // The held [50] belonged to the superseded run and must not land on the new one.
    // (input(2) tightens input(0)'s minimums with no surviving loadout to carry, so the
    // new run starts with no overlay at all — the previous query's values are not
    // claims about this one.)
    expect(store.ceilingsView.get().values).toBeNull();
  });
});

describe("results are bound to the query that produced them", () => {
  const loadout = () => ({
    pieceIds: ["h", "a", "c", "l", "k"],
    baseStats: [50, 0, 0, 0, 0, 0],
    stats: [50, 0, 0, 0, 0, 0],
    tuningBonus: [0, 0, 0, 0, 0, 0],
    tuning: [null, null, null, null, null],
    modBonus: [0, 0, 0, 0, 0, 0],
    modsUsed: { major: 0, minor: 0 },
    artificeBonus: [0, 0, 0, 0, 0, 0],
    artifice: [null, null, null, null, null],
    total: 50,
    exotic: false,
    power: null,
  });

  test("the origin handed to run() comes back with that run's result", () => {
    const { store, worker } = setup();
    const origin = { targets: [1, 0, 0, 0, 0, 0] };
    store.run(input(1), origin);
    expect(store.getSnapshot().shown).toBeNull();
    const seq = worker().posted[0].seq;
    worker().emit({ seq, kind: "result", output: output(), refining: false, verified: true });
    expect(store.getSnapshot().shown?.origin).toBe(origin);
  });

  test("a newer query keeps the shown result paired with ITS origin until its own result lands", () => {
    const { store, worker } = setup();
    const a = { targets: [1, 0, 0, 0, 0, 0] };
    const b = { targets: [2, 0, 0, 0, 0, 0] };
    store.run(input(1), a);
    let seq = worker().posted[0].seq;
    worker().emit({ seq, kind: "result", output: output(), refining: false, verified: true });
    store.run(input(2), b);
    // Old list still showing (frozen-list UX), old origin still attached — Save/DIM on it
    // must use `a`, not the live `b`.
    expect(store.getSnapshot().shown).not.toBeNull();
    expect(store.getSnapshot().shown?.origin).toBe(a);
    expect(store.getSnapshot().running).toBe(true);
    // Cancelling leaves the pair intact and honest.
    store.cancel();
    expect(store.getSnapshot().shown?.origin).toBe(a);
    // A fresh run of `b` delivering its result rebinds.
    store.run(input(2), b);
    seq = worker().posted.at(-1)!.seq;
    worker().emit({ seq, kind: "result", output: output(), refining: false, verified: true });
    expect(store.getSnapshot().shown?.origin).toBe(b);
  });

  test("a capped result and its later pending offer share the run's origin", () => {
    const { store, worker } = setup();
    const a = { targets: [1, 0, 0, 0, 0, 0] };
    store.run(input(1), a);
    const seq = worker().posted[0].seq;
    worker().emit({ seq, kind: "result", output: output({ capped: true }), refining: true, verified: false });
    expect(store.getSnapshot().shown?.origin).toBe(a);
    const better = output({ capped: true, loadouts: [loadout()] });
    worker().emit({ seq, kind: "better", output: better });
    worker().emit({ seq, kind: "result", output: output({ capped: true }), refining: false, verified: true });
    store.applyPending();
    expect(store.getSnapshot().shown?.result).toBe(better);
    expect(store.getSnapshot().shown?.origin).toBe(a);
  });

  test("re-attaching to an in-flight replacement query never re-labels the older shown result", () => {
    // Review finding (PR #38): A's result is on screen while B runs. Re-dispatching B
    // (leaving and returning to the builder, or an origin-only edit) must refresh what
    // B's eventual result will carry — but must NOT hand B's origin to A's list, or
    // Save / DIM would combine A's build with B's targets and fragments.
    const { store, worker } = setup();
    const a: QueryOrigin = { targets: [1, 0, 0, 0, 0, 0] };
    const b1: QueryOrigin = { targets: [2, 0, 0, 0, 0, 0] };
    const b2: QueryOrigin = { targets: [2, 0, 0, 0, 0, 0], setBonuses: { 7: 2 } };
    store.run(input(1), a);
    let seq = worker().posted[0].seq;
    worker().emit({ seq, kind: "result", output: output(), refining: false, verified: true });
    store.run(input(2), b1);
    store.run(input(2), b2); // re-attach to the in-flight B with a newer origin
    expect(worker().posted).toHaveLength(2);
    const shown = store.getSnapshot().shown!;
    expect(shown.origin).toBe(a); // A's list keeps A's origin
    store.cancel();
    expect(store.getSnapshot().shown!.origin).toBe(a);
    // When B does deliver, it carries the NEWEST origin it was re-attached with.
    store.run(input(2), b2);
    seq = worker().posted.at(-1)!.seq;
    worker().emit({ seq, kind: "result", output: output(), refining: false, verified: true });
    expect(store.getSnapshot().shown!.origin).toBe(b2);
  });

  test("re-running the identical query refreshes the origin in place without a new search", () => {
    const { store, worker } = setup();
    const a: QueryOrigin = { targets: [1, 0, 0, 0, 0, 0] };
    const b: QueryOrigin = { targets: [1, 0, 0, 0, 0, 0], setBonuses: { 7: 2 } }; // same optimizer input, newer builder state
    store.run(input(1), a);
    const seq = worker().posted[0].seq;
    worker().emit({ seq, kind: "result", output: output(), refining: false, verified: true });
    store.run(input(1), b);
    expect(worker().posted).toHaveLength(1);
    expect(store.getSnapshot().shown?.origin).toBe(b);
    // …and while a run is in flight, the newest origin is what its result will carry.
    store.run(input(3), a);
    store.run(input(3), b);
    const seq2 = worker().posted.at(-1)!.seq;
    worker().emit({ seq: seq2, kind: "result", output: output(), refining: false, verified: true });
    expect(store.getSnapshot().shown?.origin).toBe(b);
  });
});

describe("slider ceilings only claim what is proven for the current query", () => {
  test("a query that can't carry the previous ceilings starts with none", () => {
    const { store, worker } = setup();
    store.run(input(1), ORIGIN);
    const seq = worker().posted[0].seq;
    worker().emit({ seq, kind: "result", output: output({ ceilings: [40, 1, 1, 1, 1, 1] }), refining: false, verified: true });
    expect(store.ceilingsView.get().values?.[0]).toBe(40);
    // Different mods ⇒ a different query: the old 40 is not achievable-for-this-query.
    store.run({ ...input(1), mods: { major: 1, minor: 0 } }, ORIGIN);
    expect(store.ceilingsView.get().values).toBeNull();
    expect(store.ceilingsView.get().exact).toBe(false);
  });

  test("a loosened edit carries the previous achievable ceilings as its opening overlay", () => {
    const { store, worker } = setup();
    store.run(input(5), ORIGIN);
    const seq = worker().posted[0].seq;
    worker().emit({ seq, kind: "result", output: output({ ceilings: [40, 1, 1, 1, 1, 1] }), refining: false, verified: true });
    store.run(input(0), ORIGIN); // loosened: what was achievable stays achievable
    expect(store.ceilingsView.get().values).toEqual([40, 1, 1, 1, 1, 1]);
    expect(store.ceilingsView.get().exact).toBe(false);
  });
});

test("stale messages from a superseded run are ignored", () => {
  const { store, worker } = setup();
  store.run(input(1), ORIGIN);
  const old = worker();
  const oldSeq = old.posted[0].seq;
  store.run(input(2), ORIGIN);
  old.emit({ seq: oldSeq, kind: "result", output: output(), refining: false, verified: true });
  expect(store.getSnapshot().shown).toBeNull();
  expect(store.getSnapshot().running).toBe(true);
});
