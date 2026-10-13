import { describe, expect, it } from "vitest";
import { theoryExotic, theoryOwnedRolls } from "./theory-input";
import { buildTheorySpace } from "./theory/space";
import type { ArmorPiece } from "../armory/normalize";
import { ARMOR_SLOTS } from "../armory/stats";
import type { Manifest } from "../manifest/load";

const manifest = { def: () => undefined } as unknown as Manifest;
const archetypes = [{ name: "Paragon", primary: 4, secondary: 5 }];

describe("theoryOwnedRolls", () => {
  it("keeps tuned legendaries with the exact Tier 5 roll, by archetype name or shape", () => {
    // A Paragon (super / melee) with a weapons tertiary, masterworked.
    const t5 = {
      slot: ARMOR_SLOTS[0],
      baseStats: [20, 0, 0, 0, 30, 25],
      stats: [20, 5, 5, 5, 30, 25],
      tunedStat: 0,
      archetype: "Paragon",
    };
    const pieces = [
      { ...t5, instanceId: "named" },
      { ...t5, instanceId: "shape", archetype: undefined },
      { ...t5, instanceId: "unmasterworked", stats: [20, 0, 5, 5, 30, 25] },
      { ...t5, instanceId: "exotic", isExotic: true },
      { ...t5, instanceId: "untuned", tunedStat: undefined },
    ] as unknown as ArmorPiece[];
    const owned = theoryOwnedRolls(pieces, archetypes);
    expect(owned.map((o) => o.instanceId)).toEqual(["named", "shape"]);
    expect(owned[0]).toMatchObject({ slot: 0, archetype: "Paragon", tertiary: 0, tuned: 0 });
  });
});

describe("theoryExotic", () => {
  it("lets an exotic class item roll anything when its Spirits can't be read", () => {
    const choice = {
      option: { name: "Solipsism", slot: "classItem" as const },
      classItemHash: 1,
      exoticPerks: [null, null] as [null, null],
      pieces: [],
      archetypes,
      manifest,
    };
    // No Spirit catalog at all, and a left Spirit whose archetype doesn't resolve.
    expect(theoryExotic({ ...choice, spiritPerks: null }).exotic?.rolls).toBeNull();
    const unknown = { left: [{ hash: 7, name: "?", column: 1 as const }], right: [] };
    expect(theoryExotic({ ...choice, spiritPerks: unknown }).exotic?.rolls).toBeNull();
  });

  it("holds an exotic class item to its Spirits' rolls when they resolve", () => {
    const spiritPerks = {
      left: [{ hash: 7, name: "L", column: 1 as const, primaryStat: 4, secondaryStat: 5 }],
      right: [],
    };
    const { exotic } = theoryExotic({
      option: { name: "Solipsism", slot: "classItem" },
      classItemHash: 1,
      spiritPerks,
      exoticPerks: [7, null],
      pieces: [],
      archetypes,
      manifest,
    });
    expect(exotic?.slot).toBe(4);
    expect(exotic?.rolls?.map((r) => r.tertiary)).toEqual([0, 1, 2, 3]);
  });
});

describe("theoryExotic, with an owned copy that disagrees with the Spirit catalog", () => {
  it("allows the copy's real roll, so the space can seat it", () => {
    // The right Spirit's catalog tertiary is Grenade (3); the owned Paragon copy with that
    // Spirit pair actually rolled a Health (1) tertiary.
    const spiritPerks = {
      left: [{ hash: 7, name: "L", column: 1 as const, primaryStat: 4, secondaryStat: 5 }],
      right: [{ hash: 8, name: "R", column: 2 as const, preferredTertiary: 3 }],
    };
    const copy = {
      instanceId: "copy",
      itemHash: 1,
      isExotic: true,
      tunedStat: 0,
      exoticPerkHashes: [7, 8],
      baseStats: [0, 20, 0, 0, 30, 25],
      slot: "classItem",
    } as unknown as ArmorPiece;
    const { exotic } = theoryExotic({
      option: { name: "Solipsism", slot: "classItem" },
      classItemHash: 1,
      spiritPerks,
      exoticPerks: [7, 8],
      pieces: [copy],
      archetypes,
      manifest,
    });
    expect(exotic?.rolls).toEqual([{ archetype: "Paragon", tertiary: 1 }]);
    expect(exotic?.owned).toEqual([{ instanceId: "copy", archetype: "Paragon", tertiary: 1 }]);
    const space = buildTheorySpace(archetypes, [], exotic);
    expect([...space.exotic!.owned.values()]).toEqual(["copy"]);
  });
});
