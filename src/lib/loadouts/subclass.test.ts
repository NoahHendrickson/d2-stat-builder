import { expect, test } from "vitest";
import type { Manifest } from "../manifest/load";
import type { DimLoadoutItem } from "../dim/loadout-link";
import type { SavedLoadoutData } from "./types";
import { buildDimLoadoutUrl } from "../dim/loadout-link";
import { buildShareUrl, parseShareParam } from "./share";
import { resolveLoadout } from "./resolve";
import { STAT_HASHES } from "../armory/stats";
import { ABILITY_KINDS, SUPER_SOCKET_CATEGORY_HASH } from "../dim/subclasses";
import {
  abilitySocketIndex, selectedSubclassPlugs, subclassFragmentCapacity, subclassOptions,
  subclassSelectionValid, superSocketIndex, withLoadoutSubclass, withSubclassPlugs,
} from "./subclass";

// Real Prismatic aspect/fragment layout; abilities sit at 0–4 like the live items but in
// a shuffled order so the lookup is exercised. Small plug sets make cross-class leakage visible.
const subclassHash = 1616346845;
const SUPER_TYPE = 50;
const abilityType = { classAbility: 51, movement: 52, melee: 53, grenade: 54 } as const;
const socket = (empty: number, set: number, socketTypeHash?: number) => ({
  singleInitialItemHash: empty, reusablePlugSetHash: set, socketTypeHash,
});
const item = (name: string, stats: { statTypeHash: number; value: number }[] = []) => ({ displayProperties: { name, description: "" }, investmentStats: stats });
const items = {
  [subclassHash]: { ...item("Prismatic Titan"), sockets: { socketEntries: [
    socket(301, 12, SUPER_TYPE),
    socket(401, 13, abilityType.classAbility), socket(411, 14, abilityType.movement),
    // Grenade before melee, and a grenade socket with no initial plug (as on live Void items).
    socket(0, 16, abilityType.grenade), socket(421, 15, abilityType.melee),
    {}, {},
    socket(90, 10), socket(90, 10), ...Array(6).fill(socket(91, 11)),
  ] } },
  90: item("Empty Aspect Socket"), 91: item("Empty Fragment Socket"),
  401: item("Towering Barricade"), 402: item("Rally Barricade"),
  411: item("Strafe Lift"), 412: item("Catapult Lift"),
  421: item("Thunderclap"), 422: item("Frenzied Blade"),
  431: item("Shackle Grenade"), 432: item("Glacier Grenade"),
  101: item("Three-slot aspect", [{ statTypeHash: 2223994109, value: 3 }]),
  102: item("Two-slot aspect", [{ statTypeHash: 2223994109, value: 2 }]),
  103: item("Another class's aspect"),
  201: item("Stat fragment", [{ statTypeHash: STAT_HASHES.health, value: 10 }]),
  202: item("No-stat fragment"),
  203: item("Penalty fragment", [{ statTypeHash: STAT_HASHES.health, value: -10 }]),
  301: item("Fist of Havoc"), 302: item("Thundercrash"),
};
const tables: Record<string, Record<number, unknown>> = {
  DestinyInventoryItemDefinition: items,
  DestinyPlugSetDefinition: {
    10: { reusablePlugItems: [90, 101, 102].map((plugItemHash) => ({ plugItemHash })) },
    11: { reusablePlugItems: [91, 201, 202, 203].map((plugItemHash) => ({ plugItemHash })) },
    12: { reusablePlugItems: [301, 302].map((plugItemHash) => ({ plugItemHash })) },
    13: { reusablePlugItems: [401, 402].map((plugItemHash) => ({ plugItemHash })) },
    14: { reusablePlugItems: [411, 412].map((plugItemHash) => ({ plugItemHash })) },
    15: { reusablePlugItems: [421, 422].map((plugItemHash) => ({ plugItemHash })) },
    16: { reusablePlugItems: [431, 432].map((plugItemHash) => ({ plugItemHash })) },
  },
  DestinySocketTypeDefinition: {
    [SUPER_TYPE]: { socketCategoryHash: SUPER_SOCKET_CATEGORY_HASH },
    [abilityType.classAbility]: { plugWhitelist: [{ categoryIdentifier: "titan.prism.class_abilities" }] },
    [abilityType.movement]: { plugWhitelist: [{ categoryIdentifier: "titan.prism.movement" }] },
    [abilityType.melee]: { plugWhitelist: [{ categoryIdentifier: "titan.prism.melee" }] },
    [abilityType.grenade]: { plugWhitelist: [{ categoryIdentifier: "shared.prism.grenades" }] },
  },
};
const manifest = { def: (table: string, hash: number) => tables[table]?.[hash] } as unknown as Manifest;
const options = subclassOptions(manifest, 0, "Prismatic");
const base = (): SavedLoadoutData => ({
  version: 1,
  loadout: { id: "x", name: "Test", classType: 0, equipped: [{ id: "armor", hash: 1 }], unequipped: [], parameters: { mods: [5], assumeArmorMasterwork: 3 } },
});

