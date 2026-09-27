import { describe, expect, it } from "vitest";

import type { PerkRef, WeaponDoc } from "./types";
import {
  collapseWeaponVersions,
  currentWeaponPerkPoolVersions,
  isCatalogWeapon,
  originTraitNamesForWeapons,
  primaryCatalogWeaponForHash,
  primaryWeaponVersion,
  reconcileAdeptTierPools,
  reconcileCraftableTwins,
  sortWeaponVersions,
  weaponPerkPoolVersionForHash,
  weaponsInVersionFamily,
  weaponVersionFamilyName,
} from "./weapon-variants";

const perk = (name: string): PerkRef => ({
  hash: name.length,
  name,
  currentlyCanRoll: true,
});

function weapon(hash: number, name: string, extra: Partial<WeaponDoc> = {}): WeaponDoc {
  return {
    hash,
    name,
    type: "Auto Rifle",
    element: "Kinetic",
    ammo: "Primary",
    rarity: "Legendary",
    slot: "Kinetic",
    craftable: false,
    adept: false,
    releaseIndex: hash,
    columns: [{ kind: "Trait", perks: [perk("Old Perk")] }],
    perks: ["Old Perk"],
    perkHashes: [1],
    stats: [],
    ...extra,
  };
}

function recklessOracleGroup(): WeaponDoc[] {
  return [
    weapon(3385326721, "Reckless Oracle", {
      source: "Garden of Salvation",
      releaseIndex: 31_478,
      columns: [
        { kind: "Trait", perks: [perk("Auto-Loading Holster"), perk("Outlaw")] },
        { kind: "Trait", perks: [perk("Kill Clip")] },
      ],
      perks: ["Auto-Loading Holster", "Outlaw", "Kill Clip"],
    }),
    weapon(1992309064, "Reckless Oracle", {
      craftable: true,
      source: "Garden of Salvation",
      releaseIndex: 33_110,
      columns: [
        { kind: "Trait", perks: [perk("Keep Away"), perk("Rewind Rounds")] },
        { kind: "Trait", perks: [perk("Destabilizing Rounds")] },
      ],
      perks: ["Keep Away", "Rewind Rounds", "Destabilizing Rounds"],
    }),
    weapon(4158265643, "Reckless Oracle", {
      source: "Pantheon",
      releaseIndex: 35_278,
      columns: [
        { kind: "Trait", perks: [perk("Subsistence"), perk("Repulsor Brace")] },
        { kind: "Trait", perks: [perk("Paracausal Affinity")] },
      ],
      perks: ["Subsistence", "Repulsor Brace", "Paracausal Affinity"],
    }),
    weapon(1802315656, "Reckless Oracle", {
      releaseIndex: 35_290,
      columns: [
        { kind: "Trait", perks: [perk("Repulsor Brace"), perk("Subsistence")] },
        { kind: "Trait", perks: [perk("Paracausal Affinity")] },
      ],
      perks: ["Repulsor Brace", "Subsistence", "Paracausal Affinity"],
    }),
  ];
}

