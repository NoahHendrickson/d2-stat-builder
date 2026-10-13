import { describe, expect, it } from "vitest";
import {
  clearClassBound,
  DEFAULT_TAB,
  setTabField,
  updateTabs,
  type BuilderTabs,
  type TabSelections,
} from "./use-builder-tabs";

const picked: TabSelections = {
  ...DEFAULT_TAB,
  targets: [100, 0, 0, 0, 0, 0],
  setReqs: { 1: 2 },
  exoticName: "Foo",
  exoticPerks: [1, 2],
};

const state = (actual: TabSelections, theoretical: TabSelections): BuilderTabs => ({
  mode: "actual",
  actual,
  theoretical,
});

describe("updateTabs", () => {
  it("writes to the named tab and leaves the other alone", () => {
    const before = state(DEFAULT_TAB, DEFAULT_TAB);
    const after = updateTabs(before, "actual", (t) => setTabField(t, "major", 3));
    expect(after.actual.major).toBe(3);
    expect(after.theoretical).toBe(DEFAULT_TAB);
  });

  it("applies a functional update to each tab's own value with 'both'", () => {
    const before = state({ ...DEFAULT_TAB, major: 1 }, { ...DEFAULT_TAB, major: 4 });
    const after = updateTabs(before, "both", (t) => setTabField(t, "major", (m) => m + 1));
    expect(after.actual.major).toBe(2);
    expect(after.theoretical.major).toBe(5);
  });

  it("keeps the state object when nothing changed", () => {
    const before = state(picked, DEFAULT_TAB);
    expect(updateTabs(before, "actual", (t) => setTabField(t, "major", 0))).toBe(before);
    expect(updateTabs(before, "both", (t) => setTabField(t, "targets", (v) => v))).toBe(before);
  });
});

describe("clearClassBound", () => {
  it("drops sets, exotic and Spirit pair, keeping the rest", () => {
    const cleared = clearClassBound(picked);
    expect(cleared).toMatchObject({ setReqs: {}, exoticName: null, exoticPerks: [null, null] });
    expect(cleared.targets).toBe(picked.targets);
  });

  it("is a no-op on a tab with nothing class-bound", () => {
    const tab = { ...DEFAULT_TAB, targets: [0, 50, 0, 0, 0, 0] };
    expect(clearClassBound(tab)).toBe(tab);
    const before = state(DEFAULT_TAB, tab);
    expect(updateTabs(before, "both", clearClassBound)).toBe(before);
  });
});
