import { expect, test } from "vitest";
import type { DestinyProfileResponse } from "bungie-api-ts/destiny2";
import type { Manifest } from "@/lib/manifest/load";
import {
  ARMOR_MASTERWORK_PLUG_CATEGORY,
  ASCENDANT_SHARD_HASH,
  ENHANCEMENT_CORE_HASH,
  ENHANCEMENT_PRISM_HASH,
  GLIMMER_HASH,
  isFullyMasterworked,
  masterworkPlugLevel,
  materialScore,
  readMasterwork,
  summarizeMasterwork,
  sumMaterialStacks,
} from "./masterwork";
import { STAT_HASHES } from "./stats";

const MW_CAT = ARMOR_MASTERWORK_PLUG_CATEGORY;
const PLUG_SET = 3002339980;
const SOCKET = 5;

/** A v460 masterwork plug: +level to all six stats, costing `mats` to insert. */
function mwPlug(level: number, materialSet: number) {
  return {
    plug: {
      plugCategoryIdentifier: MW_CAT,
      insertionMaterialRequirementHash: materialSet,
    },
    investmentStats: Object.values(STAT_HASHES).map((statTypeHash) => ({
      statTypeHash,
      value: level,
    })),
  };
}

// Two tier ladders, laid out back to back like the real plug set: Tier 4 (D) and
// Tier 5 (E). Level-0 plugs (D0 / E0) are what a fresh drop carries.
const D0 = 400;
const D = [401, 402, 403, 404, 405];
const E0 = 500;
const E = [501, 502, 503, 504, 505];
const MATS_D = [1401, 1402, 1403, 1404, 1405];
const MATS_E = [1501, 1502, 1503, 1504, 1505];

const items: Record<number, object> = {
  [D0]: mwPlug(0, 0),
  [E0]: mwPlug(0, 0),
  ...Object.fromEntries(D.map((h, i) => [h, mwPlug(i + 1, MATS_D[i])])),
  ...Object.fromEntries(E.map((h, i) => [h, mwPlug(i + 1, MATS_E[i])])),
  [GLIMMER_HASH]: { displayProperties: { name: "Glimmer" } },
};

const materialSets: Record<number, object> = {
  // Tier 5 ladder: 2400g+3c+1p, 3500g+5c+2p, 7500g+6c+2p, 9100g+7c+3p+1s, 12500g+9c+5p+2s
  [MATS_E[0]]: mats([2400, 3, 1, 0]),
  [MATS_E[1]]: mats([3500, 5, 2, 0]),
  [MATS_E[2]]: mats([7500, 6, 2, 0]),
  [MATS_E[3]]: mats([9100, 7, 3, 1]),
  [MATS_E[4]]: mats([12500, 9, 5, 2]),
  // Tier 4 ladder is cheaper; distinct so a wrong ladder shows up in the sums.
  [MATS_D[0]]: mats([2000, 2, 0, 0]),
  [MATS_D[1]]: mats([3300, 3, 1, 0]),
  [MATS_D[2]]: mats([6500, 4, 1, 0]),
  [MATS_D[3]]: mats([8200, 5, 2, 1]),
  [MATS_D[4]]: mats([10000, 7, 3, 1]),
};

function mats([glimmer, cores, prisms, shards]: number[]) {
  const materials = [
    { itemHash: GLIMMER_HASH, count: glimmer },
    { itemHash: ENHANCEMENT_CORE_HASH, count: cores },
    { itemHash: ENHANCEMENT_PRISM_HASH, count: prisms },
    { itemHash: ASCENDANT_SHARD_HASH, count: shards },
  ].filter((m) => m.count > 0);
  return { materials };
}

const plugSets: Record<number, object> = {
  [PLUG_SET]: {
    reusablePlugItems: [...D, ...E].map((plugItemHash) => ({ plugItemHash })),
  },
};

const tables: Record<string, Record<number, object>> = {
  DestinyInventoryItemDefinition: items,
  DestinyMaterialRequirementSetDefinition: materialSets,
  DestinyPlugSetDefinition: plugSets,
};

const manifest = {
  def: (table: string, hash: number | null | undefined) =>
    hash == null ? undefined : tables[table]?.[hash],
} as unknown as Manifest;

const def = {
  sockets: {
    socketEntries: Array.from({ length: SOCKET + 1 }, (_, i) =>
      i === SOCKET ? { reusablePlugSetHash: PLUG_SET } : {},
    ),
  },
} as unknown as Parameters<typeof readMasterwork>[1];

