// A weapon instance's roll for the manager's detail panel: frame, perk columns (the
// equipped perk plus the options it rolled with), mods, and its live stats. Read from
// the profile's sockets (305), reusable plugs (310), and stats (304) against the
// manifest's plug and stat definitions.
import type { DestinyProfileResponse } from "bungie-api-ts/destiny2";
import type { Manifest } from "@/lib/manifest/load";
import { WEAPON_STAT_NUMBERS, WEAPON_STAT_ORDER } from "@/lib/weapons/stat-order";

export interface DetailPlug {
  hash: number;
  name: string;
  icon?: string;
  description?: string;
  /** An enhanced perk (the game marks it with a gold arrow). */
  enhanced?: boolean;
}

export interface PerkColumn {
  socketIndex: number;
  /** The plug in the socket now. */
  current: DetailPlug;
  /** Everything this socket rolled with (current included), in Bungie's order. */
  options: DetailPlug[];
  /** The origin trait column. */
  origin: boolean;
  /** Plug category, e.g. "barrels", "magazines", or "frames" for the left and right traits. */
  category: string;
  /** What the game calls this column's perks ("Barrel", "Magazine", "Trait"), unenhanced. */
  typeName: string;
}

export type ModKind = "masterwork" | "mod" | "shader" | "ornament";

export interface WeaponRoll {
  frame?: DetailPlug;
  columns: PerkColumn[];
  mods: (DetailPlug & { kind: ModKind; stat?: MasterworkStat })[];
}

/** The stat a weapon is masterworked in ("Range"), from its masterwork plug. */
export interface MasterworkStat {
  hash: number;
  name: string;
}

export interface ItemStat {
  hash: number;
  name: string;
  value: number;
}

/** Plug categories of a weapon's rollable perk sockets (barrels through origin traits). */
const PERK_CATEGORIES = new Set([
  "barrels",
  "magazines",
  "magazines_gl",
  "frames",
  "origins",
  "scopes",
  "stocks",
  "grips",
  "blades",
  "guards",
  "batteries",
  "arrows",
  "tubes",
  "bowstrings",
  "hafts",
  "rails",
  "bolts",
]);
const INTRINSIC_CATEGORY = "intrinsics";

function modKind(category: string): ModKind | undefined {
  if (category.includes("masterworks.stat")) return "masterwork";
  if (category.startsWith("v400.weapon.mod_")) return "mod";
  if (category === "shader") return "shader";
  if (category.includes("skins") || category.includes("ornament")) return "ornament";
  return undefined;
}

function plugInfo(manifest: Manifest, hash: number): DetailPlug | undefined {
  const def = manifest.def("DestinyInventoryItemDefinition", hash);
  if (!def) return undefined;
  return {
    hash,
    name: def.displayProperties?.name || "Unknown",
    ...(def.displayProperties?.icon ? { icon: def.displayProperties.icon } : {}),
    ...(def.displayProperties?.description ? { description: def.displayProperties.description } : {}),
    ...(/\benhanced\b/i.test(def.itemTypeDisplayName ?? "") ? { enhanced: true } : {}),
  };
}

/** The stat a masterwork plug raises the most (catalysts can raise several). */
function masterworkStat(
  manifest: Manifest,
  investmentStats: readonly { statTypeHash: number; value: number }[] | undefined,
): MasterworkStat | undefined {
  let best: { statTypeHash: number; value: number } | undefined;
  for (const s of investmentStats ?? []) if (s.value > 0 && (!best || s.value > best.value)) best = s;
  if (!best) return undefined;
  const name = manifest.def("DestinyStatDefinition", best.statTypeHash)?.displayProperties?.name;
  return name ? { hash: best.statTypeHash, name } : undefined;
}

