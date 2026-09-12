import { test, expect, describe, vi, afterEach } from "vitest";

afterEach(() => {
  vi.useRealTimers();
});
import { createOptimizerStore, type WorkerLike } from "./optimizer-store";
import type { OptimizerInput, OptimizerOutput, OptimizerRequest, OptimizerResponse } from "./types";

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
    store.run(input());
    store.run(input()); // builder re-mounted, auto-search fired again
    expect(worker().posted).toHaveLength(1);
    expect(FakeWorker.instances).toHaveLength(1);
    expect(store.getSnapshot().running).toBe(true);
  });

  test("the same input after a finished run keeps the shown result", () => {
    const { store, worker } = setup();
    store.run(input());
    const seq = worker().posted[0].seq;
    worker().emit({ seq, kind: "result", output: output(), refining: false, verified: true });
    const before = store.getSnapshot();
    store.run(input());
    expect(store.getSnapshot()).toBe(before);
    expect(worker().posted).toHaveLength(1);
  });

  test("a different input supersedes the in-flight run (worker recreated)", () => {
    const { store, worker } = setup();
    store.run(input(10));
    const first = worker();
    store.run(input(20));
    expect(first.terminated).toBe(true);
    expect(FakeWorker.instances).toHaveLength(2);
    expect(worker().posted[0].input.minimums[0]).toBe(20);
  });

  test("after cancel, the same input runs again", () => {
    const { store, worker } = setup();
    store.run(input());
    store.cancel();
    expect(store.getSnapshot().running).toBe(false);
    store.run(input());
    expect(worker().posted).toHaveLength(1);
    expect(store.getSnapshot().running).toBe(true);
  });
});

describe("progress stays out of the snapshot", () => {
  test("raw progress updates the value store without notifying snapshot subscribers", () => {
    const { store, events, worker } = setup();
    store.run(input());
    const n = events.length;
    const seq = worker().posted[0].seq;
    worker().emit({ seq, kind: "progress", progress: 0.5 });
    worker().emit({ seq, kind: "progress", progress: 0.6 });
    expect(store.progress.get()).toBe(0.6);
    expect(events.length).toBe(n);
  });

  test("refinement progress updates the value store without notifying snapshot subscribers", () => {
    const { store, events, worker } = setup();
    store.run(input());
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
    store.run(input());
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
    store.run(input());
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
    store.run(input());
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
    store.run(input(1));
    seq = worker().posted.at(-1)!.seq;
    worker().emit({ seq, kind: "ceilings", ceilings: [40, 0, 0, 0, 0, 0] });
    worker().emit({ seq, kind: "ceilings", ceilings: [50, 0, 0, 0, 0, 0] });
    store.run(input(2));
    vi.advanceTimersByTime(200);
    // The held [50] belonged to the superseded run and must not land on the new one.
    expect(store.ceilingsView.get().values?.[0]).toBe(40);
  });
});

test("stale messages from a superseded run are ignored", () => {
  const { store, worker } = setup();
  store.run(input(1));
  const old = worker();
  const oldSeq = old.posted[0].seq;
  store.run(input(2));
  old.emit({ seq: oldSeq, kind: "result", output: output(), refining: false, verified: true });
  expect(store.getSnapshot().result).toBeNull();
  expect(store.getSnapshot().running).toBe(true);
});
