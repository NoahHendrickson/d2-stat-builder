import { test, expect } from "vitest";
import type { Manifest } from "@/lib/manifest/load";
import type { ArmorPiece } from "./normalize";
import { STAT_HASHES, type StatArray } from "./stats";
import {
  EXOTIC_CLASS_ITEM_HASHES,
  RIGHT_SPIRIT_PREFERRED_TERTIARY,
  SYNTHETIC_CLASS_ITEM_ID_PREFIX,
  applySpiritSelectionToClassItems,
  archetypeNameFromSpirit,
  archetypePlugForStats,
  buildSyntheticClassItem,
  matchesSpiritSelection,
  resolveTertiary,
  synthesizeClassItemBaseStats,
  synthesizeClassItemStats,
  syntheticClassItemForSelection,
} from "./exotic-class-perks";

const H = STAT_HASHES;

/** Inmost Light — Paragon: Super 30 / Melee 25 (live manifest). */
const INMOST = 1476923953;
/** Cyrtarachne — preferred tertiary Grenade (verified). */
const CYRTARACHNE = 3751917994;
/** Synthoceps — preferred tertiary Melee (collides with Inmost secondary). */
const SYNTHOCEPS = 1476923956;
const SOLIPSISM = EXOTIC_CLASS_ITEM_HASHES.solipsism;

function mockManifest(
  plugs: Record<
    number,
    {
      investmentStats?: {
        statTypeHash: number;
        value: number;
        isConditionallyActive?: boolean;
      }[];
      displayProperties?: { name?: string; icon?: string };
      classType?: number;
      plug?: { plugCategoryIdentifier?: string };
    }
  >,
): Manifest {
  return {
    def: (_table: string, hash: number | null | undefined) =>
      hash == null ? undefined : plugs[hash],
    all: () => plugs,
  } as unknown as Manifest;
}

function inmostManifest() {
  return mockManifest({
    [INMOST]: {
      investmentStats: [
        { statTypeHash: H.super, value: 30 },
        { statTypeHash: H.melee, value: 25 },
      ],
    },
  });
}

function piece(over: Partial<ArmorPiece> = {}): ArmorPiece {
  const stats = [5, 5, 5, 20, 30, 25] as StatArray;
  return {
    instanceId: "owned-1",
    itemHash: SOLIPSISM,
    name: "Solipsism",
    slot: "classItem",
    classType: 2,
    isExotic: true,
    isArtifice: false,
    isFestivalMask: false,
    baseStats: [0, 0, 0, 20, 30, 25] as StatArray,
    stats,
    exoticPerkHashes: [INMOST, CYRTARACHNE],
    location: "vault",
    ...over,
  };
}

test("resolveTertiary keeps preferred when it doesn't collide", () => {
  // Paragon primary=super(4), secondary=melee(5); Cyrtarachne prefers grenade(3).
  expect(resolveTertiary(3, 4, 5)).toBe(3);
});

test("resolveTertiary remaps when preferred collides with archetype", () => {
  // Preferred melee(5) collides with secondary → first free in STAT_ORDER = weapons(0).
  expect(resolveTertiary(5, 4, 5)).toBe(0);
});

test("synthesizeClassItemBaseStats builds 30/25/20 from left+right Spirits", () => {
  // STAT_ORDER: weapons, health, class, grenade, super, melee
  expect(synthesizeClassItemBaseStats(inmostManifest(), INMOST, CYRTARACHNE)).toEqual([
    0, 0, 0, 20, 30, 25,
  ]);
});

test("synthesizeClassItemStats applies MW5 to the three off-archetype stats", () => {
  // Off-arch: weapons, health, class → 5; grenade tertiary stays 20; super/melee capped.
  expect(synthesizeClassItemStats(inmostManifest(), INMOST, CYRTARACHNE)).toEqual([
    5, 5, 5, 20, 30, 25,
  ]);
});

test("synthesize remaps tertiary when preferred collides (Inmost + Synthoceps)", () => {
  expect(RIGHT_SPIRIT_PREFERRED_TERTIARY[SYNTHOCEPS]).toBe(5); // melee
  // Remap to weapons(0) → base [20, 0, 0, 0, 30, 25]
  expect(synthesizeClassItemBaseStats(inmostManifest(), INMOST, SYNTHOCEPS)).toEqual([
    20, 0, 0, 0, 30, 25,
  ]);
});

test("synthesize returns null when left Spirit has no archetype stats", () => {
  const manifest = mockManifest({ [INMOST]: { investmentStats: [] } });
  expect(synthesizeClassItemBaseStats(manifest, INMOST, CYRTARACHNE)).toBeNull();
});

test("archetypePlugForStats resolves Paragon for Super/Melee", () => {
  const PARAGON = 4227065942;
  const manifest = mockManifest({
    [PARAGON]: {
      plug: { plugCategoryIdentifier: "armor_archetypes" },
      displayProperties: {
        name: "Paragon",
        icon: "/common/destiny2_content/icons/paragon.png",
      },
    },
  });
  // STAT_ORDER: weapons=0 health=1 class=2 grenade=3 super=4 melee=5
  expect(archetypePlugForStats(manifest, 4, 5)).toEqual({
    name: "Paragon",
    icon: "/common/destiny2_content/icons/paragon.png",
  });
});

test("archetypeNameFromSpirit derives Paragon from Inmost Light investmentStats", () => {
  const PARAGON = 4227065942;
  const manifest = mockManifest({
    [INMOST]: {
      investmentStats: [
        { statTypeHash: H.super, value: 30 },
        { statTypeHash: H.melee, value: 25 },
      ],
    },
    [PARAGON]: {
      plug: { plugCategoryIdentifier: "armor_archetypes" },
      displayProperties: { name: "Paragon" },
    },
  });
  expect(archetypeNameFromSpirit(manifest, INMOST)).toBe("Paragon");
  expect(archetypeNameFromSpirit(manifest, CYRTARACHNE)).toBeUndefined();
});

