import { expect, test } from "vitest";
import { BUCKETS } from "./buckets";
import type { InventoryItem, ManagerInventory } from "./build";
import { dupeHashes, matchItems, parseSearch, type SearchContext } from "./search";

const item = (key: string, extra: Partial<InventoryItem> = {}): InventoryItem => ({
  key,
  instanceId: key,
  itemHash: key.length,
  name: key,
  typeName: "Hand Cannon",
  itemType: 3,
  classType: 3,
  tierType: 5,
  bucketHash: BUCKETS.kinetic,
  quantity: 1,
  locked: false,
  masterworked: false,
  crafted: false,
  enhanced: false,
  deepsight: false,
  transferStatus: 0,
  ...extra,
});

const inv: ManagerInventory = {
  characters: [
    {
      id: "c",
      classType: 1,
      light: 0,
      emblemBackgroundPath: "",
      emblemPath: "",
      dateLastPlayed: "",
      stats: {},
      equipped: { [BUCKETS.kinetic]: item("Ace of Spades", { tierType: 6, power: 410, element: "kinetic", locked: true }) },
      inventory: {
        [BUCKETS.energy]: [item("Calus Mini-Tool", { bucketHash: BUCKETS.energy, power: 400, element: "solar", typeName: "Submachine Gun", crafted: true, breakerType: 2 })],
      },
      postmaster: [],
    },
  ],
  vault: {
    [BUCKETS.helmet]: [
      item("Helm A", { itemType: 2, itemHash: 99, classType: 1, bucketHash: BUCKETS.helmet, typeName: "Helmet", stats: { total: 72, health: 30 }, gearTier: 5 }),
      item("Helm B", { itemType: 2, itemHash: 99, classType: 0, bucketHash: BUCKETS.helmet, typeName: "Helmet", stats: { total: 58, health: 10 }, gearTier: 3 }),
    ],
  },
  vaultCount: 2,
  account: {},
  accountCapacity: {},
  currencies: [],
};

const ctx: SearchContext = {
  annotations: { "Helm B": { tag: "junk", notes: "Great for #pvp" }, "Calus Mini-Tool": { tag: "keep" } },
  perks: (i) => (i.key === "Calus Mini-Tool" ? ["incandescent", "grave robber"] : []),
  dupes: dupeHashes(inv),
};

function search(query: string): string[] {
  const parsed = parseSearch(query);
  if (!parsed?.ok) throw new Error(parsed ? parsed.error : "empty");
  return [...matchItems(inv, parsed.predicate, ctx)].sort();
}

test("filters by keywords, tags, comparisons, stats, and places", () => {
  expect(search("is:weapon")).toEqual(["Ace of Spades", "Calus Mini-Tool"]);
  expect(search("is:exotic")).toEqual(["Ace of Spades"]);
  expect(search("tag:junk")).toEqual(["Helm B"]);
  expect(search("is:keep")).toEqual(["Calus Mini-Tool"]);
  expect(search("tag:none")).toEqual(["Ace of Spades", "Helm A"]);
  expect(search("power:>=405")).toEqual(["Ace of Spades"]);
  expect(search("stat:total:>60")).toEqual(["Helm A"]);
  expect(search("stat:health:<=10")).toEqual(["Helm B"]);
  expect(search("tier:5")).toEqual(["Helm A"]);
  expect(search("is:equipped")).toEqual(["Ace of Spades"]);
  expect(search("is:invault is:titan")).toEqual(["Helm B"]);
  expect(search("is:dupe")).toEqual(["Helm A", "Helm B"]);
  expect(search("is:crafted is:overload element:solar")).toEqual(["Calus Mini-Tool"]);
  expect(search("type:submachinegun")).toEqual(["Calus Mini-Tool"]);
  expect(search("is:locked")).toEqual(["Ace of Spades"]);
});

test("free text matches names, perks, and notes; #tags match notes", () => {
  expect(search("ace")).toEqual(["Ace of Spades"]);
  expect(search('"grave robber"')).toEqual(["Calus Mini-Tool"]);
  expect(search("perk:incandescent")).toEqual(["Calus Mini-Tool"]);
  expect(search("#pvp")).toEqual(["Helm B"]);
  expect(search("great")).toEqual(["Helm B"]);
});

test("supports or, negation, and grouping", () => {
  expect(search("is:exotic or tag:junk")).toEqual(["Ace of Spades", "Helm B"]);
  expect(search("-is:weapon")).toEqual(["Helm A", "Helm B"]);
  expect(search("not:weapon is:hunter")).toEqual(["Helm A"]);
  expect(search("is:armor (tag:junk or stat:total:>70)")).toEqual(["Helm A", "Helm B"]);
  expect(search("not (is:armor or is:exotic)")).toEqual(["Calus Mini-Tool"]);
});

test("reports mistakes instead of matching nothing", () => {
  expect(parseSearch("")).toBeNull();
  expect(parseSearch("is:bogus")).toEqual({ ok: false, error: "Unknown filter is:bogus" });
  expect(parseSearch("power:lots")?.ok).toBe(false);
  expect(parseSearch("(is:weapon")?.ok).toBe(false);
  expect(parseSearch("stat:total")?.ok).toBe(false);
});
