import { test, expect } from "vitest";
import { dedupeModOptions, getModCatalog, isExcludedModName, type ModOption } from "./mod-options";
import { GENERAL_MOD_CATEGORY, STAT_HASHES } from "@/lib/armory/stats";
import type { ArmorPiece, ArmorSocket } from "@/lib/armory/normalize";
import type { Manifest } from "@/lib/manifest/load";

const opt = (hash: number, name: string, cost: number, artifactOnly = false): ModOption => ({
  hash,
  name,
  label: name,
  cost,
  stackable: true,
  artifactOnly,
});

const siphon3 = opt(1, "Arc Siphon", 3);
const siphon1 = opt(2, "Arc Siphon", 1, true);
const dynamo = opt(3, "Dynamo", 1);

test("dedupeModOptions shows the full-cost copy when insertability is unknown", () => {
  expect(dedupeModOptions([siphon1, siphon3, dynamo]).map((o) => o.hash)).toEqual([3, 1]);
});

test("dedupeModOptions prefers the copy the player can insert", () => {
  expect(dedupeModOptions([siphon3, siphon1, dynamo], new Set([2, 3])).map((o) => o.hash)).toEqual([
    2, 3,
  ]);
  // Neither copy insertable → fall back to the full-cost one rather than hiding the mod.
  expect(dedupeModOptions([siphon3, siphon1], new Set([3])).map((o) => o.hash)).toEqual([1]);
});

test("dedupeModOptions drops exact hash repeats", () => {
  expect(dedupeModOptions([dynamo, dynamo])).toHaveLength(1);
});

test("isExcludedModName hides Curse of Riven leftovers", () => {
  expect(isExcludedModName("Curse of Riven")).toBe(true);
  expect(isExcludedModName("Riven's Curse")).toBe(true);
  expect(isExcludedModName("Arc Siphon")).toBe(false);
});


test("a stat mod's full-cost and artifact copies stay one tile, labelled by its gain", () => {
  // Live data: the artifact copy invests only energy; its +10 is on the shared sandbox perk.
  const plug = { plugCategoryIdentifier: GENERAL_MOD_CATEGORY, insertionRules: [] };
  const items: Record<number, object> = {
    1435557120: {
      displayProperties: { name: "Grenade Mod", description: "" },
      collectibleHash: 1,
      plug: { ...plug, energyCost: { energyCost: 3 } },
      perks: [{ perkHash: 4234432032 }],
      investmentStats: [{ statTypeHash: 3578062600, value: 3 }, { statTypeHash: STAT_HASHES.grenade, value: 10 }],
    },
    3896141096: {
      displayProperties: { name: "Grenade Mod", description: "" },
      plug: { ...plug, energyCost: { energyCost: 1 } },
      perks: [{ perkHash: 4234432032 }],
      investmentStats: [{ statTypeHash: 3578062600, value: 1 }],
    },
  };
  const plugSet = { reusablePlugItems: Object.keys(items).map((h) => ({ plugItemHash: Number(h) })) };
  const tables: Record<string, Record<number, object>> = {
    DestinyInventoryItemDefinition: items,
    DestinyPlugSetDefinition: { 731468111: plugSet },
  };
  const manifest = {
    def: (t: string, h: number | undefined) => (h == null ? undefined : tables[t]?.[h]),
    all: (t: string) => tables[t] ?? {},
  } as unknown as Manifest;
  const socket = { kind: "general", plugSetHash: 731468111 } as ArmorSocket;
  const piece = {} as ArmorPiece;
  const catalog = getModCatalog(manifest);

  const shown = catalog.optionsFor(piece, socket, new Set([1435557120]));
  expect(shown.map((o) => [o.hash, o.label])).toEqual([[1435557120, "+10 Grenade"]]);
  expect(shown[0].description).toBeUndefined();
  expect(catalog.option(3896141096)?.label).toBe("+10 Grenade");
});
