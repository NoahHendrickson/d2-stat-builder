import { describe, expect, test } from "vitest";

import { matchRank } from "./rank";

describe("matchRank", () => {
  test("exact match ranks 0", () => {
    expect(matchRank("Fatebringer", "fatebringer")).toBe(0);
  });

  test("prefix ranks 1", () => {
    expect(matchRank("Fatebringer", "fate")).toBe(1);
  });

  test("word-boundary prefix ranks 2", () => {
    expect(matchRank("Sunshot Scout", "scout")).toBe(2);
  });

  test("contains ranks 3", () => {
    expect(matchRank("Surrounded", "round")).toBe(3);
  });

  test("no match returns null", () => {
    expect(matchRank("Firefly", "xyz")).toBeNull();
  });
});
