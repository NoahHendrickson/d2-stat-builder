import { describe, expect, test } from "vitest";

import { sampleWeapons } from "./fixtures/sample-weapons";
import {
  buildPerkMapFromCatalog,
  internWeaponCatalog,
  normalizeWeaponIndex,
} from "./intern-weapons";
import type { PerkRef, WeaponDoc } from "./types";
import {
  collectColumnPerks,
  collectComboPartners,
  collectFacets,
  collectPerks,
  filterWeaponNames,
  filterWeapons,
  rankWeaponResults,
  sortWeapons,
  sortFilteredWeaponNames,
  weaponsMatchingTextQuery,
  createWeaponSearcher,
} from "./search";

const { index: sampleIndex } = internWeaponCatalog(sampleWeapons, "sample");
const sampleSummaries = sampleIndex.weapons;
const samplePerks = sampleIndex.perks;

const names = (ws: { name: string }[]) => ws.map((w) => w.name).sort();
const orderedNames = (ws: { name: string }[]) => ws.map((w) => w.name);

/** Mirrors an on-disk index: `perksLower` is a lowercased duplicate of `perks`, rebuilt at load. */
const stripPerksLowerReplacer = (key: string, value: unknown): unknown =>
  key === "perksLower" ? undefined : value;

describe("on-disk perksLower round-trip", () => {
  // Serialized indexes omit `perksLower`; normalizeWeaponIndex must re-derive it so
  // search functions keep working.
  const onDisk = JSON.parse(
    JSON.stringify(sampleIndex, stripPerksLowerReplacer),
  ) as typeof sampleIndex;

  test("serialized index omits perksLower", () => {
    expect(onDisk.weapons.every((w) => !("perksLower" in w))).toBe(true);
  });

  test("normalizeWeaponIndex re-derives perksLower from perks", () => {
    const { weapons } = normalizeWeaponIndex(onDisk);
    for (const w of weapons) {
      expect(w.perksLower).toEqual(w.perks.map((p) => p.toLowerCase()));
    }
  });

  test("required-perk filtering still works after the round-trip", () => {
    const { weapons, perks } = normalizeWeaponIndex(onDisk);
    const sample = sampleSummaries.find((w) => w.perks.length > 0)!;
    const perkName = sample.perks[0]!;
    const result = filterWeapons(weapons, { perks: [perkName] }, perks);
    expect(result.map((w) => w.hash)).toContain(sample.hash);
  });

  test("normalizeWeaponIndex re-derives perksLower on the no-legacy fallback path", () => {
    // Interned (non-legacy) summaries with perksLower stripped AND no perks catalog /
    // weaponsByPerkName drives normalizeWeaponIndex's `legacy.length === 0` fallback,
    // which must still honor the WeaponSummary contract by re-deriving perksLower.
    const stripped = JSON.parse(
      JSON.stringify(sampleIndex, stripPerksLowerReplacer),
    ) as typeof sampleIndex;
    const normalized = normalizeWeaponIndex({
      version: stripped.version,
      generatedAt: stripped.generatedAt,
      weapons: stripped.weapons,
    });
    // perks: [] confirms we took the fallback branch, not the interned fast path.
    expect(normalized.perks).toEqual([]);
    expect(normalized.weapons).toHaveLength(sampleSummaries.length);
    for (const w of normalized.weapons) {
      expect(w.perksLower).toEqual(w.perks.map((p) => p.toLowerCase()));
    }
  });
});