describe("reconcileCraftableTwins", () => {
  it("marks legacy raid defs superseded and copies source onto the craftable twin", () => {
    const result = reconcileCraftableTwins([
      weapon(1, "Transfiguration", {
        source: "Last Wish",
        releaseIndex: 100,
        columns: [{ kind: "Trait", perks: [perk("Rampage")] }],
        perks: ["Rampage"],
      }),
      weapon(2, "Transfiguration", {
        craftable: true,
        releaseIndex: 200,
        columns: [{ kind: "Trait", perks: [perk("Discord")] }],
        perks: ["Discord"],
      }),
    ]);

    const legacy = result.find((w) => w.hash === 1);
    const modern = result.find((w) => w.hash === 2);
    expect(legacy?.superseded).toBe(true);
    expect(modern?.superseded).toBeUndefined();
    expect(modern?.source).toBe("Last Wish");
  });

  it("leaves unrelated duplicates untouched", () => {
    const result = reconcileCraftableTwins([
      weapon(1, "Fatebringer", { source: "Vault of Glass", releaseIndex: 100 }),
      weapon(2, "Fatebringer (Adept)", { releaseIndex: 200 }),
    ]);
    expect(result.every((w) => w.superseded !== true)).toBe(true);
  });

  it("marks older non-craftable reprisals superseded and copies source onto the newest def", () => {
    const result = reconcileCraftableTwins([
      weapon(1664372054, "Threat Level", {
        source: "Scourge of the Past",
        seasonNumber: 5,
        releaseIndex: 29_444,
        columns: [{ kind: "Trait", perks: [perk("Rampage")] }],
        perks: ["Rampage"],
      }),
      weapon(1523151869, "Threat Level", {
        source: "Pantheon",
        releaseIndex: 35_273,
        columns: [{ kind: "Trait", perks: [perk("One-Two Punch")] }],
        perks: ["One-Two Punch"],
      }),
      weapon(950894542, "Threat Level", {
        releaseIndex: 35_285,
        columns: [{ kind: "Trait", perks: [perk("Bewildering Burst")] }],
        perks: ["Bewildering Burst"],
      }),
    ]);

    const legacy = result.find((w) => w.hash === 1664372054);
    const pantheon = result.find((w) => w.hash === 1523151869);
    const latest = result.find((w) => w.hash === 950894542);
    expect(legacy?.superseded).toBe(true);
    expect(pantheon?.superseded).toBe(true);
    expect(latest?.superseded).toBeUndefined();
    expect(latest?.source).toBe("Pantheon");
  });

  it("copies Arena Ops source onto the newest Kindled Orchid def without a collectible", () => {
    const result = reconcileCraftableTwins([
      weapon(2575506895, "Kindled Orchid", {
        source: "Crafted in a Black Armory forge",
        releaseIndex: 29_440,
        columns: [{ kind: "Trait", perks: [perk("Rampage")] }],
        perks: ["Rampage"],
      }),
      weapon(3961462214, "Kindled Orchid", {
        source: "Arena Ops",
        releaseIndex: 35_470,
        columns: [{ kind: "Trait", perks: [perk("Kill Clip")] }],
        perks: ["Kill Clip"],
      }),
      weapon(334964261, "Kindled Orchid", {
        releaseIndex: 35_490,
        columns: [{ kind: "Trait", perks: [perk("Kill Clip")] }],
        perks: ["Kill Clip"],
      }),
    ]);

    const blackArmory = result.find((w) => w.hash === 2575506895);
    const arenaOps = result.find((w) => w.hash === 3961462214);
    const latest = result.find((w) => w.hash === 334964261);
    expect(blackArmory?.superseded).toBe(true);
    expect(arenaOps?.superseded).toBe(true);
    expect(latest?.superseded).toBeUndefined();
    expect(latest?.source).toBe("Arena Ops");
  });

  it("keeps current Garden and Pantheon Reckless Oracle pools catalog-visible", () => {
    const result = reconcileCraftableTwins(recklessOracleGroup());

    const oldGarden = result.find((w) => w.hash === 3385326721);
    const garden = result.find((w) => w.hash === 1992309064);
    const pantheonSourceful = result.find((w) => w.hash === 4158265643);
    const pantheonLatest = result.find((w) => w.hash === 1802315656);
    expect(oldGarden?.superseded).toBe(true);
    expect(garden?.superseded).toBeUndefined();
    expect(pantheonSourceful?.superseded).toBeUndefined();
    expect(pantheonLatest?.superseded).toBeUndefined();
  });
});

describe("isCatalogWeapon", () => {
  it("excludes superseded legacy hashes from browse surfaces", () => {
    expect(isCatalogWeapon({ superseded: true })).toBe(false);
    expect(isCatalogWeapon({})).toBe(true);
  });
});

