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
    expect(s.tertiaries).toEqual([5]);
    expect(s.tuned).toBeNull();
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
    expect(s.tuned).toEqual([0]);
    expect(s.setHashes).toEqual([7]);
  });

  it("says any tertiary when none is common, and null when nothing is farmed", () => {
    const s = summarizeTheory([
      recipe([piece("Gunner", 1), piece("Gunner", 2), piece("Gunner", 4), piece("Gunner", 5), piece("Brawler", 0)]),
    ])!;
    expect(s.tertiaries).toEqual([]);
    expect(summarizeTheory([recipe([piece("Gunner", 1, { exotic: true })])])).toBeNull();
  });
});
