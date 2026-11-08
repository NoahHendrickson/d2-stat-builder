import { describe, expect, it } from "vitest";
import { summarizeTheory } from "./theory-summary";
import type { TheoryPiece, TheoryRecipe } from "../optimizer/theory";

const ARCH = {
  Gunner: { primary: 0, secondary: 3 },
  Powerhouse: { primary: 0, secondary: 4 },
  Brawler: { primary: 5, secondary: 1 },
} as const;

function piece(
  archetype: keyof typeof ARCH,
  tertiary: number,
  extra: Partial<TheoryPiece> = {},
): TheoryPiece {
  return { archetype, ...ARCH[archetype], tertiary, slot: 0, tuning: null, ...extra };
}
const recipe = (pieces: TheoryPiece[]) => ({ pieces }) as TheoryRecipe;

describe("summarizeTheory", () => {
  it("names the common archetypes and tertiary, most common first", () => {
    const s = summarizeTheory([
      recipe([piece("Gunner", 5), piece("Gunner", 5), piece("Powerhouse", 5), piece("Gunner", 5), piece("Brawler", 0)]),
      recipe([piece("Powerhouse", 5), piece("Gunner", 5), piece("Powerhouse", 5), piece("Gunner", 5), piece("Gunner", 2)]),
    ])!;
    expect(s.archetypes.map((a) => a.name)).toEqual(["Gunner", "Powerhouse"]);
    expect(s.archetypes[0].share).toBeCloseTo(0.6);
    expect(s.archetypes[0].tertiaries).toEqual([5]);
    expect(s.archetypes[0].tuned).toEqual([]);
    expect(s.builds).toBe(2);
  });

  it("leaves out owned pieces and the exotic, and mentions tuning only when common", () => {
    const tune = { tuning: { plus: 0, minus: 1 } };
    const s = summarizeTheory([
      recipe([
        piece("Brawler", 0, { owned: { instanceId: "x" } }),
        piece("Brawler", 0, { exotic: true }),
        piece("Gunner", 5, tune),
        piece("Gunner", 5, tune),
        piece("Powerhouse", 5, { setHash: 7 }),
      ]),
    ])!;
    expect(s.archetypes.map((a) => a.name)).toEqual(["Gunner", "Powerhouse"]);
    expect(s.archetypes[0].share).toBeCloseTo(2 / 3);
    expect(s.archetypes[0].tuned).toEqual([0]);
    expect(s.archetypes[1].tuned).toEqual([]);
    expect(s.setHashes).toEqual([7]);
  });

  it("gives each archetype its own tertiary and tuning", () => {
    const s = summarizeTheory([
      recipe([
        piece("Gunner", 5, { tuning: { plus: 1, minus: 2 } }),
        piece("Gunner", 5, { tuning: { plus: 1, minus: 2 } }),
        piece("Powerhouse", 2, { tuning: { plus: 3, minus: 1 } }),
        piece("Powerhouse", 2, { tuning: { plus: 3, minus: 1 } }),
      ]),
    ])!;
    expect(s.archetypes.map((a) => [a.name, a.tertiaries, a.tuned])).toEqual([
      ["Gunner", [5], [1]],
      ["Powerhouse", [2], [3]],
    ]);
  });

  describe("slots", () => {
    const owned = { owned: { instanceId: "x" } };
    const helmet = piece("Brawler", 0, { slot: 0, ...owned });

    it("names the slots left once a legendary is owned, in slot order", () => {
      const s = summarizeTheory([
        recipe([
          helmet,
          piece("Brawler", 0, { slot: 2, ...owned }),
          piece("Gunner", 5, { slot: 3 }),
          piece("Gunner", 5, { slot: 1 }),
          piece("Powerhouse", 5, { slot: 4 }),
        ]),
      ])!;
      expect(s.slots).toEqual([1, 3, 4]);
    });

    it("names all four when one legendary is owned", () => {
      const s = summarizeTheory([
        recipe([helmet, ...[1, 2, 3, 4].map((slot) => piece("Gunner", 5, { slot }))]),
      ])!;
      expect(s.slots).toEqual([1, 2, 3, 4]);
    });

    it("leaves out the unowned exotic's slot", () => {
      const s = summarizeTheory([
        recipe([helmet, piece("Gunner", 5, { slot: 1 }), piece("Brawler", 0, { slot: 3, exotic: true })]),
      ])!;
      expect(s.slots).toEqual([1]);
    });

    it("names none with nothing owned, or only the exotic", () => {
      expect(summarizeTheory([recipe([piece("Gunner", 5, { slot: 1 })])])!.slots).toEqual([]);
      const exotic = summarizeTheory([
        recipe([piece("Brawler", 0, { slot: 0, exotic: true, ...owned }), piece("Gunner", 5, { slot: 1 })]),
      ])!;
      expect(exotic.slots).toEqual([]);
    });

    it("names none when few of the builds use an owned legendary", () => {
      const unbound = Array.from({ length: 7 }, () => recipe([piece("Gunner", 5, { slot: 2 })]));
      const s = summarizeTheory([recipe([helmet, piece("Gunner", 5, { slot: 1 })]), ...unbound])!;
      expect(s.slots).toEqual([]);
    });

    it("names only the slots most of those builds farm", () => {
      const s = summarizeTheory(
        [2, 3, 4].map((other) =>
          recipe([helmet, piece("Gunner", 5, { slot: 1 }), piece("Gunner", 5, { slot: other })]),
        ),
      )!;
      expect(s.slots).toEqual([1]);
    });

    it("names none when every slot qualifies", () => {
      const s = summarizeTheory(
        [0, 1, 2, 3, 4].map((ownedSlot) =>
          recipe([
            piece("Brawler", 0, { slot: ownedSlot, ...owned }),
            ...[0, 1, 2, 3, 4]
              .filter((slot) => slot !== ownedSlot)
              .map((slot) => piece("Gunner", 5, { slot })),
          ]),
        ),
      )!;
      expect(s.slots).toEqual([]);
    });
  });

  it("doesn't pick between tertiaries tied at the cap", () => {
    const s = summarizeTheory([recipe([piece("Gunner", 1), piece("Gunner", 2), piece("Gunner", 4)])])!;
    expect(s.archetypes[0].tertiaries).toEqual([]);
  });

  it("says any tertiary when an archetype's are evenly spread, and null when nothing is farmed", () => {
    const s = summarizeTheory([
      recipe([piece("Gunner", 1), piece("Gunner", 2), piece("Gunner", 4), piece("Gunner", 5), piece("Brawler", 0)]),
    ])!;
    expect(s.archetypes[0].tertiaries).toEqual([]);
    expect(summarizeTheory([recipe([piece("Gunner", 1, { exotic: true })])])).toBeNull();
  });
});
