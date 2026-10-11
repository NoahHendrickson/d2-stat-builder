// Model-based operation-sequence tests for optimizer-store.ts (discovery suite).
// See store-harness.ts for the op language, fake worker scripts and reference model.
// PROP_RUNS scales the number of sequences (default 300 per property).
import { afterAll, describe, expect, test, vi } from "vitest";
import fc from "fast-check";
import { coverage, GREEN, replay, STRICT, type HarnessOptions, type Op } from "./store-harness";
import { createOptimizerStore, type WorkerLike } from "../optimizer-store";
import type { OptimizerInput, OptimizerOutput, OptimizerRequest, OptimizerResponse } from "../types";
import type { QueryOrigin } from "../../loadouts/types";

const RUNS = Number(process.env.PROP_RUNS ?? 300);

const opArb = (adversarial: boolean): fc.Arbitrary<Op> =>
  fc.oneof(
    { weight: 6, arbitrary: fc.record({ k: fc.constant("run" as const), q: fc.nat(4), o: fc.nat(3), script: fc.nat() }) },
    { weight: 1, arbitrary: fc.constant({ k: "cancel" as const }) },
    { weight: 3, arbitrary: fc.constant({ k: "apply" as const }) },
    { weight: 1, arbitrary: fc.constant({ k: "warm" as const }) },
    {
      weight: 9,
      arbitrary: fc.record({
        k: fc.constant("deliver" as const),
        // biased toward the newest worker; any older (terminated) worker too
        w: fc.oneof(fc.constant(-1), fc.constant(-1), fc.nat(5)),
        n: fc.integer({ min: 1, max: 4 }),
      }),
    },
    {
      weight: 3,
      arbitrary: fc.record({
        k: fc.constant("advance" as const),
        ms: fc.oneof(fc.integer({ min: 0, max: 40 }), fc.integer({ min: 40, max: 160 }), fc.constant(100)),
      }),
    },
    {
      weight: 1,
      arbitrary: fc.record({ k: fc.constant("error" as const), w: fc.oneof(fc.constant(-1), fc.nat(5)), dead: fc.boolean() }),
    },
    ...(adversarial
      ? [{ weight: 3, arbitrary: fc.record({ k: fc.constant("chaos" as const), w: fc.oneof(fc.constant(-1), fc.nat(5)), pick: fc.nat() }) }]
      : []),
  );

const check = (opt: HarnessOptions, adversarial = false, runs = RUNS) =>
  fc.assert(
    fc.property(fc.array(opArb(adversarial), { maxLength: 60, size: "max" }), (ops) => {
      replay(ops, opt);
    }),
    { numRuns: runs },
  );

afterAll(() => {
  if (process.env.PROP_COVERAGE) process.stderr.write(JSON.stringify(coverage, null, 2) + "\n");
});

describe("optimizer store — model-based sequences", () => {
  test("protocol-plausible workers: snapshot, overlay and requests match the model", () => {
    check(GREEN);
  });

  test("adversarial delivery (duplicates, out of order, other requests): safety invariants", () => {
    check({ ...GREEN, mode: "adversarial", noisyCeilings: true }, true);
  });
});

// ---------------------------------------------------------------------------------------
// Findings — deterministic repros of sequences the strict model rejects (see the report).
// test.fails keeps the discovery suite green while pinning each behavior; every test
// asserts what the STRICT model expects, so it flips (and fails as a test.fails) once
// the store changes.

