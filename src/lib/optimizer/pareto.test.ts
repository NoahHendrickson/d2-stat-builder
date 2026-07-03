import { describe, expect, test } from "vitest";
import { paretoWithinGroup } from "./pareto";
import { makeInternalPiece, type InternalPiece } from "./tuning";

/** Group members differ only in stats, so plain legendaries model any group. */
function member(id: string, stats: number[]): InternalPiece {
  return makeInternalPiece({ id, stats, exotic: false }, false);
}

const ids = (pieces: InternalPiece[]): string[] =>
  pieces.map((p) => p.id).sort();

describe("paretoWithinGroup", () => {
  test("empty and single-piece groups pass through", () => {
    expect(paretoWithinGroup([])).toEqual([]);
    const solo = [member("a", [10, 0, 0, 0, 0, 0])];
    expect(paretoWithinGroup(solo)).toEqual(solo);
  });

  test("a strictly dominated piece is dropped, the dominator kept", () => {
    const kept = paretoWithinGroup([
      member("worse", [10, 5, 5, 5, 5, 5]),
      member("better", [12, 5, 6, 5, 5, 5]),
    ]);
    expect(ids(kept)).toEqual(["better"]);
  });

  test("non-comparable trade-offs are all kept", () => {
    const kept = paretoWithinGroup([
      member("weapons", [30, 0, 0, 0, 0, 0]),
      member("health", [0, 30, 0, 0, 0, 0]),
      member("split", [15, 15, 0, 0, 0, 0]),
    ]);
    expect(ids(kept)).toEqual(["health", "split", "weapons"]);
  });

  test("a chain keeps only its top", () => {
    const kept = paretoWithinGroup([
      member("c", [10, 10, 10, 0, 0, 0]),
      member("a", [12, 12, 12, 0, 0, 0]),
      member("b", [11, 10, 12, 0, 0, 0]),
    ]);
    expect(ids(kept)).toEqual(["a"]);
  });

  test("a diamond keeps the whole frontier", () => {
    // top dominates left and right (incomparable to each other); bottom is under both.
    const kept = paretoWithinGroup([
      member("bottom", [5, 5, 0, 0, 0, 0]),
      member("left", [20, 5, 0, 0, 0, 0]),
      member("right", [5, 20, 0, 0, 0, 0]),
      member("top", [20, 20, 0, 0, 0, 0]),
    ]);
    expect(ids(kept)).toEqual(["top"]);
    const noTop = paretoWithinGroup([
      member("bottom", [5, 5, 0, 0, 0, 0]),
      member("left", [20, 5, 0, 0, 0, 0]),
      member("right", [5, 20, 0, 0, 0, 0]),
    ]);
    expect(ids(noTop)).toEqual(["left", "right"]);
  });

  test("equal totals with different vectors never dominate each other", () => {
    const kept = paretoWithinGroup([
      member("a", [20, 10, 0, 0, 0, 0]),
      member("b", [10, 20, 0, 0, 0, 0]),
      member("c", [15, 15, 0, 0, 0, 0]),
    ]);
    expect(ids(kept)).toEqual(["a", "b", "c"]);
  });

  test("stat-identical pieces both survive (dedupe's job, not pareto's)", () => {
    const kept = paretoWithinGroup([
      member("a", [10, 10, 0, 0, 0, 0]),
      member("b", [10, 10, 0, 0, 0, 0]),
    ]);
    expect(kept).toHaveLength(2);
  });
});