describe("filterWeapons", () => {
  test("element + type facets (all solar fusion rifles)", () => {
    const result = filterWeapons(
      sampleSummaries,
      { element: ["Solar"], type: ["Fusion Rifle"] },
      samplePerks,
    );
    expect(names(result)).toEqual(["Sunlit Fusion"]);
  });

  test("single element facet (all solar weapons)", () => {
    const result = filterWeapons(sampleSummaries, { element: ["Solar"] }, samplePerks);
    expect(names(result)).toEqual(["Sunlit Fusion", "Sunshot Scout"]);
  });

  test("ammo generation is strictly above the bound; weapons without the stat drop out", () => {
    const summaries = sampleSummaries.map((weapon) => {
      if (weapon.name === "Fatebringer") return { ...weapon, ammoGeneration: 50 };
      if (weapon.name === "Stormcharge") return { ...weapon, ammoGeneration: 72 };
      if (weapon.name === "Sunshot Scout") return { ...weapon, ammoGeneration: 49 };
      return weapon;
    });
    expect(names(filterWeapons(summaries, { ammoGenAbove: 49 }, samplePerks)).sort()).toEqual([
      "Fatebringer",
      "Stormcharge",
    ]);
    expect(names(filterWeapons(summaries, { ammoGenAbove: 50 }, samplePerks))).toEqual([
      "Stormcharge",
    ]);
  });

  test("requires all selected perks (AND semantics)", () => {
    const result = filterWeapons(
      sampleSummaries,
      { perks: ["Firefly", "Explosive Payload"] },
      samplePerks,
    );
    expect(names(result)).toEqual(["Fatebringer", "Sunshot Scout"]);
  });

  test("combines a facet with a perk", () => {
    const result = filterWeapons(
      sampleSummaries,
      { type: ["Fusion Rifle"], perks: ["Surrounded"] },
      samplePerks,
    );
    expect(names(result)).toEqual(["Sunlit Fusion"]);
  });

  test("craftable yes (only weapons with a shaping pattern)", () => {
    expect(names(filterWeapons(sampleSummaries, { craftable: ["Yes"] }, samplePerks))).toEqual([
      "Fatebringer",
      "Stormcharge",
    ]);
  });

  test("craftable no", () => {
    expect(names(filterWeapons(sampleSummaries, { craftable: ["No"] }, samplePerks))).toEqual([
      "Sunlit Fusion",
      "Sunshot Scout",
    ]);
  });

  test("source facet matches activity fragments", () => {
    expect(
      names(filterWeapons(sampleSummaries, { source: ["Root of Nightmares"] }, samplePerks)),
    ).toEqual(["Stormcharge"]);
    expect(names(filterWeapons(sampleSummaries, { source: ["nightmares"] }, samplePerks))).toEqual([
      "Stormcharge",
    ]);
    expect(names(filterWeapons(sampleSummaries, { source: ["vault"] }, samplePerks))).toEqual([
      "Fatebringer",
    ]);
  });

  test("source facet matches secondary activity sources", () => {
    const dreamingCityWeapon = {
      ...sampleSummaries[0]!,
      name: "Retold Tale",
      source: "Dreaming City",
      sources: ["Dreaming City", "The Shattered Throne"],
    };

    expect(
      names(filterWeapons([dreamingCityWeapon], { source: ["shattered"] }, samplePerks)),
    ).toEqual(["Retold Tale"]);
  });

  test("season facet supports season labels and season numbers", () => {
    expect(
      names(filterWeapons(sampleSummaries, { season: ["Season of the Wish"] }, samplePerks)),
    ).toEqual(["Stormcharge"]);
    expect(names(filterWeapons(sampleSummaries, { season: ["23"] }, samplePerks))).toEqual([
      "Stormcharge",
    ]);
  });

  test("custom perk groups match any listed perk in the group", () => {
    const result = filterWeapons(
      sampleSummaries,
      { customPerkGroups: [["Firefly", "Chill Clip"]] },
      samplePerks,
    );
    expect(names(result)).toEqual(["Fatebringer", "Stormcharge", "Sunshot Scout"]);
  });

  test("multiple custom perk groups require one match from each group", () => {
    const result = filterWeapons(
      sampleSummaries,
      {
        customPerkGroups: [
          ["Firefly", "Chill Clip"],
          ["Explosive Payload", "Frenzy"],
        ],
      },
      samplePerks,
    );
    expect(names(result)).toEqual(["Fatebringer", "Sunshot Scout"]);
  });

  test("custom perk groups combine with facets", () => {
    const result = filterWeapons(
      sampleSummaries,
      { element: ["Solar"], customPerkGroups: [["Firefly", "Chill Clip"]] },
      samplePerks,
    );
    expect(names(result)).toEqual(["Sunshot Scout"]);
  });

  test("perk combo matches two perks in separate trait columns regardless of order", () => {
    expect(
      names(filterWeapons(sampleSummaries, { perkCombo: ["Surrounded", "Frenzy"] }, samplePerks)),
    ).toEqual(["Fatebringer"]);
    expect(
      names(filterWeapons(sampleSummaries, { perkCombo: ["Frenzy", "Surrounded"] }, samplePerks)),
    ).toEqual(["Fatebringer"]);
  });

  test("perk combo rejects perks that only coexist in the same trait column", () => {
    expect(
      filterWeapons(sampleSummaries, { perkCombo: ["Firefly", "Explosive Payload"] }, samplePerks),
    ).toEqual([]);
  });

  test("single selected combo perk matches either trait column", () => {
    expect(
      names(filterWeapons(sampleSummaries, { perkCombo: ["Surrounded"] }, samplePerks)),
    ).toEqual(["Fatebringer", "Sunlit Fusion"]);
  });

  test("perk combo composes with other facets", () => {
    expect(
      names(
        filterWeapons(
          sampleSummaries,
          { element: ["Arc"], perkCombo: ["Surrounded", "Frenzy"] },
          samplePerks,
        ),
      ),
    ).toEqual(["Fatebringer"]);
    expect(
      filterWeapons(
        sampleSummaries,
        { type: ["Fusion Rifle"], perkCombo: ["Surrounded", "Frenzy"] },
        samplePerks,
      ),
    ).toEqual([]);
  });
});