test("super socket is the Super category, not class ability at index 0", () => {
  const classAbilityType = 51;
  const hunter = 2328211300;
  const local: Record<string, Record<number, unknown>> = {
    ...tables,
    DestinyInventoryItemDefinition: {
      ...items,
      [hunter]: { ...item("Arcstrider"), sockets: { socketEntries: [
        socket(400, 13, classAbilityType),
        {},
        socket(301, 12, SUPER_TYPE),
      ] } },
      400: { ...item("Marksman's Dodge"), plug: { plugCategoryIdentifier: "hunter.arc.class_abilities" } },
      301: { ...items[301], plug: { plugCategoryIdentifier: "hunter.arc.supers" } },
    },
    DestinySocketTypeDefinition: {
      [SUPER_TYPE]: { socketCategoryHash: SUPER_SOCKET_CATEGORY_HASH },
      [classAbilityType]: { socketCategoryHash: 1 },
    },
  };
  const m = { def: (table: string, hash: number) => local[table]?.[hash] } as unknown as Manifest;
  expect(superSocketIndex(m, hunter)).toBe(2);
  expect(subclassOptions(m, 1, "Arc").abilities.super.options.map((o) => o.hash).sort()).toEqual([301, 302]);
});

test("ability sockets are found by plug whitelist, then by the plugs they list", () => {
  expect(ABILITY_KINDS.map((kind) => abilitySocketIndex(manifest, subclassHash, kind))).toEqual([0, 1, 2, 4, 3]);
  expect(options.abilities.grenade.options.map((o) => o.hash).sort()).toEqual([431, 432]);
  expect(options.abilities.melee.options.map((o) => o.hash).sort()).toEqual([421, 422]);
  expect(options.abilities.grenade.emptyHash).toBeUndefined();
  // No socket types at all: fall back to the plug category of the socket's own plugs.
  const bare: Record<string, Record<number, unknown>> = {
    ...tables,
    DestinySocketTypeDefinition: {},
    DestinyInventoryItemDefinition: {
      ...items,
      [subclassHash]: { ...item("Prismatic Titan"), sockets: { socketEntries: [
        { singleInitialItemHash: 0, reusablePlugItems: [{ plugItemHash: 431 }] },
        { singleInitialItemHash: 421 },
      ] } },
      421: { ...items[421], plug: { plugCategoryIdentifier: "titan.prism.melee" } },
      431: { ...items[431], plug: { plugCategoryIdentifier: "shared.prism.grenades" } },
    },
  };
  const m = { def: (table: string, hash: number) => bare[table]?.[hash] } as unknown as Manifest;
  expect(abilitySocketIndex(m, subclassHash, "grenade")).toBe(0);
  expect(abilitySocketIndex(m, subclassHash, "melee")).toBe(1);
  expect(abilitySocketIndex(m, subclassHash, "movement")).toBeUndefined();
  expect(subclassOptions(m, 0, "Prismatic").abilities.movement.options).toEqual([]);
});

