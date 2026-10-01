// Builds synthetic profiles from the live manifest for the benches. Needs
// NEXT_PUBLIC_BUNGIE_API_KEY (read from .env.local). The 200 MB item table is cached in
// /tmp/d2-startup-bench between runs.
//
//   node scripts/startup-bench/fixture.mjs        → .profile.json: one Hunter, 63 armor pieces
//   node scripts/startup-bench/fixture.mjs full   → .profile-full.json: three characters with
//       full slots and a ~700-item vault (weapons, armor of every class, ghosts, sparrows,
//       ships) plus consumables and mods, for the Items page and the navigation bench
// Both are gitignored.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(here, "../../.env.local"), "utf8");
const apiKey = /NEXT_PUBLIC_BUNGIE_API_KEY=(\S+)/.exec(env)?.[1]?.replace(/^["']|["']$/g, "");
if (!apiKey) throw new Error("NEXT_PUBLIC_BUNGIE_API_KEY not found in .env.local");

const cacheDir = "/tmp/d2-startup-bench";
fs.mkdirSync(cacheDir, { recursive: true });
const info = await (await fetch("https://www.bungie.net/Platform/Destiny2/Manifest/", { headers: { "X-API-Key": apiKey } })).json();
const itemPath = info.Response.jsonWorldComponentContentPaths.en.DestinyInventoryItemDefinition;
const cached = path.join(cacheDir, path.basename(itemPath));
if (!fs.existsSync(cached)) {
  console.log("downloading item table…");
  fs.writeFileSync(cached, Buffer.from(await (await fetch(`https://www.bungie.net${itemPath}`)).arrayBuffer()));
}
const defs = Object.values(JSON.parse(fs.readFileSync(cached, "utf8")));

const statsSrc = fs.readFileSync(path.join(here, "../../src/lib/armory/stats.ts"), "utf8");
const H = {};
for (const m of statsSrc.matchAll(/^\s+(weapons|health|class|grenade|super|melee):\s*(\d+),/gm)) H[m[1]] = Number(m[2]);
const ORDER = [H.weapons, H.health, H.class, H.grenade, H.super, H.melee];
const BUCKETS = [3448274439, 3551918588, 14239492, 20886954, 1585787867];
const TUNING = "core.gear_systems.armor_tiering.plugs.tuning.mods";
const tuning = defs.find((d) => d.plug?.plugCategoryIdentifier === TUNING && d.investmentStats?.some((s) => s.statTypeHash === H.weapons && s.value === 5));

if (process.argv[2] === "full") {
  writeFull();
  process.exit(0);
}

const items = [], instances = {}, stats = {}, sockets = {}, reusable = {};
let n = 0;
const roll =(i) => { const v = [30, 25, 20, 10, 5, 5]; const r = [...v.slice(i % 6), ...v.slice(0, i % 6)]; return Object.fromEntries(ORDER.map((h, k) => [h, { value: r[k] }])); };
const add = (def) => {
  const id = `inst${++n}`;
  items.push({ itemHash: def.hash, itemInstanceId: id, bucketHash: def.inventory.bucketTypeHash, quantity: 1, location: 1 });
  instances[id] = { primaryStat: { value: 450 }, gearTier: 5, energy: { energyCapacity: 10, energyUsed: 0 } };
  stats[id] = { stats: roll(n) };
  sockets[id] = { sockets: [] };
  reusable[id] = { plugs: { 14: [{ plugItemHash: tuning.hash }] } };
};
const armor = (tier, bucket) => defs.filter((d) => d.itemType === 2 && d.classType === 1 && d.inventory?.tierType === tier && d.inventory.bucketTypeHash === bucket && !d.redacted && d.displayProperties?.name);
for (const b of BUCKETS) for (const d of armor(5, b).slice(0, 12)) add(d);
for (const d of armor(6, 14239492).slice(0, 3)) add(d);

const profile = {
  profile: { data: { currentSeasonHash: 0 } },
  characters: { data: { c1: { characterId: "c1", classType: 1, light: 450, emblemBackgroundPath: "/common/destiny2_content/icons/x.jpg", dateLastPlayed: "2026-09-22T00:00:00Z" } } },
  characterEquipment: { data: { c1: { items: items.slice(0, 5) } } },
  characterInventories: { data: { c1: { items: items.slice(5, 20) } } },
  profileInventory: { data: { items: items.slice(20) } },
  itemComponents: { instances: { data: instances }, stats: { data: stats }, sockets: { data: sockets }, reusablePlugs: { data: reusable } },
};
fs.writeFileSync(path.join(here, ".profile.json"), JSON.stringify(profile));
console.log(`wrote ${items.length} pieces to scripts/startup-bench/.profile.json`);

/** Three characters with every slot full and a vault of weapons, armor, and general gear. */
function writeFull() {
  const VAULT = 138197802;
  const WEAPON_BUCKETS = [1498876634, 2465295065, 953998645];
  const GEAR_BUCKETS = [4023194814, 2025709351, 284967655];
  const usable = (d) => !d.redacted && d.displayProperties?.name && d.displayProperties.icon;
  const instances = {}, stats = {}, sockets = {}, reusable = {};
  let n = 0;
  const roll = (i) => { const v = [30, 25, 20, 10, 5, 5]; const r = [...v.slice(i % 6), ...v.slice(0, i % 6)]; return Object.fromEntries(ORDER.map((h, k) => [h, { value: r[k] }])); };
  // One instanced item of `def`; `bucket` is where it sits (its own slot, or the vault).
  const add = (def, bucket = def.inventory.bucketTypeHash) => {
    const id = `inst${++n}`;
    const isArmor = def.itemType === 2;
    instances[id] = isArmor
      ? { primaryStat: { value: 450 }, gearTier: 5, energy: { energyCapacity: 10, energyUsed: 0 } }
      : { primaryStat: { value: 400 + (n % 51) }, gearTier: 1 + (n % 5), damageTypeHash: def.defaultDamageTypeHash };
    sockets[id] = { sockets: [] };
    if (isArmor) {
      stats[id] = { stats: roll(n) };
      reusable[id] = { plugs: { 14: [{ plugItemHash: tuning.hash }] } };
    }
    // Every seventh masterworked, every fifth locked: both draw differently on a tile.
    const state = (n % 7 === 0 ? 4 : 0) | (n % 5 === 0 ? 1 : 0);
    return { itemHash: def.hash, itemInstanceId: id, bucketHash: bucket, quantity: 1, location: 1, state };
  };
  const armor = (classType, tier, bucket) => defs.filter((d) => d.itemType === 2 && d.classType === classType && d.inventory?.tierType === tier && d.inventory.bucketTypeHash === bucket && usable(d));
  // Newest first (the table is roughly in release order), one per name.
  const weapons = (bucket, tier) => {
    const seen = new Set();
    return defs
      .filter((d) => d.itemType === 3 && d.inventory?.tierType === tier && d.inventory.bucketTypeHash === bucket && usable(d) && d.defaultDamageTypeHash)
      .reverse()
      .filter((d) => !seen.has(d.displayProperties.name) && seen.add(d.displayProperties.name));
  };
  const gear = (bucket) => defs.filter((d) => d.inventory?.bucketTypeHash === bucket && d.equippable && usable(d));

  const chars = [["c1", 1, "2026-09-22T00:00:00Z"], ["c2", 0, "2026-09-21T00:00:00Z"], ["c3", 2, "2026-09-20T00:00:00Z"]];
  const equipment = {}, inventories = {}, vault = [];
  chars.forEach(([id, classType], c) => {
    // Per slot: one equipped and nine carried; each character takes its own run of weapons.
    const equipped = [], carried = [];
    const fill = (list) => list.forEach((d, i) => (i ? carried : equipped).push(add(d)));
    for (const b of WEAPON_BUCKETS) fill(weapons(b, 5).slice(c * 10, c * 10 + 10));
    for (const b of BUCKETS) fill(armor(classType, 5, b).slice(0, 10));
    for (const b of GEAR_BUCKETS) fill(gear(b).slice(c * 4, c * 4 + 4));
    equipment[id] = { items: equipped };
    inventories[id] = { items: carried };
  });
  for (const b of WEAPON_BUCKETS) {
    for (const d of weapons(b, 5).slice(30, 150)) vault.push(add(d, VAULT));
    for (const d of weapons(b, 6).slice(0, 12)) vault.push(add(d, VAULT));
    // Second copies of some, as a real vault has.
    for (const d of weapons(b, 5).slice(30, 50)) vault.push(add(d, VAULT));
  }
  for (const [, classType] of chars) {
    for (const b of BUCKETS) {
      for (const d of armor(classType, 5, b).slice(10, 24)) vault.push(add(d, VAULT));
      for (const d of armor(classType, 6, b).slice(0, 2)) vault.push(add(d, VAULT));
    }
  }
  for (const b of GEAR_BUCKETS) for (const d of gear(b).slice(12, 22)) vault.push(add(d, VAULT));
  const stacks = (bucket, take) =>
    defs
      .filter((d) => d.inventory?.bucketTypeHash === bucket && usable(d) && !d.equippable)
      .slice(0, take)
      .map((d, i) => ({ itemHash: d.hash, bucketHash: bucket, quantity: 1 + ((i * 37) % 250), location: 1 }));

  const profile = {
    profile: { data: { currentSeasonHash: 0 } },
    characters: { data: Object.fromEntries(chars.map(([id, classType, played]) => [id, { characterId: id, classType, light: 450, emblemBackgroundPath: "/common/destiny2_content/icons/x.jpg", dateLastPlayed: played }])) },
    characterEquipment: { data: equipment },
    characterInventories: { data: inventories },
    profileInventory: { data: { items: [...vault, ...stacks(1469714392, 40), ...stacks(3313201758, 30)] } },
    itemComponents: { instances: { data: instances }, stats: { data: stats }, sockets: { data: sockets }, reusablePlugs: { data: reusable } },
  };
  fs.writeFileSync(path.join(here, ".profile-full.json"), JSON.stringify(profile));
  console.log(`wrote ${n} instanced items (${vault.length} in the vault) to scripts/startup-bench/.profile-full.json`);
}
