import { beforeEach, describe, expect, it } from "vitest";
import { memoryStorage } from "@/lib/test/memory-storage";
import type { BuilderSnapshot } from "../loadouts/types";
import { DEFAULT_POWER_RANGE } from "./selection-storage";
import {
  THEORY_CURRENT_KEY,
  THEORY_SAVED_KEY,
  THEORY_STORAGE_VERSION,
  findTheoryBuild,
  loadSavedTheoryBuilds,
  loadTheoryInputs,
  parseSavedTheoryBuilds,
  resolveTheoryBuild,
  saveTheoryInputs,
  skippedNote,
  withTheoryBuild,
  withoutTheoryBuild,
  writeSavedTheoryBuilds,
  type SavedTheoryBuild,
  type TheoryBuildOptions,
} from "./theory-storage";

let store: Storage;
beforeEach(() => {
  store = memoryStorage();
  (globalThis as { localStorage?: Storage }).localStorage = store;
});

const snapshot = (over: Partial<BuilderSnapshot> = {}): BuilderSnapshot => ({
  targets: [100, 0, 50, 0, 0, 30],
  major: 2,
  setReqs: { 111: 2 },
  raidReqs: {},
  exoticName: "Gyrfalcon's Hauberk",
  exoticPerks: [null, null],
  allowTuning: true,
  balancedTuning: true,
  legacyExotics: true,
  lowerTierArmor: false,
  legacyArmor: false,
  powerRange: DEFAULT_POWER_RANGE,
  activeSubclass: "Void",
  fragmentHashes: [1, 2],
  ...over,
});

const build = (name: string, over: Partial<SavedTheoryBuild> = {}): SavedTheoryBuild => ({
  name,
  classType: 2,
  builder: snapshot(),
  ...over,
});

