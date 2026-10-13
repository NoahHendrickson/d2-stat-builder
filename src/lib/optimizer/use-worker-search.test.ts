import { describe, expect, it } from "vitest";
import {
  createWorkerSearch,
  type SearchSnapshot,
  type WorkerSearchOptions,
} from "./use-worker-search";

/** A fake worker: records what it's sent; the test answers or crashes it. */
class FakeWorker {
  sent: { seq: number; input: string }[] = [];
  terminated = false;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage(msg: { seq: number; input: string }) {
    this.sent.push(msg);
  }
  terminate() {
    this.terminated = true;
  }
  /** Answer the oldest unanswered request with `result:<input>`. */
  reply() {
    const msg = this.sent.shift()!;
    this.onmessage?.({ data: { seq: msg.seq, result: `result:${msg.input}` } } as MessageEvent);
  }
  crash() {
    this.onerror?.();
  }
}

function setup(policy: Pick<WorkerSearchOptions<string, null>, "whenBusy" | "whenOff">) {
  const workers: FakeWorker[] = [];
  let state: SearchSnapshot<string, string, null> = {
    forInput: null,
    result: null,
    failed: false,
    extra: null,
  };
  const search = createWorkerSearch<string, string, null>(
    {
      ...policy,
      createWorker: () => {
        const w = new FakeWorker();
        workers.push(w);
        return w as unknown as Worker;
      },
      read: (m) => ({ result: (m as { result: string }).result }),
      initialExtra: null,
    },
    (next) => (state = next(state)),
  );
  return { search, workers, state: () => state };
}

describe("createWorkerSearch", () => {
  it("queues the newest input behind a running solve, skipping the ones between", () => {
    const { search, workers, state } = setup({ whenBusy: "queue", whenOff: "keep" });
    search.run("a");
    search.run("b");
    search.run("c");
    expect(workers[0].sent.map((m) => m.input)).toEqual(["a"]);
    workers[0].reply();
    expect(state().forInput).toBe("a");
    expect(workers[0].sent.map((m) => m.input)).toEqual(["c"]);
    workers[0].reply();
    expect(state()).toMatchObject({ forInput: "c", result: "result:c", failed: false });
  });

  it("runs a waiting input on a fresh worker when the running solve crashes", () => {
    const { search, workers, state } = setup({ whenBusy: "queue", whenOff: "keep" });
    search.run("a");
    search.run("b");
    workers[0].crash();
    expect(state().failed).toBe(false);
    expect(workers[1].sent.map((m) => m.input)).toEqual(["b"]);
    workers[1].reply();
    expect(state()).toMatchObject({ forInput: "b", result: "result:b", failed: false });
  });

  it("settles the current search as failed when it crashes with nothing waiting", () => {
    const { search, workers, state } = setup({ whenBusy: "queue", whenOff: "keep" });
    search.run("a");
    workers[0].reply();
    search.run("b");
    workers[0].crash();
    expect(state()).toMatchObject({ forInput: "b", result: "result:a", failed: true });
  });

  it("drops a busy worker on the way off, so coming back doesn't wait behind it", () => {
    const { search, workers, state } = setup({ whenBusy: "queue", whenOff: "keep" });
    search.run("a");
    search.off();
    expect(workers[0].terminated).toBe(true);
    search.run("b");
    expect(workers[1].sent.map((m) => m.input)).toEqual(["b"]);
    workers[1].reply();
    expect(state()).toMatchObject({ forInput: "b", result: "result:b" });
  });

  it("keeps an idle worker (and its caches) on the way off", () => {
    const { search, workers } = setup({ whenBusy: "queue", whenOff: "keep" });
    search.run("a");
    workers[0].reply();
    search.off();
    expect(workers[0].terminated).toBe(false);
    search.run("b");
    expect(workers).toHaveLength(1);
    expect(workers[0].sent.map((m) => m.input)).toEqual(["b"]);
  });

  it("restart mode terminates a busy worker for the new input", () => {
    const { search, workers, state } = setup({ whenBusy: "restart", whenOff: "release" });
    search.run("a");
    search.run("b");
    expect(workers[0].terminated).toBe(true);
    expect(workers[1].sent.map((m) => m.input)).toEqual(["b"]);
    workers[1].reply();
    expect(state()).toMatchObject({ forInput: "b", result: "result:b" });
  });

  it("ignores a reply to a search that was turned off", () => {
    const { search, workers, state } = setup({ whenBusy: "queue", whenOff: "release" });
    search.run("a");
    workers[0].reply();
    search.run("b");
    const stale = workers[0];
    search.off();
    stale.reply();
    expect(state().forInput).toBe("a");
  });
});
