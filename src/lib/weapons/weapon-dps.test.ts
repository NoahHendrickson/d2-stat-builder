import { describe, expect, it } from "vitest";
import {
  buildWeaponDpsIndex,
  compatibleSetups,
  matchSetupPerks,
  parseCsv,
  setupPerkKeys,
  setupRolls,
  weaponDpsKey,
  weaponPerkNames,
} from "./weapon-dps";

// The Sustained tab's shape: the header's own cells break across lines, and a
// Name cell is the weapon on its first line with the setup below it.
const CSV = [
  'Name,Type,Family,#,"peak\nRate",TtE,Single,"TFS\nTotal",Total,DPS',
  '"Leviathan\'s Breath\nArcher\'s Tempo",power,bow,14,1.333,17.329,"5,111","3,874,920","71,555","4,129"',
  '"Leviathan\'s Breath\nArcher\'s Tempo, Moebius Quiver, Argent Quiver, simulated",power,bow,14,1.333,17.329,"15,972","3,874,920","223,610","12,904"',
  '"Aggressive rocket launcher\nCluster Bomb + Elemental Honing x5 (Hezen Vengeance), Pack Hunter",power,rocket,9,1.100,8.800,"11,131",,"100,178","11,384"',
  '"Aggressive rocket launcher\nBare frame, no weapon named",power,rocket,9,1.100,8.800,"9,000",,"81,000","9,000"',
  '"Hierarchy of Needs\nGuidance Ring, Argent Quiver",primary,bow,INF,1.017,N/A,"3,048",INF,INF,"2,997"',
  '"Storm grenade\nBastion",grenade,grenade,1,N/A,N/A,"4,000",,"4,000","400"',
].join("\n");

const NAMES = [
  "Leviathan's Breath",
  "Hezen Vengeance",
  "Hezen Vengeance (Timelost)",
  "Hierarchy of Needs",
  "Gjallarhorn",
];

describe("parseCsv", () => {
  it("keeps commas, doubled quotes and line breaks inside quoted fields", () => {
    expect(parseCsv('a,"b, c","say ""hi""\nthere"\r\nd,e,f')).toEqual([
      ["a", "b, c", 'say "hi"\nthere'],
      ["d", "e", "f"],
    ]);
  });
});

describe("weaponDpsKey", () => {
  it("folds case, curly apostrophes and the catalog's variant tags", () => {
    expect(weaponDpsKey("Leviathan’s Breath")).toBe("leviathan's breath");
    expect(weaponDpsKey("Hezen Vengeance (Timelost)")).toBe("hezen vengeance");
    expect(weaponDpsKey("Fatebringer (Adept)")).toBe("fatebringer");
  });
});

describe("buildWeaponDpsIndex", () => {
  const index = buildWeaponDpsIndex(CSV, NAMES, "2026-10-17T00:00:00.000Z");

  it("groups a weapon's setups by name, highest DPS first", () => {
    expect(index.weapons["leviathan's breath"]).toEqual([
      {
        setup: "Archer's Tempo, Moebius Quiver, Argent Quiver, simulated",
        dps: 12904,
        reservesDamage: 223610,
        timeToEmpty: 17.329,
      },
      {
        setup: "Archer's Tempo",
        dps: 4129,
        reservesDamage: 71555,
        timeToEmpty: 17.329,
      },
    ]);
  });

  it("credits an archetype row to the weapon named in brackets, without the brackets", () => {
    expect(index.weapons["hezen vengeance"]).toEqual([
      {
        setup: "Cluster Bomb + Elemental Honing x5, Pack Hunter",
        dps: 11384,
        reservesDamage: 100178,
        timeToEmpty: 8.8,
      },
    ]);
  });

  it("marks infinite-ammo weapons and leaves their reserves numbers out", () => {
    expect(index.weapons["hierarchy of needs"]).toEqual([
      { setup: "Guidance Ring, Argent Quiver", dps: 2997, infinite: true },
    ]);
  });

  it("drops rows that name no catalog weapon", () => {
    expect(Object.keys(index.weapons).sort()).toEqual([
      "hezen vengeance",
      "hierarchy of needs",
      "leviathan's breath",
    ]);
  });

  it("fails loudly when the sheet's columns move", () => {
    expect(() => buildWeaponDpsIndex("Weapon,Damage\nx,1", NAMES)).toThrow(
      /no "name" column/,
    );
  });
});

