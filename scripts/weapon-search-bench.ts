import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createWeaponCatalog } from "../src/lib/weapons/catalog";
import { expandWeaponIndex } from "../src/lib/weapons/transport";
import { buildWeaponNameIndex } from "../src/lib/weapons/weapon-name-index";
import { createWeaponSearcher } from "../src/lib/weapons/weapon-searcher";
import { collapseWeaponVersions } from "../src/lib/weapons/weapon-variants";
import {
  filterWeapons,
  rankWeaponResults,
  weaponsMatchingTextQuery,
  type WeaponFilters,
} from "../src/lib/weapons/search";
import {
  mergeWeaponFilters,
  planWeaponTextSearch,
} from "../src/lib/weapons/query-language";

const raw = expandWeaponIndex(
  JSON.parse(readFileSync("public/data/weapons.json", "utf8")),
);
const catalog = createWeaponCatalog(raw);
const names = buildWeaponNameIndex(raw.weapons);
const searcher = createWeaponSearcher(raw.weapons);
const cases: [string, WeaponFilters][] = [
  ["", {}],
  ["", { element: ["Solar"] }],
  ["", { type: ["Hand Cannon"] }],
  ["fatebringer", {}],
  ["incandescent", {}],
  ["type:hc element:solar", {}],
  ['perk:"Heal Clip"', {}],
  ["", { trait1: ["Reconstruction"], trait2: ["Bait and Switch"] }],
  ["", { perkCombo: ["Heal Clip", "Incandescent"] }],
  ["", { trait1DamagePerks: true }],
  ["", { source: ["Pantheon"] }],
  ["is:craftable", { customPerkGroups: [["Firefly", "Incandescent"]] }],
];
function original(query: string, filters: WeaponFilters) {
  const plan = planWeaponTextSearch(query);
  const candidates = weaponsMatchingTextQuery(
    raw.weapons,
    searcher,
    plan.searchText,
    raw.weapons.length,
    names,
  );
  const filtered = filterWeapons(
    candidates,
    mergeWeaponFilters(filters, plan.filters),
    raw.perks,
  );
  return collapseWeaponVersions(
    rankWeaponResults(filtered, plan.searchText, "season-desc", names),
    names.byName,
  );
}
for (const [query, filters] of cases) {
  assert.deepEqual(
    catalog
      .search(query, filters, "season-desc")
      .map((w) => w.hash)
      .sort(),
    original(query, filters)
      .map((w) => w.hash)
      .sort(),
    `Result parity: ${query} ${JSON.stringify(filters)}`,
  );
}
function measure(search: (query: string, filters: WeaponFilters) => unknown) {
  for (const [query, filters] of cases) search(query, filters);
  const start = performance.now();
  for (let run = 0; run < 20; run++)
    for (const [query, filters] of cases) search(query, filters);
  return (performance.now() - start) / (20 * cases.length);
}
console.log(
  `Result parity passed for ${cases.length} scenarios across ${raw.weapons.length} catalog entries.`,
);
console.log(
  `Original search pipeline: ${measure(original).toFixed(2)} ms/search`,
);
console.log(
  `Optimized warm pipeline: ${measure((query, filters) => catalog.search(query, filters, "season-desc")).toFixed(2)} ms/search`,
);