describe("saved theoretical builds", () => {
  it("round-trips a save through storage", () => {
    writeSavedTheoryBuilds(withTheoryBuild([], build("Raid")));
    expect(loadSavedTheoryBuilds()).toEqual([build("Raid")]);
  });

  it("overwrites a build saved under the same name, ignoring case", () => {
    const first = withTheoryBuild([build("Raid"), build("Solo")], build("Raid"));
    const next = withTheoryBuild(first, build("raid", { classType: 0 }));
    expect(next.map((b) => [b.name, b.classType])).toEqual([
      ["raid", 0],
      ["Solo", 2],
    ]);
    expect(findTheoryBuild(next, "RAID")?.classType).toBe(0);
  });

  it("deletes by name and keeps the rest", () => {
    const list = [build("Raid"), build("Solo")];
    expect(withoutTheoryBuild(list, "raid").map((b) => b.name)).toEqual(["Solo"]);
  });

  it("lists builds by name", () => {
    const list = [build("b"), build("C"), build("a")].reduce(withTheoryBuild, []);
    expect(list.map((b) => b.name)).toEqual(["a", "b", "C"]);
  });

  it("reads malformed or old-format storage as empty", () => {
    for (const raw of [
      "{not json",
      "null",
      "[]",
      JSON.stringify({ version: 0, builds: [build("Old")] }),
      JSON.stringify({ version: THEORY_STORAGE_VERSION, builds: "nope" }),
    ]) {
      store.setItem(THEORY_SAVED_KEY, raw);
      expect(loadSavedTheoryBuilds()).toEqual([]);
    }
  });

  it("drops malformed entries and keeps the good ones", () => {
    const raw = JSON.stringify({
      version: THEORY_STORAGE_VERSION,
      builds: [
        null,
        42,
        { name: "No inputs", classType: 2 },
        { ...build("Bad targets"), builder: snapshot({ targets: [1, 2] }) },
        { ...build("Bad class"), classType: "Warlock" },
        build("   "),
        build("Good"),
        build("good"),
      ],
    });
    expect(parseSavedTheoryBuilds(raw)).toEqual([build("Good")]);
  });

  it("trims names", () => {
    const raw = JSON.stringify({ version: THEORY_STORAGE_VERSION, builds: [build("  Raid ")] });
    expect(parseSavedTheoryBuilds(raw)[0].name).toBe("Raid");
  });

  it("survives storage that throws", () => {
    (globalThis as { localStorage?: Storage }).localStorage = {
      ...memoryStorage(),
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(loadSavedTheoryBuilds()).toEqual([]);
    expect(() => writeSavedTheoryBuilds([build("Raid")])).not.toThrow();
    expect(loadTheoryInputs()).toBeNull();
  });
});

describe("current theoretical inputs", () => {
  it("round-trip through storage", () => {
    saveTheoryInputs({ classType: 1, builder: snapshot() });
    expect(loadTheoryInputs()).toEqual({ classType: 1, builder: snapshot() });
  });

  it("read as none when absent, malformed or another version", () => {
    expect(loadTheoryInputs()).toBeNull();
    store.setItem(THEORY_CURRENT_KEY, "{");
    expect(loadTheoryInputs()).toBeNull();
    store.setItem(
      THEORY_CURRENT_KEY,
      JSON.stringify({ version: 99, classType: 1, builder: snapshot() }),
    );
    expect(loadTheoryInputs()).toBeNull();
    store.setItem(
      THEORY_CURRENT_KEY,
      JSON.stringify({ version: THEORY_STORAGE_VERSION, classType: 1, builder: { targets: 5 } }),
    );
    expect(loadTheoryInputs()).toBeNull();
  });
});

describe("resolveTheoryBuild", () => {
  const options = (over: Partial<TheoryBuildOptions> = {}): TheoryBuildOptions => ({
    exotics: new Set(["Gyrfalcon's Hauberk", "Solipsism"]),
    fragments: new Set([1, 2]),
    sets: new Set([111]),
    spiritPerks: (name) => (name === "Solipsism" ? { left: [10], right: [20] } : null),
    ...over,
  });

  it("loads everything when it all still exists", () => {
    expect(resolveTheoryBuild(snapshot(), options())).toEqual({
      builder: snapshot(),
      skipped: [],
    });
  });

  it("skips a missing exotic and loads the rest", () => {
    const { builder, skipped } = resolveTheoryBuild(
      snapshot(),
      options({ exotics: new Set(["Solipsism"]) }),
    );
    expect(builder).toEqual(snapshot({ exoticName: null }));
    expect(skipped).toEqual(["Gyrfalcon's Hauberk"]);
  });

  it("skips missing fragments, sets and Spirit perks, and says how many", () => {
    const { builder, skipped } = resolveTheoryBuild(
      snapshot({
        exoticName: "Solipsism",
        exoticPerks: [10, 99],
        fragmentHashes: [1, 2, 3, 4],
        setReqs: { 111: 2, 222: 2, 333: 4 },
      }),
      options(),
    );
    expect(builder.exoticPerks).toEqual([10, null]);
    expect(builder.fragmentHashes).toEqual([1, 2]);
    expect(builder.setReqs).toEqual({ 111: 2 });
    expect(skipped).toEqual(["Spirit perks", "2 fragments", "2 set bonuses"]);
  });

  it("drops Spirit perks quietly when the exotic isn't a class item", () => {
    const { builder, skipped } = resolveTheoryBuild(
      snapshot({ exoticPerks: [10, 20] }),
      options(),
    );
    expect(builder.exoticPerks).toEqual([null, null]);
    expect(skipped).toEqual([]);
  });

  it("writes the toast line", () => {
    expect(skippedNote(["Solipsism"])).toBe("Skipped Solipsism: no longer available.");
    expect(skippedNote(["A", "1 fragment", "1 set bonus"])).toBe(
      "Skipped A, 1 fragment and 1 set bonus: no longer available.",
    );
  });
});