test("each ability is optional, single-choice, class-checked, and survives sharing and resolution", () => {
  let carrier: DimLoadoutItem = { hash: subclassHash };
  carrier = withSubclassPlugs(carrier, options.abilities.grenade, [432]);
  carrier = withSubclassPlugs(carrier, options.abilities.classAbility, [402]);
  expect(carrier.socketOverrides).toEqual({ 1: 402, 3: 432 });
  expect(subclassSelectionValid({ manifest, classType: 0 }, carrier)).toBe(true);
  expect(subclassSelectionValid({ manifest, classType: 0 }, withSubclassPlugs(carrier, options.abilities.melee, [103]))).toBe(false);
  expect(subclassSelectionValid({ manifest, classType: 0 }, withSubclassPlugs(carrier, options.abilities.melee, [432]))).toBe(false);
  const data = withLoadoutSubclass(base(), carrier, manifest);
  const saved = { ...data, id: "saved", createdAt: 1, updatedAt: 2 };
  const imported = parseShareParam(new URL(buildShareUrl("https://example.com", saved)).searchParams.get("import"));
  expect(imported?.loadout.equipped).toEqual(data.loadout.equipped);
  const resolved = resolveLoadout(data.loadout, new Map(), manifest);
  expect(resolved.subclass?.abilityHashes).toEqual({ classAbility: 402, grenade: 432 });
  expect(resolved.subclass?.superHash).toBeUndefined();
  carrier = withSubclassPlugs(carrier, options.abilities.grenade, []);
  expect(carrier.socketOverrides).toEqual({ 1: 402 });
});

test("catalog follows socket plug sets, includes non-stat fragments, excludes empty and other-class plugs", () => {
  expect(options.abilities.super.options.map((o) => o.hash).sort()).toEqual([301, 302]);
  expect(options.aspects.options.map((o) => o.hash).sort()).toEqual([101, 102]);
  expect(options.fragments.options.map((o) => o.hash).sort()).toEqual([201, 202, 203]);
  expect(options.aspects.options.find((o) => o.hash === 101)?.fragmentSlots).toBe(3);
});

test("selection writes correct Prismatic sockets, clears removed plugs, and preserves abilities", () => {
  let carrier: DimLoadoutItem = { hash: subclassHash, socketOverrides: { 0: 99 } };
  carrier = withSubclassPlugs(carrier, options.aspects, [101, 102]);
  carrier = withSubclassPlugs(carrier, options.fragments, [202, 201]);
  expect(carrier.socketOverrides).toEqual({ 0: 99, 7: 101, 8: 102, 9: 202, 10: 201, 11: 91, 12: 91, 13: 91, 14: 91 });
  carrier = withSubclassPlugs(carrier, options.fragments, [201]);
  expect(selectedSubclassPlugs(carrier, options.fragments)).toEqual([201]);
  expect(carrier.socketOverrides?.[10]).toBe(91);
  expect(subclassFragmentCapacity(carrier, options.aspects)).toBe(5);
});

test("validation enforces capacity, uniqueness, and class-compatible plugs", () => {
  const section = { manifest, classType: 0 };
  const carrier = withSubclassPlugs({ hash: subclassHash }, options.aspects, [102]);
  expect(subclassSelectionValid(section, withSubclassPlugs(carrier, options.fragments, [201, 202]))).toBe(true);
  expect(subclassSelectionValid(section, withSubclassPlugs(carrier, options.fragments, [201, 202, 203]))).toBe(false);
  expect(subclassSelectionValid(section, withSubclassPlugs(carrier, options.fragments, [201, 201]))).toBe(false);
  expect(subclassSelectionValid(section, withSubclassPlugs(carrier, options.aspects, [103]))).toBe(false);
  expect(subclassSelectionValid({ manifest, classType: 1 }, carrier)).toBe(false);
  expect(subclassFragmentCapacity({ hash: subclassHash }, options.aspects)).toBe(6);
  expect(subclassFragmentCapacity(withSubclassPlugs(carrier, options.aspects, []), options.aspects)).toBe(0);
});

