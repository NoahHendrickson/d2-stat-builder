import { describe, expect, test } from "vitest";
import { availableFragments, buildFragmentStats, formatFragmentStats } from "./fragments";
import type { Manifest } from "@/lib/manifest/load";
import { STAT_HASHES } from "./stats";

const H = STAT_HASHES;

function mockManifest(
  items: Record<
    number,
    {
      name: string;
      description?: string;
      flavorText?: string;
      perkHash?: number;
      category: string;
      investmentStats?: {
        statTypeHash: number;
        value: number;
        isConditionallyActive?: boolean;
      }[];
    }
  >,
  perks: Record<number, { description: string }> = {},
): Manifest {
  const table = Object.fromEntries(
    Object.entries(items).map(([hash, item]) => [
      hash,
      {
        displayProperties: { name: item.name, description: item.description },
        flavorText: item.flavorText,
        perks: item.perkHash != null ? [{ perkHash: item.perkHash }] : [],
        plug: { plugCategoryIdentifier: item.category },
        investmentStats: item.investmentStats,
      },
    ]),
  );
  const perkTable = Object.fromEntries(
    Object.entries(perks).map(([hash, perk]) => [
      hash,
      { displayProperties: { description: perk.description } },
    ]),
  );
  return {
    all: (name: string) =>
      name === "DestinySandboxPerkDefinition" ? perkTable : table,
    def: (name: string, hash?: number | null) => {
      if (hash == null) return undefined;
      if (name === "DestinySandboxPerkDefinition") return perkTable[hash];
      return table[hash];
    },
  } as unknown as Manifest;
}

describe("buildFragmentStats", () => {
  test("Echo of Persistence applies one class-ability penalty", () => {
    const inv = [
      { statTypeHash: H.class, value: -10, isConditionallyActive: true },
      { statTypeHash: H.weapons, value: -10, isConditionallyActive: true },
      { statTypeHash: H.health, value: -10, isConditionallyActive: true },
    ];

    expect(buildFragmentStats(inv, 0).stats).toEqual([0, -10, 0, 0, 0, 0]); // Titan
    expect(buildFragmentStats(inv, 1).stats).toEqual([-10, 0, 0, 0, 0, 0]); // Hunter
    expect(buildFragmentStats(inv, 2).stats).toEqual([0, 0, -10, 0, 0, 0]); // Warlock
  });

  test("Echo of Dilation keeps both stat boosts", () => {
    const inv = [
      { statTypeHash: H.weapons, value: 10, isConditionallyActive: true },
      { statTypeHash: H.super, value: 10, isConditionallyActive: true },
    ];

    expect(buildFragmentStats(inv, 1).stats).toEqual([10, 0, 0, 0, 10, 0]);
  });

  test("single conditional class stat still applies", () => {
    const inv = [
      { statTypeHash: H.class, value: -10, isConditionallyActive: true },
    ];

    expect(buildFragmentStats(inv, 2).stats).toEqual([0, 0, -10, 0, 0, 0]);
  });
});

describe("availableFragments", () => {
  test("resolves class-specific penalties per classType", () => {
    const manifest = mockManifest({
      1: {
        name: "Echo of Persistence",
        category: "shared.void.fragments",
        investmentStats: [
          { statTypeHash: H.class, value: -10, isConditionallyActive: true },
          { statTypeHash: H.weapons, value: -10, isConditionallyActive: true },
          { statTypeHash: H.health, value: -10, isConditionallyActive: true },
        ],
      },
    });

    const warlock = availableFragments(manifest, 2).Void[0];
    expect(warlock.stats).toEqual([0, 0, -10, 0, 0, 0]);
  });

  test("copies the fragment description from the item when there is no perk text", () => {
    const manifest = mockManifest({
      1: {
        name: "Echo of Persistence",
        description: "Increases class ability regeneration at the cost of class.",
        category: "shared.void.fragments",
        investmentStats: [{ statTypeHash: H.class, value: -10 }],
      },
    });

    expect(availableFragments(manifest, 2).Void[0].description).toBe(
      "Increases class ability regeneration at the cost of class.",
    );
  });

  test("prefers sandbox perk description over an empty item description", () => {
    const manifest = mockManifest(
      {
        1: {
          name: "Spark of Beacons",
          description: "",
          perkHash: 99,
          category: "shared.arc.fragments",
          investmentStats: [{ statTypeHash: H.class, value: 10 }],
        },
      },
      { 99: { description: "Your Arc grenades jolt targets." } },
    );

    expect(availableFragments(manifest, 1).Arc[0].description).toBe(
      "Your Arc grenades jolt targets.",
    );
  });
});

describe("formatFragmentStats", () => {
  test("lists signed bonuses and skips zeros", () => {
    expect(formatFragmentStats([10, 0, -10, 0, 0, 0])).toBe(
      "+10 Weapons · −10 Class",
    );
    expect(formatFragmentStats([0, 0, 0, 0, 0, 0])).toBe("");
  });
});
