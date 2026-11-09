import { describe, expect, test } from "vitest";
import {
  activitySetsForCharacter,
  loadoutClassType,
  orphanedSetLoadouts,
  MAX_ACTIVITY_SETS,
  parseActivitySets,
  sameActivitySet,
  withSlotAssignment,
  withSlotLabels,
  type ActivitySet,
} from "./activity-sets";
import { MAX_SETTING_BODY_LENGTH, mergeSettingValues, parseSettingValue } from "../settings/keys";
import type { SavedLoadout } from "./types";

const set = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: "Raid",
  characterId: "2305843009300000001",
  classType: 1,
  slots: [{ index: 0, loadoutId: "a" }],
  ...extra,
});

describe("withSlotAssignment", () => {
  const base = set("1", {
    slots: [
      { index: 1, loadoutId: "a" },
      { index: 4, loadoutId: "b" },
    ],
  }) as ActivitySet;

  test("adds a slot in slot order", () => {
    expect(withSlotAssignment(base, 2, "c").slots.map((s) => s.index)).toEqual([1, 2, 4]);
  });

  test("replaces a slot's loadout", () => {
    expect(withSlotAssignment(base, 4, "c").slots).toEqual([
      { index: 1, loadoutId: "a" },
      { index: 4, loadoutId: "c" },
    ]);
  });

  test("clears a slot and leaves the others", () => {
    expect(withSlotAssignment(base, 1, undefined).slots).toEqual([{ index: 4, loadoutId: "b" }]);
  });
});

describe("activitySetsForCharacter", () => {
  const mine = set("mine", { characterId: "1" }) as ActivitySet;
  const other = set("other", { characterId: "2" }) as ActivitySet;
  const orphan = set("orphan", { characterId: "9" }) as ActivitySet;

  test("lists the character's sets and any whose character is gone", () => {
    const shown = activitySetsForCharacter([mine, other, orphan], "1", ["1", "2"]);
    expect(shown.map((s) => s.id)).toEqual(["mine", "orphan"]);
  });
});

describe("sameActivitySet", () => {
  const base = set("1") as ActivitySet;

  test("ignores spaces around the name", () => {
    expect(sameActivitySet({ ...base, name: " Raid " }, base)).toBe(true);
  });

  test("notices a new name or a changed slot", () => {
    expect(sameActivitySet({ ...base, name: "Trials" }, base)).toBe(false);
    expect(sameActivitySet(withSlotAssignment(base, 0, "b"), base)).toBe(false);
    expect(sameActivitySet(withSlotAssignment(base, 3, "b"), base)).toBe(false);
  });
});

describe("slot labels", () => {
  const labels = { nameHash: 1, iconHash: 2, colorHash: 3 };
  const base = set("1", { slots: [{ index: 1, loadoutId: "a" }] }) as ActivitySet;
  const labelled = withSlotLabels(base, 1, labels);

  test("are set on the one slot", () => {
    expect(labelled.slots).toEqual([{ index: 1, loadoutId: "a", labels }]);
    expect(withSlotLabels(base, 9, labels).slots).toEqual(base.slots);
  });

  test("count as an unsaved change", () => {
    expect(sameActivitySet(labelled, base)).toBe(false);
    expect(sameActivitySet(withSlotLabels(labelled, 1, { ...labels, iconHash: 9 }), labelled)).toBe(false);
    expect(sameActivitySet(withSlotLabels(base, 1, labels), labelled)).toBe(true);
  });

  test("stay when the slot's loadout is swapped and go when it's removed", () => {
    expect(withSlotAssignment(labelled, 1, "b").slots).toEqual([{ index: 1, loadoutId: "b", labels }]);
    expect(withSlotAssignment(labelled, 1, undefined).slots).toEqual([]);
  });

  test("survive parsing, and malformed ones are dropped without losing the slot", () => {
    const parse = (l: unknown) =>
      parseActivitySets([{ ...base, slots: [{ index: 1, loadoutId: "a", labels: l }] }])[0].slots;
    expect(parse(labels)).toEqual([{ index: 1, loadoutId: "a", labels }]);
    expect(parse({ ...labels, iconHash: -1 })).toEqual([{ index: 1, loadoutId: "a" }]);
    expect(parse("nope")).toEqual([{ index: 1, loadoutId: "a" }]);
  });
});

test("a full list of full sets fits under the settings limit", () => {
  const labels = { nameHash: 0xffffffff, iconHash: 0xffffffff, colorHash: 0xffffffff };
  const slots = Array.from({ length: 32 }, (_, index) => ({ index, loadoutId: "x".repeat(36), labels }));
  const sets = Array.from({ length: MAX_ACTIVITY_SETS }, (_, i) =>
    set(String(i), { name: "n".repeat(60), characterId: "1".repeat(20), slots }),
  );
  expect(JSON.stringify({ value: sets }).length).toBeLessThan(MAX_SETTING_BODY_LENGTH);
});

describe("orphanedSetLoadouts", () => {
  const withSlots = (id: string, ...loadoutIds: string[]) =>
    set(id, { slots: loadoutIds.map((loadoutId, index) => ({ index, loadoutId })) }) as ActivitySet;
  const loadouts = [{ id: "copy", setOnly: true as const }, { id: "shared", setOnly: true as const }, { id: "mine" }];

  test("returns a set-only loadout no set uses any more", () => {
    expect(orphanedSetLoadouts([withSlots("1", "copy")], [withSlots("1")], loadouts)).toEqual(["copy"]);
  });

  test("keeps one another set still uses", () => {
    const before = [withSlots("1", "shared"), withSlots("2", "shared")];
    expect(orphanedSetLoadouts(before, [withSlots("2", "shared")], loadouts)).toEqual([]);
  });

  test("never returns the player's own loadouts", () => {
    expect(orphanedSetLoadouts([withSlots("1", "mine")], [], loadouts)).toEqual([]);
  });
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
