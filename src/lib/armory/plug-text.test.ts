import { expect, test } from "vitest";
import { plugDescription } from "./plug-text";
import type { Manifest } from "@/lib/manifest/load";

const perks: Record<number, object> = {
  1: { displayProperties: { description: "Reduces incoming Arc damage from combatants." } },
  2: { displayProperties: { description: "Reduces incoming Solar damage from combatants." } },
  3: { displayProperties: { description: "Gain periodic bursts of healing." } },
};
const manifest = {
  def: (_t: string, h: number | undefined) => (h == null ? undefined : perks[h]),
} as unknown as Manifest;

test("plugDescription skips hidden perks and keeps the game's tooltip notes", () => {
  // Harmonic Resistance: one hidden perk per element; the note says which one applies.
  const harmonic = {
    displayProperties: { description: "" },
    perks: [
      { perkHash: 1, perkVisibility: 2 },
      { perkHash: 2, perkVisibility: 2 },
    ],
    tooltipNotifications: [{ displayString: "The effects of this mod will match the element of your equipped Super." }],
  };
  expect(plugDescription(harmonic, manifest)).toBe(
    "The effects of this mod will match the element of your equipped Super.",
  );
});

test("plugDescription keeps an item's own restriction alongside its perk text", () => {
  // Enhanced Operator Augment: the item text is the raid-only restriction.
  const raidMod = {
    displayProperties: { description: "This mod's perks are only active in the raid." },
    perks: [{ perkHash: 3, perkVisibility: 1 }],
  };
  expect(plugDescription(raidMod, manifest)).toBe(
    "This mod's perks are only active in the raid.\n\nGain periodic bursts of healing.",
  );
});

test("plugDescription drops repeats and falls back to flavor text", () => {
  expect(
    plugDescription(
      { displayProperties: { description: "Gain periodic bursts of healing." }, perks: [{ perkHash: 3 }] },
      manifest,
    ),
  ).toBe("Gain periodic bursts of healing.");
  expect(plugDescription({ displayProperties: { description: " " }, flavorText: "Flavor", perks: [] }, manifest)).toBe(
    "Flavor",
  );
});