describe("weaponsByPerkName", () => {
  test("precomputed map on interned index matches runtime lookup", () => {
    expect(
      names(
        (sampleIndex.weaponsByPerkName.surrounded ?? [])
          .map((hash) => sampleSummaries.find((w) => w.hash === hash))
          .filter((w): w is (typeof sampleSummaries)[number] => w != null),
      ),
    ).toEqual(["Fatebringer", "Sunlit Fusion"]);
  });
});

describe("facets + perks", () => {
  test("collectFacets counts elements", () => {
    const byValue = Object.fromEntries(
      collectFacets(sampleSummaries).element!.map((f) => [f.value, f.count]),
    );
    expect(byValue).toEqual({ Arc: 2, Solar: 2 });
  });

  test("collectFacets counts sources and seasons", () => {
    const facets = collectFacets(sampleSummaries);
    const sources = Object.fromEntries(facets.source!.map((f) => [f.value, f.count]));
    const seasons = Object.fromEntries(facets.season!.map((f) => [f.value, f.count]));
    expect(sources).toMatchObject({ "Root of Nightmares": 1, "Vault of Glass": 1 });
    expect(seasons).toMatchObject({ "Season of the Splicer": 1, "Season of the Wish": 1 });
  });

  test("collectPerks counts weapons per perk", () => {
    const firefly = collectPerks(sampleSummaries, samplePerks).find((p) => p.name === "Firefly");
    expect(firefly?.count).toBe(2);
  });
});