class Fake implements WorkerLike {
  posted: OptimizerRequest[] = [];
  terminated = false;
  onmessage: ((e: MessageEvent<OptimizerResponse>) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  constructor(list: Fake[]) {
    list.push(this);
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
const inputF = (min0: number): OptimizerInput => ({ slots: [[], [], [], [], []], minimums: [min0, 0, 0, 0, 0, 0] });
const outF = (over: Partial<OptimizerOutput> = {}): OptimizerOutput => ({
  loadouts: [],
  combosTried: 0,
  combosValid: 0,
  combosValidExact: true,
  ceilings: [50, 50, 50, 50, 50, 50],
  ceilingUppers: [60, 60, 60, 60, 60, 60],
  ceilingsExact: false,
  capped: true,
  ...over,
});
function setupF() {
  const workers: Fake[] = [];
  const store = createOptimizerStore(() => new Fake(workers), () => 0);
  const seqOf = (w: Fake) => w.posted.at(-1)!.seq;
  return { store, workers, seqOf };
}
const oA1: QueryOrigin = { targets: [1, 0, 0, 0, 0, 0] };
const oA2: QueryOrigin = { targets: [1, 0, 0, 0, 0, 0], setBonuses: { 7: 2 } };
const oB: QueryOrigin = { targets: [2, 0, 0, 0, 0, 0] };

describe("findings", () => {
  test.fails("F1: re-running a query whose refinement died with the worker never retries it", () => {
    const { store, workers, seqOf } = setupF();
    store.run(inputF(0), oA1);
    const w = workers[0];
    w.emit({ seq: seqOf(w), kind: "result", output: outF(), refining: true, verified: false });
    w.onerror!(new Event("error")); // background refinement dies
    // Actual: running=false, refinement idle, capped first-pass list + "81+" overlays stay.
    store.run(inputF(0), oA1); // builder remount / auto-search for the same state
    // Strict expectation: the dead refinement is retried. Actual: re-attaches, nothing posted.
    expect(workers.flatMap((x) => x.posted)).toHaveLength(2);
  });

  test.fails("F2: an error event while nothing is in flight wipes the finished refinement and its offer", () => {
    const { store, workers, seqOf } = setupF();
    store.run(inputF(0), oA1);
    const w = workers[0];
    const seq = seqOf(w);
    w.emit({ seq, kind: "result", output: outF(), refining: true, verified: false });
    w.emit({ seq, kind: "better", output: outF({ combosValid: 1 }) });
    w.emit({ seq, kind: "result", output: outF(), refining: false, verified: true });
    expect(store.getSnapshot().refinement.phase).toBe("done");
    w.onerror!(new Event("error")); // the idle worker reports an error
    // Actual: refinement → idle; the "Stronger builds found — Show them" offer is gone.
    expect(store.getSnapshot().refinement.phase).toBe("done");
  });

  test.fails("F3: after onerror the store keeps the (possibly dead) worker and posts the next search to it", () => {
    const { store, workers } = setupF();
    store.warm();
    workers[0].onerror!(new Event("error")); // e.g. the worker chunk failed to load
    store.run(inputF(0), oA1);
    // Actual: posted to workers[0] — if it never loaded, running stays true forever.
    expect(workers).toHaveLength(2);
    expect(workers[0].posted).toHaveLength(0);
  });

  test.fails("F4: a late onerror from a TERMINATED worker aborts the current run's state", () => {
    const { store, workers } = setupF();
    store.run(inputF(0), oA1);
    store.run(inputF(10), oB); // workers[0] terminated, workers[1] runs B
    workers[0].onerror!(new Event("error")); // late event from the old worker
    // Actual: running=false while B is still searching.
    expect(store.getSnapshot().running).toBe(true);
  });

  test.fails("F4b: …and the next search then queues behind the still-running one", () => {
    const { store, workers, seqOf } = setupF();
    store.run(inputF(0), oA1);
    store.run(inputF(10), oB);
    const w1 = workers[1];
    w1.emit({ seq: seqOf(w1), kind: "result", output: outF(), refining: true, verified: false }); // B refining (≤45 s)
    workers[0].onerror!(new Event("error"));
    store.run(inputF(20), oB);
    expect(w1.terminated).toBe(true); // actual: false — the new search waits behind B's refinement
  });

  test.fails("F5: A→B→A restarts A and leaves A's shown list paired with the OLDER origin", () => {
    const { store, workers, seqOf } = setupF();
    store.run(inputF(0), oA1);
    const w = workers[0];
    w.emit({ seq: seqOf(w), kind: "result", output: outF({ capped: false, ceilingsExact: true }), refining: false, verified: true });
    store.run(inputF(10), oB);
    store.run(inputF(0), oA2); // back to A, from a newer builder state with the same stat effect
    // A's list is on screen; Save/DIM read shown.origin. Actual: oA1 until A's re-run lands.
    expect(store.getSnapshot().shown!.origin).toBe(oA2);
  });

  test.fails("A2: a backwards wall-clock step (default now = Date.now) freezes streamed overlays", () => {
    vi.useFakeTimers();
    try {
      const workers: Fake[] = [];
      let t = 10_000_000;
      const store = createOptimizerStore(() => new Fake(workers), () => t);
      store.run(inputF(0), oA1);
      const w = workers[0];
      const seq = w.posted[0].seq;
      w.emit({ seq, kind: "ceilings", ceilings: [10, 10, 10, 10, 10, 10] }); // published
      t -= 3_600_000; // NTP / manual clock correction: one hour back
      w.emit({ seq, kind: "ceilings", ceilings: [20, 20, 20, 20, 20, 20] });
      vi.advanceTimersByTime(1_000);
      // Actual: held behind a ~1 h trailing-edge timer; only the next result unfreezes it.
      expect(store.ceilingsView.get().values?.[0]).toBe(20);
    } finally {
      vi.useRealTimers();
    }
  });

  test.fails("A1 (adversarial only): a ceilings message after an exact final result inherits 'exact'", () => {
    const { store, workers, seqOf } = setupF();
    store.run(inputF(0), oA1);
    const w = workers[0];
    const seq = seqOf(w);
    w.emit({
      seq,
      kind: "result",
      output: outF({ capped: false, ceilingsExact: true, ceilingUppers: [50, 50, 50, 50, 50, 50] }),
      refining: false,
      verified: true,
    });
    w.emit({ seq, kind: "ceilings", ceilings: [40, 40, 40, 40, 40, 40] }); // impossible from one in-order worker
    // Actual: overlay {values: 40s, exact: true} — "Max 40" while the proven max is 50.
    expect(store.ceilingsView.get().exact).toBe(false);
  });
});

// Exploratory: re-enable finding gates, e.g. PROP_GATES='{"checkErrorRestart":true}' or
// PROP_GATES=strict (every gate on — fails on the findings above). PROP_ADV=1 adds chaos.
const GATES = process.env.PROP_GATES;
test.skipIf(!GATES)("exploration with finding gates re-enabled", () => {
  const over = GATES === "strict" ? STRICT : { ...GREEN, ...JSON.parse(GATES ?? "{}") };
  const adv = !!process.env.PROP_ADV;
  check(adv ? { ...over, mode: "adversarial" } : over, adv, Number(process.env.PROP_RUNS ?? 2000));
});