/** The weapon's frame, perk columns, and mods, from its live sockets. */
export function weaponRoll(
  profile: DestinyProfileResponse,
  manifest: Manifest,
  instanceId: string,
): WeaponRoll {
  const sockets = profile.itemComponents?.sockets?.data?.[instanceId]?.sockets ?? [];
  const reusable = profile.itemComponents?.reusablePlugs?.data?.[instanceId]?.plugs ?? {};
  const roll: WeaponRoll = { columns: [], mods: [] };

  sockets.forEach((socket, socketIndex) => {
    if (!socket.plugHash || socket.isVisible === false) return;
    const def = manifest.def("DestinyInventoryItemDefinition", socket.plugHash);
    const category = def?.plug?.plugCategoryIdentifier ?? "";
    const current = plugInfo(manifest, socket.plugHash);
    if (!current) return;

    if (category === INTRINSIC_CATEGORY) {
      roll.frame ??= current;
      return;
    }
    if (PERK_CATEGORIES.has(category)) {
      const rolled = (reusable[socketIndex] ?? [])
        .map((p) => plugInfo(manifest, p.plugItemHash))
        .filter((p): p is DetailPlug => p !== undefined);
      const options = rolled.some((p) => p.hash === current.hash) ? rolled : [current, ...rolled];
      const typeName = (def?.itemTypeDisplayName ?? "").replace(/^enhanced\s+/i, "");
      roll.columns.push({ socketIndex, current, options, origin: category === "origins", category, typeName });
      return;
    }
    const kind = modKind(category);
    if (kind === "masterwork") {
      const stat = masterworkStat(manifest, def?.investmentStats);
      roll.mods.push({ ...current, kind, ...(stat ? { stat } : {}) });
    } else if (kind) roll.mods.push({ ...current, kind });
  });
  return roll;
}

/**
 * Tiered weapons at full masterwork get +tier to each stat their masterwork plug lists
 * as a conditional 0 ("additional stats equal to the weapon's tier"). Bungie's live
 * stats (304) leave this out, so a Tier 5 gun read 5 short. Stat hash → investment
 * bonus; empty when it doesn't apply. Lower-tier masterwork plugs carry no conditional
 * stats, so a part-masterworked weapon gets nothing, as in-game.
 */
export function tieredMasterworkBonus(
  profile: DestinyProfileResponse,
  manifest: Manifest,
  instanceId: string,
): Map<number, number> {
  const bonus = new Map<number, number>();
  const tier = profile.itemComponents?.instances?.data?.[instanceId]?.gearTier ?? 0;
  if (tier <= 0) return bonus;
  for (const socket of profile.itemComponents?.sockets?.data?.[instanceId]?.sockets ?? []) {
    if (!socket.plugHash || socket.isEnabled === false) continue;
    const def = manifest.def("DestinyInventoryItemDefinition", socket.plugHash);
    if (!def?.plug?.plugCategoryIdentifier?.includes("weapons.masterworks.stat")) continue;
    for (const s of def.investmentStats ?? []) {
      if (s.isConditionallyActive && s.value === 0) bonus.set(s.statTypeHash, tier);
    }
  }
  return bonus;
}

/**
 * A displayed stat with `bonus` investment added, 1:1 capped at 100 on the 0–100 bars
 * the game lists (every Range, Stability, and Handling curve is 1:1). Times and counts
 * (Charge Time, a heat weapon's Cooling Efficiency) stay at the live value. So does a
 * stat at 0: its investment may sit far below (a grenade launcher's Disorienting
 * Grenades sink Blast Radius to -100, and +5 keeps it at 0).
 */
export function addInvestment(name: string, value: number, bonus: number): number {
  return WEAPON_STAT_ORDER.includes(name) && value > 0 ? Math.min(100, value + bonus) : value;
}

/**
 * The instance's stats that the game shows for weapons, in its order: the live values
 * (304) plus the tiered masterwork bonus they leave out.
 */
export function weaponStats(
  profile: DestinyProfileResponse,
  manifest: Manifest,
  instanceId: string,
): ItemStat[] {
  const stats = profile.itemComponents?.stats?.data?.[instanceId]?.stats ?? {};
  const bonus = tieredMasterworkBonus(profile, manifest, instanceId);
  const rank = (name: string) => {
    const at = WEAPON_STAT_ORDER.indexOf(name);
    if (at >= 0) return at;
    const number = WEAPON_STAT_NUMBERS.indexOf(name);
    return number >= 0 ? 100 + number : -1;
  };
  const out: ItemStat[] = [];
  for (const stat of Object.values(stats)) {
    const name = manifest.def("DestinyStatDefinition", stat.statHash)?.displayProperties?.name;
    if (!name || rank(name) < 0) continue;
    const extra = bonus.get(stat.statHash);
    const value = extra ? addInvestment(name, stat.value, extra) : stat.value;
    out.push({ hash: stat.statHash, name, value });
  }
  return out.sort((a, b) => rank(a.name) - rank(b.name));
}
