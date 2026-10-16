import { afterEach, describe, expect, test, vi } from "vitest";
import { buildSlots } from "./bounds";
import { runCeilings, solveCeilings } from "./ceilings";
import { solve } from "./solve";
import { realWarlockCodaInput } from "./real-pool.fixture";

describe("ceiling sweeps reopen windows a timeout closed", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * A clock that reads 0 until the first probe's first deadline check (the third read:
   * the global deadline, the first probe's share, then the walk's tick at node 0), then
   * jumps past that probe's share and stays there. Exactly one probe times out and no
   * other ever can, so the run is deterministic: the timeout halves that stat's working
   * window below its true ceiling, and only reopening the window can win it back.
   */
  const jumpOnFirstProbe = (jump: number): void => {
    let reads = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (++reads >= 3 ? jump : 0));
  };

  test("one timed-out probe leaves the inline pass inexact and the reopened sweep exact", () => {
    const q = realWarlockCodaInput();
    const seed = solve(q, { ceilingBudgetMs: 0 }).ceilings;
    const slots = buildSlots(q);
    // Reference: a frozen clock never times out, so this is the exhaustive answer.
    vi.spyOn(performance, "now").mockImplementation(() => 0);
    const reference = runCeilings(q, slots, seed, 6000);
    vi.restoreAllMocks();
    expect(reference.exact).toBe(true);
    expect(reference.stats.timedOut).toBe(0);

    // 6000 over 6 open stats is a 1000 share, so a jump to 1001 times the first probe
    // out with most of the budget left.
    jumpOnFirstProbe(1001);
    const inline = runCeilings(q, slots, seed, 6000);
    vi.restoreAllMocks();
    expect(inline.stats.timedOut).toBe(1);
    expect(inline.exact).toBe(false);

    jumpOnFirstProbe(1001);
    const reopened = solveCeilings(q, seed, 6000);
    expect(reopened.stats.timedOut).toBe(1);
    expect(reopened.exact).toBe(true);
    expect(reopened.ceilings).toEqual(reference.ceilings);
    expect(reopened.uppers).toEqual(reference.ceilings);
  });
});