describe("position-aware trait, slot + origin filters", () => {
  test("trait2 matches only weapons whose SECOND trait column can roll it", () => {
    expect(names(filterWeapons(sampleSummaries, { trait2: ["Frenzy"] }, samplePerks))).toEqual([
      "Fatebringer",
    ]);
  });

  test("trait1 does not match a perk that only appears in trait2", () => {
    expect(filterWeapons(sampleSummaries, { trait1: ["Frenzy"] }, samplePerks)).toEqual([]);
  });

  test("trait1 matches across weapons (Surrounded in the first trait column)", () => {
    expect(names(filterWeapons(sampleSummaries, { trait1: ["Surrounded"] }, samplePerks))).toEqual([
      "Fatebringer",
      "Sunlit Fusion",
    ]);
  });

  test("generic trait matches either trait column", () => {
    expect(names(filterWeapons(sampleSummaries, { trait: ["Frenzy"] }, samplePerks))).toEqual([
      "Fatebringer",
    ]);
    expect(
      names(filterWeapons(sampleSummaries, { trait: ["Reservoir Burst"] }, samplePerks)),
    ).toEqual(["Sunlit Fusion"]);
  });

  test("generic trait requires every selected trait perk", () => {
    expect(
      names(filterWeapons(sampleSummaries, { trait: ["Surrounded", "Frenzy"] }, samplePerks)),
    ).toEqual(["Fatebringer"]);
  });

  test("a single-trait weapon never matches a trait2 filter", () => {
    expect(filterWeapons(sampleSummaries, { trait2: ["Reservoir Burst"] }, samplePerks)).toEqual(
      [],
    );
  });

  test("slot facet (all energy weapons)", () => {
    expect(names(filterWeapons(sampleSummaries, { slot: ["Energy"] }, samplePerks))).toEqual([
      "Stormcharge",
      "Sunlit Fusion",
    ]);
  });

  test("origin trait", () => {
    expect(
      names(filterWeapons(sampleSummaries, { originTrait: ["Vault of Glass"] }, samplePerks)),
    ).toEqual(["Fatebringer"]);
  });

  test("exact weapon name", () => {
    expect(names(filterWeapons(sampleSummaries, { name: ["Fatebringer"] }, samplePerks))).toEqual([
      "Fatebringer",
    ]);
  });

  test("name filter AND-composes with trait filters", () => {
    expect(
      names(
        filterWeapons(sampleSummaries, { name: ["Fatebringer"], trait2: ["Frenzy"] }, samplePerks),
      ),
    ).toEqual(["Fatebringer"]);
    expect(
      filterWeapons(
        sampleSummaries,
        { name: ["Fatebringer"], trait2: ["Surrounded"] },
        samplePerks,
      ),
    ).toEqual([]);
  });
});

describe("barrel / mag and champion filters", () => {
  test("gear matches barrel, magazine, and other non-trait columns", () => {
    expect(names(filterWeapons(sampleSummaries, { gear: ["Accurized Rounds"] }, samplePerks))).toEqual([
      "Fatebringer",
    ]);
    expect(names(filterWeapons(sampleSummaries, { gear: ["ionized battery"] }, samplePerks))).toEqual([
      "Sunlit Fusion",
    ]);
  });

  test("gear requires every selected perk and ignores trait columns", () => {
    expect(
      names(
        filterWeapons(sampleSummaries, { gear: ["Fluted Barrel", "Accurized Rounds"] }, samplePerks),
      ),
    ).toEqual(["Fatebringer"]);
    expect(
      filterWeapons(sampleSummaries, { gear: ["Fluted Barrel", "Ionized Battery"] }, samplePerks),
    ).toEqual([]);
    expect(filterWeapons(sampleSummaries, { gear: ["Surrounded"] }, samplePerks)).toEqual([]);
  });

  test("champion matches any selected champion", () => {
    const weapons = sampleSummaries.map((w) =>
      w.name === "Stormcharge" ? { ...w, champions: ["Overload"] } : w,
    );
    expect(names(filterWeapons(weapons, { champion: ["overload"] }, samplePerks))).toEqual([
      "Stormcharge",
    ]);
    expect(filterWeapons(weapons, { champion: ["Barrier"] }, samplePerks)).toEqual([]);
    expect(collectFacets(weapons).champion).toEqual([{ value: "Overload", count: 1 }]);
  });

  test("gear facet lists gear perks only", () => {
    const gear = collectColumnPerks(sampleSummaries, samplePerks).gear.map((p) => p.name);
    expect(gear).toContain("Fluted Barrel");
    expect(gear).toContain("Ionized Battery");
    expect(gear).not.toContain("Surrounded");
    expect(gear).not.toContain("Adaptive Frame");
  });
});