describe("setupPerkKeys", () => {
  it("splits a setup into names without enhanced prefixes, stacks or notes", () => {
    expect(
      setupPerkKeys(
        "Heavy Bolts, Envious Arsenal + High Ground + e. Accelerated Assault, Guidance Ring x3, Sniper’s Meditation (assume stacked), 1H1L combo*",
      ),
    ).toEqual([
      "heavy bolts",
      "envious arsenal",
      "high ground",
      "accelerated assault",
      "guidance ring",
      "sniper's meditation",
      "1h1l combo",
    ]);
  });
});

describe("matchSetupPerks", () => {
  it("puts each named perk in one column, even when both columns roll both", () => {
    const named = new Set(["cluster bomb", "elemental honing"]);
    const traits = ["envious arsenal", "cluster bomb", "elemental honing"];
    expect(matchSetupPerks(named, [traits, traits])).toEqual([1, 2]);
  });

  it("moves an earlier column's pick when a later column has no other way in", () => {
    // Greedy would give column 0 "a" and leave column 1 with nothing.
    expect(matchSetupPerks(new Set(["a", "b"]), [["a", "b"], ["a"]])).toEqual([1, 0]);
  });

  it("leaves columns the setup names nothing in", () => {
    expect(matchSetupPerks(new Set(["b"]), [["a"], ["b", "c"]])).toEqual([undefined, 0]);
  });
});

describe("setupRolls", () => {
  // Perks: 0 Cluster Bomb, 1 Envious Arsenal, 2 Elemental Honing, 3 Timelost Magazine, 4 Ballistics.
  const perks = ["Cluster Bomb", "Envious Arsenal", "Elemental Honing", "Timelost Magazine", "Ballistics"].map(
    (name) => ({ name }),
  );
  const slots = [
    { key: 3, perkIndices: [0, 1] },
    { key: 4, perkIndices: [0, 2] },
    { key: 5, perkIndices: [3] },
    { key: 9, perkIndices: [4] },
  ];
  const setup = (text: string) => ({ setup: text, dps: 1 });

  it("keys each named perk by its slot, one name per slot", () => {
    expect(
      setupRolls([setup("Cluster Bomb + Elemental Honing x5 + Timelost Magazine, Pack Hunter")], slots, perks),
    ).toEqual([{ 3: 0, 4: 2, 5: 3 }]);
  });

  it("finds mods and masterworks by their slot too", () => {
    expect(setupRolls([setup("Envious Arsenal, Ballistics")], slots, perks)).toEqual([{ 3: 1, 9: 4 }]);
  });

  it("is null for a setup that names nothing this weapon rolls", () => {
    expect(setupRolls([setup("Pack Hunter, Argent Ordnance")], slots, perks)).toEqual([null]);
  });
});

describe("compatibleSetups", () => {
  const setup = (text: string) => ({ setup: text, dps: 1 });
  const base = new Set(["chaos reshaped", "mega kill clip", "backup mag"]);
  const adept = new Set(["backup mag", "rewind rounds"]);
  const versions = new Set([...base, ...adept]);
  const setups = [
    setup("no Backup Mag, projectile, Chaos Reshaped x2 + Mega Kill Clip"),
    setup("Rewind Rounds, Pack Hunter, simulated"),
  ];

  it("leaves out a setup naming a perk only another version rolls", () => {
    expect(compatibleSetups(setups, adept, versions)).toEqual([setups[1]]);
    expect(compatibleSetups(setups, base, versions)).toEqual([setups[0]]);
  });

  it("ignores names no version rolls, like buffs and notes", () => {
    expect(compatibleSetups([setup("Pack Hunter, simulated")], adept, versions)).toHaveLength(1);
  });
});

describe("weaponPerkNames", () => {
  it("covers columns, masterworks and mods", () => {
    const perks = ["Rampage", "Range Masterwork", "Ballistics"].map((name) => ({ name }));
    expect(weaponPerkNames({ columns: [{ perkIndices: [0] }], masterworks: [1], mods: [2] }, perks)).toEqual(
      new Set(["rampage", "range masterwork", "ballistics"]),
    );
  });
});