test("add, replace, and remove the subclass without changing armor or mods", () => {
  const original = base();
  const added = withLoadoutSubclass(original, { hash: subclassHash }, manifest);
  expect(added.loadout.equipped).toHaveLength(2);
  const replaced = withLoadoutSubclass(added, { hash: 2932390016 }, manifest);
  expect(replaced.loadout.equipped).toEqual([{ id: "armor", hash: 1 }, { hash: 2932390016 }]);
  expect(withLoadoutSubclass(replaced, null, manifest)).toEqual(original);
  expect(original.loadout.equipped).toHaveLength(1);
});

test("aspects and fragments survive save parsing, sharing, DIM export, and display resolution", () => {
  const carrier = withSubclassPlugs(
    withSubclassPlugs(withSubclassPlugs({ hash: subclassHash }, options.abilities.super, [302]), options.aspects, [101, 102]),
    options.fragments,
    [201, 202],
  );
  const data = withLoadoutSubclass(base(), carrier, manifest);
  const saved = { ...data, id: "saved", createdAt: 1, updatedAt: 2 };
  const imported = parseShareParam(new URL(buildShareUrl("https://example.com", saved)).searchParams.get("import"));
  expect(imported?.loadout.equipped).toEqual(data.loadout.equipped);
  expect(JSON.parse(new URL(buildDimLoadoutUrl(data.loadout)).searchParams.get("loadout")!).equipped).toEqual(data.loadout.equipped);
  const resolved = resolveLoadout(data.loadout, new Map(), manifest);
  expect(resolved.subclass?.superHash).toBe(302);
  expect(resolved.subclass?.aspectHashes).toEqual([101, 102]);
  expect(resolved.subclass?.fragmentHashes).toEqual([201, 202]);
  expect(resolved.armor).toHaveLength(1);
});

test("super is a single socket that can be cleared", () => {
  let carrier: DimLoadoutItem = { hash: subclassHash };
  carrier = withSubclassPlugs(carrier, options.abilities.super, [302]);
  expect(selectedSubclassPlugs(carrier, options.abilities.super)).toEqual([302]);
  expect(subclassSelectionValid({ manifest, classType: 0 }, carrier)).toBe(true);
  expect(subclassSelectionValid({ manifest, classType: 0 }, withSubclassPlugs(carrier, options.abilities.super, [103]))).toBe(false);
  carrier = withSubclassPlugs(carrier, options.abilities.super, []);
  expect(carrier.socketOverrides?.[0]).toBeUndefined();
  expect(selectedSubclassPlugs(carrier, options.abilities.super)).toEqual([]);
});

test("fragment changes rebuild capped stats and keep the builder snapshot in sync", () => {
  const data = base();
  const zero = [0, 0, 0, 0, 0, 0];
  data.builder = { targets: zero, major: 0, setReqs: {}, exoticName: null, exoticPerks: [null, null], allowTuning: true, balancedTuning: true, legacyExotics: true, activeSubclass: "Arc", fragmentHashes: [201] };
  data.optimizer = { pieceIds: [], baseStats: [0, 195, 0, 0, 0, 0], stats: [0, 200, 0, 0, 0, 0], tuningBonus: zero, tuning: [], modBonus: zero, modsUsed: { major: 0, minor: 0 }, artificeBonus: zero, artifice: [], total: 200, exotic: false };
  const result = withLoadoutSubclass(data, withSubclassPlugs({ hash: subclassHash }, options.fragments, [203]), manifest);
  expect(result.optimizer?.stats[1]).toBe(185);
  expect(result.optimizer?.total).toBe(185);
  expect(result.builder?.activeSubclass).toBe("Prismatic");
  expect(result.builder?.fragmentHashes).toEqual([203]);
  expect(withLoadoutSubclass(result, null, manifest).builder?.fragmentHashes).toEqual([]);
});