describe("damage perk trait filters", () => {
  const dp = (hash: number, name: string, description: string): PerkRef => ({
    hash,
    name,
    currentlyCanRoll: true,
    description,
  });
  // 0: damage perk, 1: not, 2: damage perk
  const damageCatalog: PerkRef[] = [
    dp(
      1,
      "Frenzy",
      "Being in combat for an extended time increases damage, handling, and reload speed.",
    ),
    dp(2, "Outlaw", "Precision kills greatly decrease reload time."),
    dp(
      3,
      "Bait and Switch",
      "Deal damage with all equipped weapons within a short time to give this weapon a damage boost.",
    ),
  ];
  const base = sampleSummaries[0]!;
  const weapon = (hash: number, name: string, trait1: number[], trait2: number[]) => ({
    ...base,
    hash,
    name,
    columns: [
      { kind: "Trait", perkIndices: trait1 },
      { kind: "Trait", perkIndices: trait2 },
    ],
  });
  const weapons = [
    weapon(9101, "Alpha", [0, 1], [1]),
    weapon(9102, "Beta", [1], [1, 2]),
    weapon(9103, "Gamma", [1], [1]),
  ];

  test("trait1DamagePerks keeps only weapons with a damage perk in the FIRST trait column", () => {
    expect(names(filterWeapons(weapons, { trait1DamagePerks: true }, damageCatalog))).toEqual([
      "Alpha",
    ]);
  });

  test("trait2DamagePerks keeps only weapons with a damage perk in the SECOND trait column", () => {
    expect(names(filterWeapons(weapons, { trait2DamagePerks: true }, damageCatalog))).toEqual([
      "Beta",
    ]);
  });

  test("both flags AND together", () => {
    expect(
      filterWeapons(weapons, { trait1DamagePerks: true, trait2DamagePerks: true }, damageCatalog),
    ).toEqual([]);
  });

  test("composes with a named trait filter on the other column", () => {
    expect(
      names(filterWeapons(weapons, { trait1: ["Outlaw"], trait2DamagePerks: true }, damageCatalog)),
    ).toEqual(["Beta"]);
    expect(
      filterWeapons(weapons, { trait1: ["Frenzy"], trait2DamagePerks: true }, damageCatalog),
    ).toEqual([]);
  });
});

describe("filterWeaponNames", () => {
  test("returns flat matches with weapon-specific searchRank", () => {
    const matches = filterWeaponNames(sampleSummaries, "fate");
    expect(matches.some((m) => m.value === "Fatebringer")).toBe(true);
    expect(matches.find((m) => m.value === "Fatebringer")?.searchRank).toBeLessThanOrEqual(1);
  });
});

describe("weaponsMatchingTextQuery", () => {
  test("includes exact name matches before fuzzy-only matches", () => {
    const searcher = createWeaponSearcher(sampleSummaries);
    const matches = weaponsMatchingTextQuery(sampleSummaries, searcher, "fate", 20);
    expect(matches[0]?.name).toBe("Fatebringer");
  });

  test("respects the same chip filters as full results", () => {
    const searcher = createWeaponSearcher(sampleSummaries);
    const candidates = weaponsMatchingTextQuery(sampleSummaries, searcher, "fate", 20);

    expect(
      filterWeapons(candidates, { element: ["Solar"] }, samplePerks).map((weapon) => weapon.name),
    ).toEqual([]);
    expect(
      filterWeapons(candidates, { element: ["Arc"] }, samplePerks).map((weapon) => weapon.name),
    ).toEqual(["Fatebringer"]);
  });
});

describe("rankWeaponResults", () => {
  test("pins exact name matches above other hits while respecting sort", () => {
    const searcher = createWeaponSearcher(sampleSummaries);
    const candidates = weaponsMatchingTextQuery(sampleSummaries, searcher, "sun", 20);

    expect(
      rankWeaponResults(candidates, "sun", "season-desc").map((weapon) => weapon.name),
    ).toEqual(["Sunshot Scout", "Sunlit Fusion"]);
    expect(
      rankWeaponResults(candidates, "sun", "season-asc").map((weapon) => weapon.name),
    ).toEqual(["Sunlit Fusion", "Sunshot Scout"]);
  });

  test("falls back to sort-only when the query is too short", () => {
    expect(rankWeaponResults(sampleSummaries, "s", "name").map((w) => w.name)).toEqual(
      orderedNames(sortWeapons(sampleSummaries, "name")),
    );
  });

  test("preserves search relevance within the name-matched bucket when sorting by name", () => {
    const searcher = createWeaponSearcher(sampleSummaries);
    const candidates = weaponsMatchingTextQuery(sampleSummaries, searcher, "sun", 20);
    const expectedNameOrder = sortFilteredWeaponNames(filterWeaponNames(sampleSummaries, "sun"))
      .map((match) => match.value)
      .filter((name) => candidates.some((weapon) => weapon.name === name));

    expect(
      rankWeaponResults(candidates, "sun", "name")
        .filter((weapon) => expectedNameOrder.includes(weapon.name))
        .map((weapon) => weapon.name),
    ).toEqual(expectedNameOrder);
  });
});