function profile(
  id: string,
  current: number,
  next?: number,
  extra: Record<string, unknown> = {},
): DestinyProfileResponse {
  const sockets = Array.from({ length: SOCKET + 1 }, (_, i) => ({
    plugHash: i === SOCKET ? current : 999,
  }));
  return {
    itemComponents: {
      sockets: { data: { [id]: { sockets } } },
      ...(next !== undefined
        ? {
            reusablePlugs: {
              data: { [id]: { plugs: { [SOCKET]: [{ plugItemHash: next }] } } },
            },
          }
        : {}),
      ...extra,
    },
  } as unknown as DestinyProfileResponse;
}

const ENERGY = { capacity: 11 };

test("masterwork plug level is the +N it grants to the six stats", () => {
  expect(masterworkPlugLevel(items[E[2]] as never)).toBe(3);
  expect(masterworkPlugLevel(items[E0] as never)).toBe(0);
  expect(masterworkPlugLevel(undefined)).toBe(0);
});

test("a level-2 Tier-5 piece sums the remaining three rungs of its own ladder", () => {
  const mw = readMasterwork("a", def, profile("a", E[1], E[2]), manifest, ENERGY, false);
  expect(mw).toEqual({
    level: 2,
    max: 5,
    cost: [
      { itemHash: GLIMMER_HASH, count: 7500 + 9100 + 12500 },
      { itemHash: ENHANCEMENT_CORE_HASH, count: 6 + 7 + 9 },
      { itemHash: ENHANCEMENT_PRISM_HASH, count: 2 + 3 + 5 },
      { itemHash: ASCENDANT_SHARD_HASH, count: 1 + 2 },
    ],
  });
});

test("the ladder is anchored on the game's next plug, not the socketed level-0 plug", () => {
  // Real-world: many Tier-5 drops carry the Tier-4 empty plug, while component 310
  // offers the Tier-5 level-1 plug. The Tier-5 ladder must win.
  const mw = readMasterwork("b", def, profile("b", D0, E[0]), manifest, ENERGY, false);
  expect(mw?.level).toBe(0);
  expect(mw?.cost).toEqual([
    { itemHash: GLIMMER_HASH, count: 2400 + 3500 + 7500 + 9100 + 12500 },
    { itemHash: ENHANCEMENT_CORE_HASH, count: 3 + 5 + 6 + 7 + 9 },
    { itemHash: ENHANCEMENT_PRISM_HASH, count: 1 + 2 + 2 + 3 + 5 },
    { itemHash: ASCENDANT_SHARD_HASH, count: 1 + 2 },
  ]);
});

test("a Tier-4 piece follows the Tier-4 ladder and stops where it ends", () => {
  const mw = readMasterwork("c", def, profile("c", D[3], D[4]), manifest, ENERGY, false);
  expect(mw).toEqual({
    level: 4,
    max: 5,
    cost: [
      { itemHash: GLIMMER_HASH, count: 10000 },
      { itemHash: ENHANCEMENT_CORE_HASH, count: 7 },
      { itemHash: ENHANCEMENT_PRISM_HASH, count: 3 },
      { itemHash: ASCENDANT_SHARD_HASH, count: 1 },
    ],
  });
});

test("a fully masterworked piece costs nothing and needs no reusable plugs", () => {
  expect(readMasterwork("d", def, profile("d", E[4]), manifest, ENERGY, false)).toEqual({
    level: 5,
    max: 5,
    cost: [],
  });
});

test("without component 310 the level is known but the cost is not", () => {
  expect(readMasterwork("e", def, profile("e", E[0]), manifest, ENERGY, false)).toEqual({
    level: 1,
    max: 5,
  });
});

test("a next plug missing from the plug set leaves the cost unknown", () => {
  expect(readMasterwork("f", def, profile("f", E[0], 777), manifest, ENERGY, false)).toEqual({
    level: 1,
    max: 5,
  });
});

test("legacy armor reads energy capacity as its level; only energy 10 is free", () => {
  const legacy = profile("g", 999); // no v460 plug in any socket
  expect(readMasterwork("g", def, legacy, manifest, { capacity: 10 }, true)).toEqual({
    level: 10,
    max: 10,
    cost: [],
  });
  expect(readMasterwork("g", def, legacy, manifest, { capacity: 4 }, true)).toEqual({
    level: 4,
    max: 10,
  });
  expect(readMasterwork("g", def, legacy, manifest, undefined, true)).toBeUndefined();
});

test("Armor 3.0 with an unreadable masterwork socket is unknown, not a finished legacy piece", () => {
  // Every Armor 3.0 masterwork plug below Tier 4 reports energy capacity 10, so
  // capacity can't stand in for the generation — the caller's flag decides.
  expect(
    readMasterwork("h", def, profile("h", 999), manifest, { capacity: 10 }, false),
  ).toBeUndefined();
  expect(
    readMasterwork("h", def, profile("h", 999), manifest, ENERGY, false),
  ).toBeUndefined();
});