test("matchesSpiritSelection treats null as Any", () => {
  expect(matchesSpiritSelection([INMOST, CYRTARACHNE], [null, null])).toBe(true);
  expect(matchesSpiritSelection([INMOST, CYRTARACHNE], [INMOST, null])).toBe(true);
  expect(matchesSpiritSelection([INMOST, CYRTARACHNE], [null, CYRTARACHNE])).toBe(
    true,
  );
  expect(matchesSpiritSelection([INMOST, CYRTARACHNE], [INMOST, SYNTHOCEPS])).toBe(
    false,
  );
  expect(matchesSpiritSelection(undefined, [INMOST, null])).toBe(false);
});

test("exotic class item hashes cover all three classes", () => {
  expect(Object.keys(EXOTIC_CLASS_ITEM_HASHES)).toHaveLength(3);
});

test("buildSyntheticClassItem returns a T5 theoretical piece with stable id", () => {
  const synth = buildSyntheticClassItem(inmostManifest(), {
    itemHash: SOLIPSISM,
    left: INMOST,
    right: CYRTARACHNE,
    name: "Solipsism",
    icon: "/icon.png",
    classType: 2,
  });
  expect(synth).toMatchObject({
    instanceId: `${SYNTHETIC_CLASS_ITEM_ID_PREFIX}${SOLIPSISM}:${INMOST}:${CYRTARACHNE}`,
    itemHash: SOLIPSISM,
    name: "Solipsism",
    icon: "/icon.png",
    slot: "classItem",
    classType: 2,
    isExotic: true,
    isArtifice: false,
    tunedStat: 0,
    exoticPerkHashes: [INMOST, CYRTARACHNE],
    location: "vault",
    stats: [5, 5, 5, 20, 30, 25],
  });
});

test("applySpiritSelectionToClassItems is a no-op when both columns are Any", () => {
  const legendary = piece({
    instanceId: "leg",
    isExotic: false,
    itemHash: 1,
    exoticPerkHashes: undefined,
  });
  const owned = piece();
  const pool = [legendary, owned];
  expect(
    applySpiritSelectionToClassItems(pool, inmostManifest(), {
      selectedClassItemHash: SOLIPSISM,
      exoticPerks: [null, null],
      name: "Solipsism",
      classType: 2,
    }),
  ).toBe(pool);
});

test("applySpiritSelectionToClassItems keeps matching owned rolls and legendaries", () => {
  const legendary = piece({
    instanceId: "leg",
    isExotic: false,
    itemHash: 1,
    exoticPerkHashes: undefined,
  });
  const match = piece({ instanceId: "match" });
  const other = piece({
    instanceId: "other",
    exoticPerkHashes: [INMOST, SYNTHOCEPS],
  });
  const result = applySpiritSelectionToClassItems(
    [legendary, match, other],
    inmostManifest(),
    {
      selectedClassItemHash: SOLIPSISM,
      exoticPerks: [INMOST, CYRTARACHNE],
      name: "Solipsism",
      classType: 2,
    },
  );
  expect(result.map((p) => p.instanceId)).toEqual(["leg", "match"]);
});

test("applySpiritSelectionToClassItems injects a synthetic when no owned match", () => {
  const legendary = piece({
    instanceId: "leg",
    isExotic: false,
    itemHash: 1,
    exoticPerkHashes: undefined,
  });
  const other = piece({
    instanceId: "other",
    exoticPerkHashes: [INMOST, SYNTHOCEPS],
  });
  const result = applySpiritSelectionToClassItems(
    [legendary, other],
    inmostManifest(),
    {
      selectedClassItemHash: SOLIPSISM,
      exoticPerks: [INMOST, CYRTARACHNE],
      name: "Solipsism",
      classType: 2,
    },
  );
  expect(result).toHaveLength(2);
  expect(result[0].instanceId).toBe("leg");
  expect(result[1].instanceId).toBe(
    `${SYNTHETIC_CLASS_ITEM_ID_PREFIX}${SOLIPSISM}:${INMOST}:${CYRTARACHNE}`,
  );
});

test("applySpiritSelectionToClassItems filters without synthesizing on partial Any", () => {
  const match = piece({ instanceId: "match" });
  const other = piece({
    instanceId: "other",
    exoticPerkHashes: [SYNTHOCEPS, CYRTARACHNE],
  });
  const result = applySpiritSelectionToClassItems(
    [match, other],
    inmostManifest(),
    {
      selectedClassItemHash: SOLIPSISM,
      exoticPerks: [INMOST, null],
      name: "Solipsism",
      classType: 2,
    },
  );
  expect(result.map((p) => p.instanceId)).toEqual(["match"]);
});

test("syntheticClassItemForSelection returns null when an owned match exists", () => {
  expect(
    syntheticClassItemForSelection([piece()], inmostManifest(), {
      selectedClassItemHash: SOLIPSISM,
      exoticPerks: [INMOST, CYRTARACHNE],
      name: "Solipsism",
      classType: 2,
    }),
  ).toBeNull();
});

test("syntheticClassItemForSelection builds a piece for an unowned concrete pair", () => {
  const synth = syntheticClassItemForSelection([], inmostManifest(), {
    selectedClassItemHash: SOLIPSISM,
    exoticPerks: [INMOST, CYRTARACHNE],
    name: "Solipsism",
    classType: 2,
  });
  expect(synth?.instanceId).toBe(
    `${SYNTHETIC_CLASS_ITEM_ID_PREFIX}${SOLIPSISM}:${INMOST}:${CYRTARACHNE}`,
  );
});
