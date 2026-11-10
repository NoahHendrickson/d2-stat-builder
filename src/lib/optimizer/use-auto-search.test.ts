import { describe, expect, test } from "vitest";
import { AUTO_SEARCH_DEBOUNCE_MS, createAutoSearchPolicy } from "./use-auto-search";

/** Manual clock: timers fire only when `advance` passes their due time. */
function setup() {
  let now = 0;
  let nextId = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers = {
    set(fn: () => void, ms: number) {
      const id = nextId++;
      pending.set(id, { at: now + ms, fn });
      return id;
    },
    clear(id: number) {
      pending.delete(id);
    },
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [id, t] of [...pending].sort((a, b) => a[1].at - b[1].at)) {
      if (t.at > now) continue;
      pending.delete(id);
      t.fn();
    }
  };
  const runs: string[] = [];
  /** A distinct search identity per edit, like the panel's memoized callback. */
  const search = (label: string) => () => runs.push(label);
  const policy = createAutoSearchPolicy(timers);
  return { policy, runs, search, advance, pending };
}

describe("auto-search policy", () => {
  test("the first search after the data is ready runs at once", () => {
    const { policy, runs, search } = setup();
    policy.change(false, search("not ready"));
    expect(runs).toEqual([]);
    policy.change(true, search("ready"));
    expect(runs).toEqual(["ready"]);
  });

  test("one-shot edits (ticks, toggles, picks, Reset) search at once", () => {
    const { policy, runs, search, pending } = setup();
    policy.change(true, search("load"));
    policy.change(true, search("tick 100"));
    policy.change(true, search("major 3"));
    expect(runs).toEqual(["load", "tick 100", "major 3"]);
    expect(pending.size).toBe(0);
  });

  test("a drag waits while moving and searches once it pauses", () => {
    const { policy, runs, search, advance } = setup();
    policy.change(true, search("load"));
    for (const v of [10, 20, 30]) {
      policy.burst();
      policy.change(true, search(`drag ${v}`));
      advance(100);
    }
    expect(runs).toEqual(["load"]);
    advance(AUTO_SEARCH_DEBOUNCE_MS);
    expect(runs).toEqual(["load", "drag 30"]);
    // Still holding the thumb after a pause: the next moves wait again.
    policy.burst();
    policy.change(true, search("drag 40"));
    expect(runs).toEqual(["load", "drag 30"]);
  });

  test("releasing the slider searches at once", () => {
    const { policy, runs, search, advance, pending } = setup();
    policy.change(true, search("load"));
    policy.burst();
    policy.change(true, search("drag 40"));
    advance(50);
    policy.commit();
    expect(runs).toEqual(["load", "drag 40"]);
    expect(pending.size).toBe(0);
    advance(1000);
    expect(runs).toEqual(["load", "drag 40"]);
  });

  test("a release that lands before the last move's change still searches that move at once", () => {
    const { policy, runs, search } = setup();
    policy.change(true, search("load"));
    policy.burst();
    policy.change(true, search("drag 40"));
    policy.burst(); // the last move, not yet committed by React
    policy.commit(); // runs the waiting drag 40 now
    policy.change(true, search("drag 41")); // its effect lands after the release
    expect(runs).toEqual(["load", "drag 40", "drag 41"]);
  });

  test("typing waits, Enter or blur searches at once, and a blur with nothing waiting does nothing", () => {
    const { policy, runs, search } = setup();
    policy.change(true, search("load"));
    policy.burst();
    policy.change(true, search("type 1"));
    policy.burst();
    policy.change(true, search("type 10"));
    expect(runs).toEqual(["load"]);
    policy.commit();
    expect(runs).toEqual(["load", "type 10"]);
    policy.commit();
    expect(runs).toEqual(["load", "type 10"]);
  });

  test("a one-shot edit during a waiting burst runs at once and drops the stale wait", () => {
    const { policy, runs, search, advance } = setup();
    policy.change(true, search("load"));
    policy.burst();
    policy.change(true, search("drag 40"));
    policy.change(true, search("toggle set"));
    expect(runs).toEqual(["load", "toggle set"]);
    advance(1000);
    expect(runs).toEqual(["load", "toggle set"]);
  });

  test("a burst while paused (the other tab) doesn't debounce the first edit back", () => {
    const { policy, runs, search } = setup();
    policy.change(true, search("load"));
    policy.change(false, search("theoretical tab"));
    policy.burst();
    policy.change(true, search("back"));
    policy.change(true, search("tick"));
    expect(runs).toEqual(["load", "back", "tick"]);
  });

  test("pausing cancels a waiting search, and dispose does too", () => {
    const { policy, runs, search, advance } = setup();
    policy.change(true, search("load"));
    policy.burst();
    policy.change(true, search("drag"));
    policy.change(false, search("paused"));
    advance(1000);
    expect(runs).toEqual(["load"]);
    policy.change(true, search("resumed"));
    policy.burst();
    policy.change(true, search("drag again"));
    policy.dispose();
    advance(1000);
    expect(runs).toEqual(["load", "resumed"]);
  });
});