describe("collectColumnPerks", () => {
  test("splits trait1 vs trait2 by column position", () => {
    const { trait1, trait2, originTrait } = collectColumnPerks(sampleSummaries, samplePerks);
    const t1 = trait1.map((p) => p.name);
    const t2 = trait2.map((p) => p.name);
    expect(t2).toContain("Frenzy");
    expect(t2).not.toContain("Explosive Payload");
    expect(t1).toContain("Surrounded");
    expect(t1).toContain("Explosive Payload");
    expect(originTrait.map((p) => p.name)).toEqual(["Vault of Glass"]);
  });

  test("trait merges both columns, counting each weapon once", () => {
    const { trait, trait1, trait2 } = collectColumnPerks(sampleSummaries, samplePerks);
    const names = trait.map((p) => p.name);
    expect(names).toContain("Frenzy");
    expect(names).toContain("Explosive Payload");
    for (const perk of trait) {
      const t1 = trait1.find((p) => p.name === perk.name)?.count ?? 0;
      const t2 = trait2.find((p) => p.name === perk.name)?.count ?? 0;
      expect(perk.count).toBeGreaterThanOrEqual(Math.max(t1, t2));
      expect(perk.count).toBeLessThanOrEqual(t1 + t2);
    }
  });

  test("combo partners are the perks rolling opposite the first pick", () => {
    const names = (first: string) =>
      collectComboPartners(sampleSummaries, samplePerks, first).map((p) => p.name);
    expect(names("Frenzy")).toEqual(["Explosive Payload", "Firefly", "Surrounded"]);
    // Same-column perks never pair, and matching ignores case.
    expect(names("firefly")).toEqual(["Eye of the Storm", "Frenzy"]);
  });

  test("counts weapons per trait1 perk", () => {
    const { trait1 } = collectColumnPerks(sampleSummaries, samplePerks);
    expect(trait1.find((p) => p.name === "Firefly")?.count).toBe(2);
  });

  test("excludes superseded weapons from column perk options", () => {
    const p = (hash: number, name: string): PerkRef => ({
      hash,
      name,
      currentlyCanRoll: true,
    });
    const weapons: WeaponDoc[] = [
      {
        hash: 1664372054,
        name: "Threat Level",
        type: "Shotgun",
        element: "Kinetic",
        ammo: "Special",
        rarity: "Legendary",
        slot: "Kinetic",
        craftable: false,
        adept: false,
        releaseIndex: 29_444,
        superseded: true,
        stats: [],
        columns: [{ kind: "Trait", perks: [p(1, "Rampage")] }],
        perks: ["Rampage"],
        perkHashes: [1],
      },
      {
        hash: 950894542,
        name: "Threat Level",
        type: "Shotgun",
        element: "Kinetic",
        ammo: "Special",
        rarity: "Legendary",
        slot: "Kinetic",
        craftable: false,
        adept: false,
        releaseIndex: 35_285,
        stats: [],
        columns: [{ kind: "Trait", perks: [p(2, "Bewildering Burst")] }],
        perks: ["Bewildering Burst"],
        perkHashes: [2],
      },
    ];
    const { index } = internWeaponCatalog(weapons, "test");
    const { trait1 } = collectColumnPerks(index.weapons, index.perks);

    expect(trait1.map((perk) => perk.name)).toEqual(["Bewildering Burst"]);
  });

  test("currentlyCanRoll stays true when any weapon can still roll the perk", () => {
    const p = (hash: number, name: string, currentlyCanRoll: boolean): PerkRef => ({
      hash,
      name,
      currentlyCanRoll,
    });
    const weapons: WeaponDoc[] = [
      {
        hash: 10,
        name: "Retired Pool",
        type: "Auto Rifle",
        element: "Kinetic",
        ammo: "Primary",
        rarity: "Legendary",
        slot: "Kinetic",
        frame: "Adaptive Frame",
        craftable: false,
        adept: false,
        releaseIndex: 1,
        stats: [],
        columns: [{ kind: "Trait", perks: [p(500, "Surrounded", false)] }],
        perks: ["Surrounded"],
        perkHashes: [500],
      },
      {
        hash: 11,
        name: "Active Pool",
        type: "Auto Rifle",
        element: "Solar",
        ammo: "Primary",
        rarity: "Legendary",
        slot: "Energy",
        frame: "Adaptive Frame",
        craftable: false,
        adept: false,
        releaseIndex: 2,
        stats: [],
        columns: [{ kind: "Trait", perks: [p(500, "Surrounded", true)] }],
        perks: ["Surrounded"],
        perkHashes: [500],
      },
    ];
    const { index } = internWeaponCatalog(weapons, "test");
    const { trait1 } = collectColumnPerks(index.weapons, index.perks);
    expect(trait1.find((perk) => perk.name === "Surrounded")?.currentlyCanRoll).toBe(true);
  });

  test("interning keeps enhanced descriptions when the first weapon lacked them", () => {
    const p = (
      hash: number,
      name: string,
      extra?: Pick<PerkRef, "description" | "enhancedDescription" | "alternateHashes">,
    ): PerkRef => ({ hash, name, currentlyCanRoll: true, ...extra });
    const weapons: WeaponDoc[] = [
      {
        hash: 20,
        name: "Sparse",
        type: "Hand Cannon",
        element: "Arc",
        ammo: "Primary",
        rarity: "Legendary",
        slot: "Kinetic",
        frame: "Adaptive Frame",
        craftable: false,
        adept: false,
        releaseIndex: 1,
        stats: [],
        columns: [
          {
            kind: "Trait",
            perks: [p(600, "Firefly", { description: "Base only." })],
          },
        ],
        perks: ["Firefly"],
        perkHashes: [600],
      },
      {
        hash: 21,
        name: "Complete",
        type: "Hand Cannon",
        element: "Solar",
        ammo: "Primary",
        rarity: "Legendary",
        slot: "Energy",
        frame: "Adaptive Frame",
        craftable: false,
        adept: false,
        releaseIndex: 2,
        stats: [],
        columns: [
          {
            kind: "Trait",
            perks: [
              p(600, "Firefly", {
                description: "Base only.",
                enhancedDescription: "Enhanced bonus.",
                alternateHashes: [601],
              }),
            ],
          },
        ],
        perks: ["Firefly"],
        perkHashes: [600],
      },
    ];
    const { index } = internWeaponCatalog(weapons, "test");
    const firefly = index.perks.find((perk) => perk.name === "Firefly");
    expect(firefly).toMatchObject({
      description: "Base only.",
      enhancedDescription: "Enhanced bonus.",
      alternateHashes: [601],
    });
  });
});

