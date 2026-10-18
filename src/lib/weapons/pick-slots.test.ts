import { describe, expect, it } from "vitest";
import { pickSlots, resolveFrame } from "./pick-slots";
import type { PerkRef, WeaponSummary } from "./types";

const perk = (name: string): PerkRef => ({ hash: name.length, name, currentlyCanRoll: true });
// 0 Adaptive Frame, 1 Aggressive Frame, 2–3 barrels, 4 Range Masterwork, 5 Ballistics.
const PERKS = ["Adaptive Frame", "Aggressive Frame", "Arrowhead Brake", "Smallbore", "Range Masterwork", "Ballistics"].map(
  perk,
);

const weapon = (overrides: Partial<WeaponSummary>) =>
  ({ name: "Test", frame: "Aggressive Frame", columns: [], ...overrides }) as WeaponSummary;

describe("pickSlots", () => {
  it("gives perk columns their column index, and masterworks and mods keys past every column", () => {
    const slots = pickSlots(
      weapon({
        columns: [
          { kind: "Intrinsic", perkIndices: [0] },
          { kind: "Barrel", perkIndices: [2, 3] },
        ],
        masterworks: [4],
        mods: [5],
      }),
    );
    expect(slots.map(({ key, kind, label }) => ({ key, kind, label }))).toEqual([
      { key: 1, kind: "perk", label: "Barrel" },
      { key: 2, kind: "masterwork", label: "Masterworks" },
      { key: 3, kind: "mod", label: "Mods" },
    ]);
  });

  it("keeps a frame column with a choice as a perk slot", () => {
    const slots = pickSlots(weapon({ columns: [{ kind: "Intrinsic", perkIndices: [0, 1] }] }));
    expect(slots).toEqual([{ key: 0, kind: "perk", label: "Intrinsic", perkIndices: [0, 1], craftedOnly: undefined }]);
  });
});

describe("resolveFrame", () => {
  const choice = weapon({ columns: [{ kind: "Intrinsic", perkIndices: [0, 1] }] });

  it("follows the frame picked in the grid", () => {
    expect(resolveFrame(choice, PERKS, { 0: 0 }).perk?.name).toBe("Adaptive Frame");
  });

  it("otherwise shows the frame the weapon is named for, then its first", () => {
    expect(resolveFrame(choice, PERKS).perk?.name).toBe("Aggressive Frame");
    expect(resolveFrame({ ...choice, frame: undefined }, PERKS).perk?.name).toBe("Adaptive Frame");
  });

  it("marks a weapon's only frame as fixed", () => {
    const fixed = weapon({ columns: [{ kind: "Intrinsic", perkIndices: [1] }] });
    expect(resolveFrame(fixed, PERKS)).toEqual({ perk: PERKS[1], fixed: true });
  });

  it("has no frame without an intrinsic column, whatever else is picked", () => {
    const none = weapon({ columns: [{ kind: "Barrel", perkIndices: [2, 3] }], masterworks: [4] });
    expect(resolveFrame(none, PERKS, { 0: 2, 1: 4 })).toEqual({ perk: undefined, fixed: false });
  });
});
