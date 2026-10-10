import { describe, expect, test } from "vitest";
import { loadoutClassType, parseActivitySets } from "./activity-sets";
import { mergeSettingValues, parseSettingValue } from "../settings/keys";
import type { SavedLoadout } from "./types";

const set = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: "Raid",
  characterId: "2305843009300000001",
  classType: 1,
  slots: [{ index: 0, loadoutId: "a" }],
  ...extra,
});

describe("parseActivitySets", () => {
  test("keeps well-formed sets and drops the rest", () => {
    const parsed = parseActivitySets([
      set("1"),
      set("2", { name: "  " }),
      set("3", { characterId: "abc" }),
      set("4", { classType: 3 }),
      set("1", { name: "Duplicate id" }),
      "junk",
    ]);
    expect(parsed.map((s) => s.id)).toEqual(["1"]);
  });

  test("sorts slots, drops bad ones, and keeps the last pick for a repeated slot", () => {
    const [parsed] = parseActivitySets([
      set("1", {
        slots: [
          { index: 3, loadoutId: "c" },
          { index: 0, loadoutId: "a" },
          { index: -1, loadoutId: "x" },
          { index: 40, loadoutId: "x" },
          { index: 1, loadoutId: "" },
          { index: 3, loadoutId: "d" },
        ],
      }),
    ]);
    expect(parsed.slots).toEqual([
      { index: 0, loadoutId: "a" },
      { index: 3, loadoutId: "d" },
    ]);
  });

  test("is wired in as a synced setting", () => {
    expect(parseSettingValue("activitySets", [set("1")])).toHaveLength(1);
    expect(parseSettingValue("activitySets", { a: 1 })).toBeNull();
  });

  test("first-sync merge keeps the account's sets and appends local ones by id", () => {
    const merged = mergeSettingValues(
      "activitySets",
      parseActivitySets([set("local"), set("shared", { name: "Local copy" })]),
      parseActivitySets([set("shared"), set("server")]),
    );
    expect(merged.map((s) => [s.id, s.name])).toEqual([
      ["shared", "Raid"],
      ["server", "Raid"],
      ["local", "Raid"],
    ]);
  });
});

describe("loadoutClassType", () => {
  const saved = (classType: number, ids: string[]) =>
    ({ loadout: { classType, equipped: ids.map((id) => ({ hash: 1, id })) } }) as unknown as SavedLoadout;

  test("a class loadout is its class; an any-class one takes its armor's", () => {
    const pieces = new Map([["p", { classType: 2 }]]);
    expect(loadoutClassType(saved(0, []), pieces)).toBe(0);
    expect(loadoutClassType(saved(3, ["gone", "p"]), pieces)).toBe(2);
    expect(loadoutClassType(saved(3, ["gone"]), pieces)).toBeUndefined();
  });
});