describe("sortWeapons", () => {
  test("alphabetical by name", () => {
    expect(orderedNames(sortWeapons(sampleSummaries, "name"))).toEqual([
      "Fatebringer",
      "Stormcharge",
      "Sunlit Fusion",
      "Sunshot Scout",
    ]);
  });

  test("newest season first", () => {
    expect(orderedNames(sortWeapons(sampleSummaries, "season-desc"))).toEqual([
      "Stormcharge",
      "Fatebringer",
      "Sunshot Scout",
      "Sunlit Fusion",
    ]);
  });

  test("oldest season first", () => {
    expect(orderedNames(sortWeapons(sampleSummaries, "season-asc"))).toEqual([
      "Sunlit Fusion",
      "Sunshot Scout",
      "Fatebringer",
      "Stormcharge",
    ]);
  });

});

describe("buildPerkMapFromCatalog", () => {
  test("maps each plug hash to its perk (used to resolve owned/instanced rolls)", () => {
    const map = buildPerkMapFromCatalog(samplePerks);
    expect(map.get(110)?.name).toBe("Surrounded");
    expect(map.get(106)?.name).toBe("Firefly");
    expect(map.get(100)?.name).toBe("Adaptive Frame");
    expect(map.size).toBeGreaterThan(10);
  });
});
