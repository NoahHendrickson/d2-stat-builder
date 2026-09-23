// Builds a synthetic Warlock profile (63 armor pieces) from the live manifest for the
// startup bench. Needs NEXT_PUBLIC_BUNGIE_API_KEY (read from .env.local). The 200 MB item
// table is cached in /tmp/d2-startup-bench between runs.
//
//   node scripts/startup-bench/fixture.mjs   → scripts/startup-bench/.profile.json (gitignored)
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
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

const items = [], instances = {}, stats = {}, sockets = {}, reusable = {};
let n = 0;
const roll = (i) => { const v = [30, 25, 20, 10, 5, 5]; const r = [...v.slice(i % 6), ...v.slice(0, i % 6)]; return Object.fromEntries(ORDER.map((h, k) => [h, { value: r[k] }])); };
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