test("the next rung is the plug at level+1, not reusablePlugs[0]", () => {
  // Component 310 lists every insertable plug; [0] is often the level-1 rung.
  const mw = readMasterwork(
    "i",
    def,
    profile("i", E[2], undefined, {
      reusablePlugs: {
        data: { i: { plugs: { [SOCKET]: E.map((plugItemHash) => ({ plugItemHash })) } } },
      },
    }),
    manifest,
    ENERGY,
    false,
  );
  expect(mw).toEqual({
    level: 3,
    max: 5,
    cost: [
      { itemHash: GLIMMER_HASH, count: 9100 + 12500 },
      { itemHash: ENHANCEMENT_CORE_HASH, count: 7 + 9 },
      { itemHash: ENHANCEMENT_PRISM_HASH, count: 3 + 5 },
      { itemHash: ASCENDANT_SHARD_HASH, count: 1 + 2 },
    ],
  });
});

test("no live sockets means no masterwork info at all", () => {
  expect(
    readMasterwork("zz", def, {} as DestinyProfileResponse, manifest, ENERGY, false),
  ).toBeUndefined();
});

test("sumMaterialStacks merges by material in glimmer→core→prism→shard order", () => {
  expect(
    sumMaterialStacks([
      [
        { itemHash: ASCENDANT_SHARD_HASH, count: 1 },
        { itemHash: GLIMMER_HASH, count: 100 },
      ],
      [
        { itemHash: GLIMMER_HASH, count: 50 },
        { itemHash: ENHANCEMENT_CORE_HASH, count: 0 },
        { itemHash: 42, count: 2 },
      ],
    ]),
  ).toEqual([
    { itemHash: GLIMMER_HASH, count: 150 },
    { itemHash: ASCENDANT_SHARD_HASH, count: 1 },
    { itemHash: 42, count: 2 },
  ]);
});

test("materialScore ranks by scarcity: a shard outweighs prisms, prisms outweigh cores, glimmer breaks ties", () => {
  const shard = materialScore([{ itemHash: ASCENDANT_SHARD_HASH, count: 1 }]);
  const prisms = materialScore([{ itemHash: ENHANCEMENT_PRISM_HASH, count: 9 }]);
  const cores = materialScore([{ itemHash: ENHANCEMENT_CORE_HASH, count: 9 }]);
  const glimmer = materialScore([{ itemHash: GLIMMER_HASH, count: 20000 }]);
  expect(shard).toBeGreaterThan(prisms);
  expect(prisms).toBeGreaterThan(cores);
  expect(cores).toBeGreaterThan(glimmer);
  expect(glimmer).toBeGreaterThan(0);
  expect(materialScore(undefined)).toBe(0);
  expect(materialScore([])).toBe(0);
});

test("isFullyMasterworked is only true at max level", () => {
  expect(isFullyMasterworked(undefined)).toBe(false);
  expect(isFullyMasterworked({})).toBe(false);
  expect(isFullyMasterworked({ masterwork: { level: 4, max: 5 } })).toBe(false);
  expect(isFullyMasterworked({ masterwork: { level: 5, max: 5, cost: [] } })).toBe(
    true,
  );
  expect(isFullyMasterworked({ masterwork: { level: 10, max: 10 } })).toBe(true);
});

test("summarizeMasterwork rolls pieces up, counting unknown costs separately", () => {
  const summary = summarizeMasterwork([
    { masterwork: { level: 5, max: 5, cost: [] } },
    {
      masterwork: {
        level: 3,
        max: 5,
        cost: [
          { itemHash: GLIMMER_HASH, count: 1000 },
          { itemHash: ENHANCEMENT_CORE_HASH, count: 4 },
        ],
      },
    },
    { masterwork: { level: 4, max: 10 } }, // legacy, cost unknown
    undefined, // piece missing from the armory
    {}, // no masterwork data
  ]);
  expect(summary).toEqual({
    cost: [
      { itemHash: GLIMMER_HASH, count: 1000 },
      { itemHash: ENHANCEMENT_CORE_HASH, count: 4 },
    ],
    remainingLevels: 2 + 6,
    unknownCostPieces: 1,
    unknownPieces: 2,
    complete: false,
  });
  expect(
    summarizeMasterwork([{ masterwork: { level: 5, max: 5, cost: [] } }]),
  ).toEqual({
    cost: [],
    remainingLevels: 0,
    unknownCostPieces: 0,
    unknownPieces: 0,
    complete: true,
  });
  expect(summarizeMasterwork([undefined, {}])).toEqual({
    cost: [],
    remainingLevels: 0,
    unknownCostPieces: 0,
    unknownPieces: 2,
    complete: false,
  });
  expect(summarizeMasterwork([])).toEqual({
    cost: [],
    remainingLevels: 0,
    unknownCostPieces: 0,
    unknownPieces: 0,
    complete: false,
  });
});
