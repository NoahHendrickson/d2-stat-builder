import { describe, expect, it } from "vitest";
import { theoryExotic } from "./theory-input";
import type { Manifest } from "../manifest/load";

const manifest = { def: () => undefined } as unknown as Manifest;
const archetypes = [{ name: "Paragon", primary: 4, secondary: 5 }];

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
