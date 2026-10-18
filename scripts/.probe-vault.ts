// Throwaway probe: how many sampled PvE players have a public vault, and what a full-profile read yields.
import { loadEnvConfig } from "@next/env";
import { readFile } from "node:fs/promises";
import { popularityLookup, type PopularityCatalog } from "../src/lib/weapons/perk-popularity";

loadEnvConfig(process.cwd());
const key = process.env.NEXT_PUBLIC_BUNGIE_API_KEY!;
const PLAYERS = Number(process.argv[2] ?? 120);
const WEAPON_BUCKETS = new Set([1498876634, 2465295065, 953998645]);
const VAULT = 138197802;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let next = 0;
let bytes = 0;
async function get<T>(url: string): Promise<T | undefined> {
  const at = Math.max(Date.now(), next);
  next = at + 160;
  await sleep(at - Date.now());
  const r = await fetch(url, { headers: { "X-API-Key": key } });
  const text = await r.text();
  bytes += text.length;
  try {
    const b = JSON.parse(text);
    return b.ErrorCode === 1 ? b.Response : undefined;
  } catch {
    return undefined;
  }
}
const pgcr = (id: number) => get<any>(`https://stats.bungie.net/Platform/Destiny2/Stats/PostGameCarnageReport/${id}/`);

async function main() {
  const catalog = JSON.parse(await readFile("public/data/weapons.json", "utf8")) as PopularityCatalog;
  const lookup = popularityLookup(catalog);
  let lo = 10_000_000_000, hi = 40_000_000_000;
  while (hi - lo > 20_000) {
    const m = Math.floor((lo + hi) / 2);
    if (await pgcr(m)) lo = m; else hi = m;
  }
  const newest = lo;
  console.log("newest ~", newest);
  const seen = new Set<string>();
  const rows: any[] = [];
  while (rows.length < PLAYERS) {
    const report = await pgcr(newest - Math.floor(Math.random() * 150_000));
    if (!report) continue;
    const modes: number[] = report.activityDetails.modes ?? [report.activityDetails.mode];
    if (modes.includes(5)) continue;
    for (const entry of report.entries) {
      if (rows.length >= PLAYERS) break;
      const u = entry.player?.destinyUserInfo;
      const used = new Set<number>((entry.extended?.weapons ?? []).map((w: any) => w.referenceId).filter((h: number) => lookup.has(h)));
      if (!u?.membershipId || used.size === 0 || seen.has(u.membershipId)) continue;
      seen.add(u.membershipId);
      const before = bytes;
      const t = Date.now();
      const p = await get<any>(
        `https://www.bungie.net/Platform/Destiny2/${u.membershipType}/Profile/${u.membershipId}/?components=102,201,205,305`,
      );
      if (!p) continue;
      const ms = Date.now() - t;
      const sockets = p.itemComponents?.sockets?.data ?? {};
      const vaultPublic = p.profileInventory?.privacy === 1 && !!p.profileInventory?.data;
      const invPublic = p.characterInventories?.privacy === 1 && !!p.characterInventories?.data;
      const equippedHere = (p.characterEquipment?.data?.[entry.characterId]?.items ?? []) as any[];
      const usedCopies = equippedHere.filter((i) => WEAPON_BUCKETS.has(i.bucketHash) && used.has(i.itemHash) && sockets[i.itemInstanceId]).length;
      const all: any[] = [
        ...(p.profileInventory?.data?.items ?? []),
        ...Object.values(p.characterInventories?.data ?? {}).flatMap((c: any) => c.items),
        ...Object.values(p.characterEquipment?.data ?? {}).flatMap((c: any) => c.items),
      ];
      const owned = all.filter((i) => i.itemInstanceId && lookup.has(i.itemHash) && sockets[i.itemInstanceId]);
      const inVault = owned.filter((i) => i.bucketHash === VAULT).length;
      const distinct = new Set(owned.map((i) => i.itemHash)).size;
      rows.push({ vaultPublic, invPublic, usedCopies, owned: owned.length, inVault, distinct, kb: Math.round((bytes - before) / 1024), ms });
      process.stdout.write(".");
    }
  }
  console.log();
  const pub = rows.filter((r) => r.vaultPublic);
  const sum = (a: any[], k: string) => a.reduce((s, r) => s + r[k], 0);
  const med = (a: number[]) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];
  console.log({
    players: rows.length,
    vaultPublic: pub.length,
    invPublic: rows.filter((r) => r.invPublic).length,
    usedCopiesPerPlayer: (sum(rows, "usedCopies") / rows.length).toFixed(2),
    ownedCopiesPerPublicPlayer: pub.length ? (sum(pub, "owned") / pub.length).toFixed(1) : 0,
    medianOwnedPublic: pub.length ? med(pub.map((r) => r.owned)) : 0,
    distinctWeaponsPerPublicPlayer: pub.length ? (sum(pub, "distinct") / pub.length).toFixed(1) : 0,
    ownedCopiesPerPlayerAll: (sum(rows, "owned") / rows.length).toFixed(1),
    medianKbPublic: pub.length ? med(pub.map((r) => r.kb)) : 0,
    medianKbPrivate: rows.length - pub.length ? med(rows.filter((r) => !r.vaultPublic).map((r) => r.kb)) : 0,
    medianMs: med(rows.map((r) => r.ms)),
  });
}
main();