describe("weapon version grouping", () => {
  it("excludes superseded historical perk pools from detail versions", () => {
    const threatLevel = currentWeaponPerkPoolVersions([
      weapon(1664372054, "Threat Level", {
        superseded: true,
        source: "Scourge of the Past",
        releaseIndex: 29_444,
        columns: [{ kind: "Trait", perks: [perk("Rampage")] }],
        perks: ["Rampage"],
      }),
      weapon(950894542, "Threat Level", {
        source: "Pantheon",
        releaseIndex: 35_285,
        columns: [{ kind: "Trait", perks: [perk("Bewildering Burst")] }],
        perks: ["Bewildering Burst"],
      }),
    ]);
    const kindledOrchid = currentWeaponPerkPoolVersions([
      weapon(2575506895, "Kindled Orchid", {
        superseded: true,
        source: "Crafted in a Black Armory forge",
        releaseIndex: 29_440,
        columns: [{ kind: "Trait", perks: [perk("Rampage")] }],
        perks: ["Rampage"],
      }),
      weapon(334964261, "Kindled Orchid", {
        source: "Arena Ops",
        releaseIndex: 35_490,
        columns: [{ kind: "Trait", perks: [perk("Kill Clip")] }],
        perks: ["Kill Clip"],
      }),
    ]);
    const cynosure = currentWeaponPerkPoolVersions([
      weapon(1, "Cynosure", {
        superseded: true,
        releaseIndex: 100,
        columns: [{ kind: "Origin Trait", perks: [perk("Old Origin")] }],
        perks: ["Old Origin"],
      }),
      weapon(3, "Cynosure", {
        releaseIndex: 300,
        columns: [{ kind: "Origin Trait", perks: [perk("Air-Cooled Core")] }],
        perks: ["Air-Cooled Core"],
      }),
    ]);

    expect(threatLevel.map((version) => version.weapon.hash)).toEqual([950894542]);
    expect(kindledOrchid.map((version) => version.weapon.hash)).toEqual([334964261]);
    expect(cynosure.map((version) => version.weapon.hash)).toEqual([3]);
  });

  it("keeps distinct active Zaouli's Bane pools and labels a source-less duplicate", () => {
    const versions = currentWeaponPerkPoolVersions([
      weapon(431721920, "Zaouli's Bane", {
        craftable: true,
        source: "King's Fall",
        releaseIndex: 24_533,
        columns: [
          { kind: "Trait", perks: [perk("Ensemble"), perk("Explosive Payload")] },
          { kind: "Trait", perks: [perk("Incandescent")] },
        ],
        perks: ["Ensemble", "Explosive Payload", "Incandescent"],
      }),
      weapon(3647341740, "Zaouli's Bane", {
        source: "Pantheon",
        releaseIndex: 35_276,
        columns: [
          { kind: "Trait", perks: [perk("Explosive Payload"), perk("Burning Ambition")] },
          { kind: "Trait", perks: [perk("Chaos Reshaped")] },
        ],
        perks: ["Explosive Payload", "Burning Ambition", "Chaos Reshaped"],
      }),
      weapon(3066945855, "Zaouli's Bane", {
        releaseIndex: 35_288,
        columns: [
          { kind: "Trait", perks: [perk("Burning Ambition"), perk("Explosive Payload")] },
          { kind: "Trait", perks: [perk("Chaos Reshaped")] },
        ],
        perks: ["Burning Ambition", "Explosive Payload", "Chaos Reshaped"],
      }),
    ]);

    expect(versions.map((version) => version.weapon.hash)).toEqual([3066945855, 431721920]);
    expect(versions.map((version) => version.label)).toEqual(["Pantheon", "King's Fall"]);
    expect(versions.map((version) => version.hashes)).toEqual([
      [3066945855, 3647341740],
      [431721920],
    ]);
  });

  it("keeps distinct active Reckless Oracle pools and labels the Pantheon duplicate", () => {
    const versions = currentWeaponPerkPoolVersions(reconcileCraftableTwins(recklessOracleGroup()));

    expect(versions.map((version) => version.weapon.hash)).toEqual([1802315656, 1992309064]);
    expect(versions.map((version) => version.label)).toEqual(["Pantheon", "Garden of Salvation"]);
    expect(versions.map((version) => version.hashes)).toEqual([
      [1802315656, 4158265643],
      [1992309064],
    ]);
    expect(weaponPerkPoolVersionForHash(versions, 1802315656)?.label).toBe("Pantheon");
    expect(weaponPerkPoolVersionForHash(versions, 4158265643)?.label).toBe("Pantheon");
    expect(weaponPerkPoolVersionForHash(versions, 1992309064)?.label).toBe(
      "Garden of Salvation",
    );
    expect(weaponPerkPoolVersionForHash(versions, 3385326721)).toBeUndefined();
  });

  it("resolves a weapon hash to its current perk-pool option", () => {
    const zaoulis = [
      weapon(431721920, "Zaouli's Bane", {
        craftable: true,
        source: "King's Fall",
        releaseIndex: 24_533,
        columns: [{ kind: "Trait", perks: [perk("Incandescent")] }],
      }),
      weapon(3066945855, "Zaouli's Bane", {
        source: "Pantheon",
        releaseIndex: 35_288,
        columns: [{ kind: "Trait", perks: [perk("Chaos Reshaped")] }],
      }),
    ];
    const pools = currentWeaponPerkPoolVersions(zaoulis);

    expect(weaponPerkPoolVersionForHash(pools, 3066945855)?.label).toBe("Pantheon");
    expect(weaponPerkPoolVersionForHash(pools, 431721920)?.label).toBe("King's Fall");
    expect(weaponPerkPoolVersionForHash(pools, 999)).toBeUndefined();
  });

  it("groups adept tiers with their base weapon family for detail versions", () => {
    const kingsFall = weapon(431721920, "Zaouli's Bane", {
      craftable: true,
      source: "King's Fall",
      releaseIndex: 24_533,
      columns: [
        { kind: "Trait", perks: [perk("Ensemble"), perk("Explosive Payload")] },
        { kind: "Trait", perks: [perk("Incandescent")] },
      ],
    });
    const harrowed = weapon(291092617, "Zaouli's Bane (Harrowed)", {
      craftable: true,
      adept: true,
      source: "King's Fall",
      releaseIndex: 24_535,
      columns: [
        { kind: "Trait", perks: [perk("Ensemble"), perk("Explosive Payload")] },
        { kind: "Trait", perks: [perk("Incandescent")] },
      ],
    });
    const pantheon = weapon(3066945855, "Zaouli's Bane", {
      source: "Pantheon",
      releaseIndex: 35_288,
      columns: [
        { kind: "Trait", perks: [perk("Burning Ambition"), perk("Explosive Payload")] },
        { kind: "Trait", perks: [perk("Chaos Reshaped")] },
      ],
    });
    const family = weaponsInVersionFamily([kingsFall, harrowed, pantheon], harrowed.name);
    const versions = currentWeaponPerkPoolVersions(family);

    expect(weaponVersionFamilyName(harrowed.name)).toBe("Zaouli's Bane");
    expect(family.map((entry) => entry.hash).sort()).toEqual([291092617, 3066945855, 431721920]);
    expect(versions.map((version) => version.label)).toEqual(["Pantheon", "Standard", "Harrowed"]);
    expect(versions.map((version) => version.weapon.hash)).toEqual([3066945855, 431721920, 291092617]);
    expect(versions.map((version) => version.hashes)).toEqual([[3066945855], [431721920], [291092617]]);
    expect(weaponPerkPoolVersionForHash(versions, 291092617)?.label).toBe("Harrowed");
    expect(weaponPerkPoolVersionForHash(versions, 431721920)?.label).toBe("Standard");
  });

  it("labels unified normal and Timelost pools as Standard and Timelost", () => {
    const fatebringer = weapon(1, "Fatebringer", {
      source: "Vault of Glass",
      releaseIndex: 100,
      columns: [
        { kind: "Trait", perks: [perk("Firefly"), perk("Explosive Payload")] },
        { kind: "Trait", perks: [perk("Frenzy"), perk("Opening Shot")] },
      ],
    });
    const timelost = weapon(2, "Fatebringer (Timelost)", {
      adept: true,
      source: "Vault of Glass",
      releaseIndex: 200,
      columns: [
        { kind: "Trait", perks: [perk("Explosive Payload"), perk("Firefly")] },
        { kind: "Trait", perks: [perk("Opening Shot"), perk("Frenzy")] },
      ],
    });
    const family = weaponsInVersionFamily([fatebringer, timelost], timelost.name);
    const versions = currentWeaponPerkPoolVersions(family);

    expect(versions.map((version) => version.label)).toEqual(["Standard", "Timelost"]);
    expect(versions.map((version) => version.weapon.hash)).toEqual([1, 2]);
    expect(weaponPerkPoolVersionForHash(versions, 2)?.label).toBe("Timelost");
  });

  it("unions adept-tier perk columns within the same source", () => {
    const normal = weapon(1, "Praedyth's Revenge", {
      source: "Vault of Glass",
      releaseIndex: 100,
      columns: [
        { kind: "Trait", perks: [perk("Bewildering Burst"), perk("Firefly")] },
        { kind: "Trait", perks: [perk("Frenzy")] },
      ],
      perks: ["Bewildering Burst", "Firefly", "Frenzy"],
    });
    const timelost = weapon(2, "Praedyth's Revenge (Timelost)", {
      adept: true,
      source: "Vault of Glass",
      releaseIndex: 200,
      columns: [
        { kind: "Trait", perks: [perk("Aggregate Charge"), perk("Firefly")] },
        { kind: "Trait", perks: [perk("Frenzy")] },
      ],
      perks: ["Aggregate Charge", "Firefly", "Frenzy"],
    });

    const merged = reconcileAdeptTierPools([normal, timelost]);
    const normalMerged = merged.find((weapon) => weapon.hash === 1)!;
    const timelostMerged = merged.find((weapon) => weapon.hash === 2)!;

    expect(normalMerged.perks).toEqual(
      expect.arrayContaining(["Bewildering Burst", "Aggregate Charge", "Firefly", "Frenzy"]),
    );
    expect(timelostMerged.perks).toEqual(normalMerged.perks);
    expect(currentWeaponPerkPoolVersions(merged).map((version) => version.label)).toEqual([
      "Standard",
      "Timelost",
    ]);
  });

  it("merges adept tiers only within the same source", () => {
    const vow = weapon(613334176, "Forbearance", {
      source: "Vow of the Disciple",
      releaseIndex: 100,
      columns: [{ kind: "Trait", perks: [perk("Turnabout")] }],
      perks: ["Turnabout"],
    });
    const vowAdept = weapon(4038592169, "Forbearance (Adept)", {
      adept: true,
      source: "Vow of the Disciple",
      releaseIndex: 110,
      columns: [{ kind: "Trait", perks: [perk("Frenzy")] }],
      perks: ["Frenzy"],
    });
    const intoTheLight = weapon(568611921, "Forbearance", {
      source: "Into the Light",
      releaseIndex: 200,
      columns: [{ kind: "Trait", perks: [perk("Adrenaline Junkie")] }],
      perks: ["Adrenaline Junkie"],
    });

    const merged = reconcileAdeptTierPools([vow, vowAdept, intoTheLight]);
    const vowMerged = merged.find((weapon) => weapon.hash === 613334176)!;
    const adeptMerged = merged.find((weapon) => weapon.hash === 4038592169)!;
    const lightMerged = merged.find((weapon) => weapon.hash === 568611921)!;

    expect(vowMerged.perks).toEqual(expect.arrayContaining(["Turnabout", "Frenzy"]));
    expect(adeptMerged.perks).toEqual(vowMerged.perks);
    expect(lightMerged.perks).toEqual(["Adrenaline Junkie"]);
  });

  it("sorts same-name catalog versions newest first", () => {
    const sorted = sortWeaponVersions([
      weapon(1, "Cynosure", { seasonNumber: 20, releaseIndex: 100 }),
      weapon(2, "Cynosure", { seasonNumber: 24, releaseIndex: 200 }),
      weapon(3, "Cynosure", { seasonNumber: 24, releaseIndex: 300 }),
    ]);

    expect(sorted.map((w) => w.hash)).toEqual([3, 2, 1]);
  });

  it("prefers higher releaseIndex over legacy season metadata (Threat Level)", () => {
    const primary = primaryWeaponVersion([
      weapon(1664372054, "Threat Level", {
        seasonNumber: 5,
        releaseIndex: 29_444,
        columns: [{ kind: "Trait", perks: [perk("Rampage")] }],
      }),
      weapon(1523151869, "Threat Level", {
        releaseIndex: 35_273,
        columns: [{ kind: "Trait", perks: [perk("One-Two Punch")] }],
      }),
      weapon(950894542, "Threat Level", {
        releaseIndex: 35_285,
        columns: [{ kind: "Trait", perks: [perk("Bewildering Burst")] }],
      }),
    ]);

    expect(primary?.hash).toBe(950894542);
  });

  it("picks a craftable version when recency is otherwise tied", () => {
    const primary = primaryWeaponVersion([
      weapon(1, "Uncivil Discourse", { seasonNumber: 25, releaseIndex: 100 }),
      weapon(2, "Uncivil Discourse", {
        craftable: true,
        seasonNumber: 25,
        releaseIndex: 100,
      }),
    ]);

    expect(primary?.hash).toBe(2);
  });

  it("collapses exact-name catalog versions to one row per current perk pool", () => {
    const oldOrigin = weapon(1, "Uncivil Discourse", {
      seasonNumber: 24,
      releaseIndex: 100,
      columns: [{ kind: "Origin Trait", perks: [perk("Accelerated Assault")] }],
    });
    const latestOrigin = weapon(2, "Uncivil Discourse", {
      seasonNumber: 25,
      releaseIndex: 200,
      columns: [{ kind: "Origin Trait", perks: [perk("Air-Cooled Core")] }],
    });
    const adept = weapon(3, "Uncivil Discourse (Adept)", {
      seasonNumber: 25,
      releaseIndex: 300,
    });

    expect(collapseWeaponVersions([oldOrigin, latestOrigin, adept]).map((w) => w.hash)).toEqual([
      2, 1, 3,
    ]);
  });

  it("prefers the matched perk pool when a filter surfaces only an older catalog variant", () => {
    const oldOrigin = weapon(1, "Uncivil Discourse", {
      seasonNumber: 24,
      releaseIndex: 100,
      columns: [{ kind: "Origin Trait", perks: [perk("Accelerated Assault")] }],
    });
    const latestOrigin = weapon(2, "Uncivil Discourse", {
      seasonNumber: 25,
      releaseIndex: 200,
      columns: [{ kind: "Origin Trait", perks: [perk("Air-Cooled Core")] }],
    });
    const byName = new Map([["Uncivil Discourse", [oldOrigin, latestOrigin]]]);

    expect(collapseWeaponVersions([oldOrigin], byName).map((w) => w.hash)).toEqual([1]);
  });

  it("keeps filtered same-name pools while grouping ranked results once", () => {
    const oldOrigin = weapon(1, "Uncivil Discourse", {
      seasonNumber: 24,
      releaseIndex: 100,
      columns: [{ kind: "Origin Trait", perks: [perk("Accelerated Assault")] }],
    });
    const latestOrigin = weapon(2, "Uncivil Discourse", {
      seasonNumber: 25,
      releaseIndex: 200,
      columns: [{ kind: "Origin Trait", perks: [perk("Air-Cooled Core")] }],
    });
    const other = weapon(3, "Ros Arago IV", {
      releaseIndex: 150,
      columns: [{ kind: "Origin Trait", perks: [perk("Nadir Focus")] }],
    });
    const byName = new Map([
      ["Uncivil Discourse", [oldOrigin, latestOrigin]],
      ["Ros Arago IV", [other]],
    ]);

    expect(collapseWeaponVersions([oldOrigin, other], byName).map((w) => w.hash)).toEqual([1, 3]);
  });

  it("returns each current Zaouli's Bane perk pool and labels the source-less representative", () => {
    const kingsFall = weapon(431721920, "Zaouli's Bane", {
      craftable: true,
      source: "King's Fall",
      releaseIndex: 24_533,
      columns: [
        { kind: "Trait", perks: [perk("Ensemble"), perk("Explosive Payload")] },
        { kind: "Trait", perks: [perk("Incandescent")] },
      ],
    });
    const pantheonSourceful = weapon(3647341740, "Zaouli's Bane", {
      source: "Pantheon",
      releaseIndex: 35_276,
      columns: [
        { kind: "Trait", perks: [perk("Explosive Payload"), perk("Burning Ambition")] },
        { kind: "Trait", perks: [perk("Chaos Reshaped")] },
      ],
    });
    const pantheonLatest = weapon(3066945855, "Zaouli's Bane", {
      releaseIndex: 35_288,
      columns: [
        { kind: "Trait", perks: [perk("Burning Ambition"), perk("Explosive Payload")] },
        { kind: "Trait", perks: [perk("Chaos Reshaped")] },
      ],
    });
    const byName = new Map([
      ["Zaouli's Bane", [kingsFall, pantheonSourceful, pantheonLatest]],
    ]);

    expect(collapseWeaponVersions([kingsFall], byName).map((w) => w.hash)).toEqual([431721920]);
    expect(collapseWeaponVersions([pantheonSourceful], byName).map((w) => w.hash)).toEqual([
      3066945855,
    ]);
    expect(collapseWeaponVersions([pantheonSourceful], byName)[0]?.source).toBe("Pantheon");
    expect(
      collapseWeaponVersions([kingsFall, pantheonSourceful, pantheonLatest], byName).map(
        (w) => w.hash,
      ),
    ).toEqual([3066945855, 431721920]);
  });

  it("returns each current Reckless Oracle perk pool and labels the Pantheon representative", () => {
    const group = reconcileCraftableTwins(recklessOracleGroup());
    const byName = new Map([["Reckless Oracle", group]]);
    const collapsed = collapseWeaponVersions(group, byName);

    expect(collapsed.map((w) => w.hash)).toEqual([1802315656, 1992309064]);
    expect(collapsed.map((w) => w.source)).toEqual(["Pantheon", "Garden of Salvation"]);
  });

  it("maps a raw legacy hash to the primary catalog version for saved hash surfaces", () => {
    const legacy = weapon(1664372054, "Threat Level", {
      superseded: true,
      seasonNumber: 5,
      releaseIndex: 29_444,
      columns: [{ kind: "Trait", perks: [perk("Rampage")] }],
    });
    const primary = weapon(950894542, "Threat Level", {
      releaseIndex: 35_285,
      columns: [{ kind: "Trait", perks: [perk("Bewildering Burst")] }],
    });
    const byHash = new Map([
      [legacy.hash, legacy],
      [primary.hash, primary],
    ]);
    const byName = new Map([["Threat Level", [legacy, primary]]]);

    expect(primaryCatalogWeaponForHash(1664372054, byHash, byName)?.hash).toBe(950894542);
  });

  it("excludes superseded versions and aggregates origin trait options", () => {
    const legacy = weapon(1, "Cynosure", {
      superseded: true,
      releaseIndex: 100,
      columns: [{ kind: "Origin Trait", perks: [perk("Old Origin")] }],
    });
    const middle = weapon(2, "Cynosure", {
      releaseIndex: 200,
      columns: [{ kind: "Origin Trait", perks: [perk("Accelerated Assault")] }],
    });
    const latest = weapon(3, "Cynosure", {
      releaseIndex: 300,
      columns: [{ kind: "Origin Trait", perks: [perk("Air-Cooled Core")] }],
    });

    expect(collapseWeaponVersions([legacy, middle, latest]).map((w) => w.hash)).toEqual([3, 2]);
    expect(originTraitNamesForWeapons(sortWeaponVersions([legacy, middle, latest]))).toEqual([
      "Air-Cooled Core",
      "Accelerated Assault",
    ]);
  });
});
