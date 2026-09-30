import type { DestinyInventoryItemDefinition } from "bungie-api-ts/destiny2";

import type { DestinyIconDefinitionEntry, ManifestDefs } from "./manifest";
import { internWeaponCatalog } from "./intern-weapons";
import { collectSocketPlugCandidates, extractPlugStatMods } from "./socket-plug-candidates";
import {
  resolveWeaponSeason,
  resolveWeaponSources,
  sourceFields,
  sourceLabels,
} from "./weapon-provenance";
import { buildWeaponMasterworkOptions } from "./weapon-masterwork";
import { reconcileAdeptTierPools, reconcileCraftableTwins } from "./weapon-variants";
import { GENERIC_WEAPON_TYPE_ICONS } from "./weapon-type-icon-paths";
import type {
  AmmoTypeRef,
  DamageTypeRef,
  PerkColumn,
  PerkRef,
  StatMod,
  StatCurve,
  StatGroupRef,
  WeaponDoc,
  WeaponIndex,
  WeaponStat,
  WeaponTypeRef,
} from "./types";
import type { WeaponDetailIndex } from "./types";

const WEAPON_ITEM_TYPE = 3; // DestinyItemType.Weapon

// Stable socket-category hashes.
const SOCKET_CATEGORY_INTRINSIC = 3956125808;
const SOCKET_CATEGORY_WEAPON_PERKS = 4241085061;

const AMMO_NAMES: Record<number, string> = { 1: "Primary", 2: "Special", 3: "Heavy" };

const BUCKET_SLOT: Record<number, string> = {
  1498876634: "Kinetic",
  2465295065: "Energy",
  953998645: "Power",
};

/** Plugs that are cosmetic, empty, or otherwise not a real perk roll. */
function isCosmeticOrEmptyPlug(def: DestinyInventoryItemDefinition): boolean {
  const id = def.plug?.plugCategoryIdentifier ?? "";
  const name = def.displayProperties?.name ?? "";
  if (!name) return true;
  if (/(shader|skins|ornament|trackers|mementos|masterwork)/i.test(id)) return true;
  if (id.includes("empty") || /^Empty .* Socket$/i.test(name)) return true;
  if (/^(Kill Tracker|Tracker Disabled|Default (Shader|Ornament))/i.test(name)) return true;
  return false;
}

/** Bungie ships base (tier 2) and enhanced (tier 3) plugs per perk — we only display the base. */
function isEnhancedPlug(def: DestinyInventoryItemDefinition): boolean {

  return def.inventory?.tierType === 3;
}

function plugDescription(def: DestinyInventoryItemDefinition): string | undefined {
  const description = def.displayProperties?.description?.trim();
  return description || undefined;
}

/** Base investment stats from a weapon item definition. */
function weaponInvestmentStats(
  item: DestinyInventoryItemDefinition,
  stats: ManifestDefs["DestinyStatDefinition"],
): WeaponStat[] {
  const weaponStats: WeaponStat[] = [];
  for (const s of item.investmentStats ?? []) {
    const statName = stats[s.statTypeHash]?.displayProperties?.name;
    if (statName) weaponStats.push({ hash: s.statTypeHash, name: statName, value: s.value });
  }
  return weaponStats;
}

/** One visible perk per name; enhanced-tier hashes are kept as `alternateHashes` for vault resolution. */
export function buildColumnPerks(
  candidates: { hash: number; canRoll: boolean }[],
  items: Record<number, DestinyInventoryItemDefinition>,
): { perks: PerkRef[]; identifier: string } {
  const byName = new Map<
    string,
    {
      hash: number;
      name: string;
      icon?: string;
      canRoll: boolean;
      description?: string;
      enhancedHash?: number;
      enhancedDescription?: string;
      statMods?: StatMod[];
    }
  >();
  let identifier = "";

  for (const { hash, canRoll } of candidates) {
    const pd = items[hash];
    if (!pd || isCosmeticOrEmptyPlug(pd)) continue;
    if (!identifier) identifier = pd.plug?.plugCategoryIdentifier ?? "";
    const name = pd.displayProperties?.name ?? "";
    if (!name) continue;

    if (isEnhancedPlug(pd)) {
      const row = byName.get(name) ?? { hash: 0, name, canRoll: false };
      row.canRoll = row.canRoll || canRoll;
      row.enhancedHash = hash;
      row.enhancedDescription = plugDescription(pd);
      byName.set(name, row);
      continue;
    }

    const row = byName.get(name);
    byName.set(name, {
      hash,
      name,
      icon: pd.displayProperties?.icon || undefined,
      canRoll: row?.canRoll || canRoll,
      description: plugDescription(pd),
      enhancedHash: row?.enhancedHash,
      enhancedDescription: row?.enhancedDescription,
      statMods: extractPlugStatMods(pd) ?? row?.statMods,
    });
  }

  const perks: PerkRef[] = [];
  for (const row of byName.values()) {
    if (!row.hash) continue;
    perks.push({
      hash: row.hash,
      name: row.name,
      icon: row.icon,
      currentlyCanRoll: row.canRoll,
      description: row.description,
      enhancedDescription: row.enhancedDescription,
      alternateHashes: row.enhancedHash ? [row.enhancedHash] : undefined,
      statMods: row.statMods,
    });
  }
  return { perks, identifier };
}

/** Best-effort column label from a plug's category identifier. */
function columnKind(isIntrinsic: boolean, identifier: string): string {
  if (isIntrinsic) return "Intrinsic";
  const id = identifier.toLowerCase();
  if (id.includes("origin")) return "Origin Trait";
  if (id.includes("barrel")) return "Barrel";
  if (id.includes("blade")) return "Blade";
  if (id.includes("scope") || id.includes("sight")) return "Scope";
  if (id.includes("magazine") || id.includes("sword_energy")) return "Magazine";
  if (id.includes("batter")) return "Battery";
  if (id.includes("guard")) return "Guard";
  if (id.includes("string")) return "Bowstring";
  if (id.includes("arrow")) return "Arrows";
  if (id.includes("haft")) return "Haft";
  if (id.includes("tube") || id.includes("launcher_barrel")) return "Barrel";
  if (id.includes("grip") || id.includes("stock")) return "Stock";
  return "Trait";
}

/** Champion names by DestinyBreakerType, and by the icon token perk names and text use. */
const BREAKER_CHAMPIONS: Record<number, string> = {
  1: "Barrier",
  2: "Overload",
  3: "Unstoppable",
};
const CHAMPION_TOKENS: Record<string, string> = {
  "shield-piercing": "Barrier",
  disruption: "Overload",
  stagger: "Unstoppable",
};

/**
 * The champion a plug makes its weapon stun. Since Monument of Triumph (2026) every
 * frame and exotic intrinsic carries one, as a hidden sandbox perk named
 * "[Disruption] Overload" and so on; some plugs set `breakerType` instead.
 */
export function plugChampion(
  plug: DestinyInventoryItemDefinition | undefined,
  sandboxPerks: ManifestDefs["DestinySandboxPerkDefinition"],
): string | undefined {
  if (!plug) return undefined;
  if (plug.breakerType) return BREAKER_CHAMPIONS[plug.breakerType];
  for (const { perkHash } of plug.perks ?? []) {
    const name = sandboxPerks[perkHash]?.displayProperties?.name ?? "";
    const token = /^\[(Shield-Piercing|Disruption|Stagger)\]/.exec(name)?.[1];
    if (token) return CHAMPION_TOKENS[token.toLowerCase()];
  }
  return undefined;
}

/**
 * Champions a weapon stuns: whatever its plugs grant (several when it rolls more than
 * one frame, like Corrective Measure), else the weapon's own `breakerType`, else the
 * perk text ("Strong against [Stagger] Unstoppable Champions"). Artifact stuns aren't
 * on the item.
 */
export function weaponChampions(
  columns: PerkColumn[],
  breakerType: number | undefined,
  champion: (plugHash: number) => string | undefined,
): string[] {
  const found = new Set<string>();
  for (const column of columns) {
    for (const perk of column.perks) {
      const granted = champion(perk.hash);
      if (granted) found.add(granted);
    }
  }
  const own = breakerType != null ? BREAKER_CHAMPIONS[breakerType] : undefined;
  if (!found.size && own) found.add(own);
  if (!found.size) {
    for (const column of columns) {
      for (const perk of column.perks) {
        const text = `${perk.description ?? ""} ${perk.enhancedDescription ?? ""}`;
        for (const [, token] of text.matchAll(/\[(Shield-Piercing|Disruption|Stagger)\]/gi)) {
          found.add(CHAMPION_TOKENS[token!.toLowerCase()]!);
        }
        for (const [, name] of text.matchAll(/\b(Barrier|Overload|Unstoppable) Champion/g)) {
          found.add(name!);
        }
      }
    }
  }
  return [...found].sort();
}

/** Build the weapon-type catalog (Hand Cannon, Fusion Rifle, …) for filter chip icons. */
export function buildWeaponTypeCatalog(defs: ManifestDefs): WeaponTypeRef[] {
  const items = defs.DestinyInventoryItemDefinition;
  const present = new Set<string>();

  for (const item of Object.values(items)) {

    if (item.itemType !== WEAPON_ITEM_TYPE || item.redacted) continue;
    if (item.itemTypeDisplayName) present.add(item.itemTypeDisplayName);
  }

  const refs: WeaponTypeRef[] = [];
  for (const name of present) {
    const icon = GENERIC_WEAPON_TYPE_ICONS[name];
    if (icon) refs.push({ name, icon });
  }
  return refs.sort((a, b) => a.name.localeCompare(b.name));
}

const AMMO_TYPE_ORDER = ["Primary", "Special", "Heavy"] as const;

/** Build the ammo-type catalog from DestinyIconDefinition HUD icons. */
export function buildAmmoTypeCatalog(
  icons: Record<string, DestinyIconDefinitionEntry>,
): AmmoTypeRef[] {
  const bySlug = new Map<string, string>();
  for (const icon of Object.values(icons)) {
    if (icon.redacted) continue;
    const foreground = icon.foreground ?? "";
    const match = foreground.match(/order_icon_ammo_(primary|special|heavy)/);
    if (match) bySlug.set(match[1]!, foreground);
  }

  return AMMO_TYPE_ORDER.flatMap((name) => {
    const icon = bySlug.get(name.toLowerCase());
    return icon ? [{ name, icon }] : [];
  });
}

/** Build the damage-type catalog (Solar, Arc, Void, …) for element icons. */
export function buildDamageTypeCatalog(defs: ManifestDefs): DamageTypeRef[] {
  const damageTypes: DamageTypeRef[] = [];
  for (const dt of Object.values(defs.DestinyDamageTypeDefinition)) {
    const name = dt.displayProperties?.name;
    if (!name || dt.redacted) continue;
    damageTypes.push({
      hash: dt.hash,
      name,
      icon: dt.displayProperties?.icon || undefined,
    });
  }
  damageTypes.sort((a, b) => a.name.localeCompare(b.name));
  return damageTypes;
}

/** Build compact stat-group definitions referenced by weapons. */
export function buildStatGroupCatalog(
  defs: ManifestDefs,
  statGroupHashes: Iterable<number>,
): Record<string, StatGroupRef> {
  const groups = defs.DestinyStatGroupDefinition;
  const catalog: Record<string, StatGroupRef> = {};
  for (const hash of statGroupHashes) {
    const group = groups[hash];
    if (!group) continue;
    catalog[String(hash)] = {
      hash: group.hash,
      maximumValue: group.maximumValue,
      scaledStats: (group.scaledStats ?? []).map((scaled) => ({
        statHash: scaled.statHash,
        maximumValue: scaled.maximumValue,
        displayInterpolation: (scaled.displayInterpolation ?? []).map((point) => ({
          value: point.value,
          weight: point.weight,
        })),
      })),
    };
  }
  return catalog;
}

/** Stat groups as the browser uses them: stat name → investment → display curve. */
export function buildStatCurves(
  defs: ManifestDefs,
  statGroupHashes: Iterable<number>,
): Record<string, Record<string, StatCurve>> {
  const curves: Record<string, Record<string, StatCurve>> = {};
  for (const hash of statGroupHashes) {
    const group = defs.DestinyStatGroupDefinition[hash];
    if (!group) continue;
    const byName: Record<string, StatCurve> = {};
    for (const scaled of group.scaledStats ?? []) {
      const name = defs.DestinyStatDefinition[scaled.statHash]?.displayProperties?.name;
      if (!name || !scaled.displayInterpolation?.length) continue;
      byName[name] = {
        max: scaled.maximumValue,
        points: scaled.displayInterpolation.map((p) => [p.value, p.weight]),
      };
    }
    curves[String(hash)] = byName;
  }
  return curves;
}

const ATTUNEMENT_VENDOR_SUFFIX = " Attunement";
const ATTUNEMENT_DESCRIPTION_PATTERN =
  /attune to an item to increase its drop chance from this activity/i;

function sourceFromAttunementVendorName(name: string | undefined): string | undefined {
  const source = name
    ?.trim()
    .replace(new RegExp(`${ATTUNEMENT_VENDOR_SUFFIX}$`, "i"), "")
    .trim();
  return source || undefined;
}

function attunementItemWeaponHash(item: DestinyInventoryItemDefinition): number | undefined {
  const description = item.displayProperties?.description ?? "";
  if (!ATTUNEMENT_DESCRIPTION_PATTERN.test(description)) return undefined;
  return item.displayProperties?.iconHash;
}

/** Activity attunement vendors expose updated Ops sources for their attunable weapons. */
export function deriveAttunementSourceOverrides(defs: ManifestDefs): Map<number, string> {
  const overrides = new Map<number, string>();
  const items = defs.DestinyInventoryItemDefinition;
  const vendors = defs.DestinyVendorDefinition ?? {};

  for (const vendor of Object.values(vendors)) {
    const source = sourceFromAttunementVendorName(vendor.displayProperties?.name);
    if (!source) continue;
    const description = vendor.displayProperties?.description ?? "";
    if (!ATTUNEMENT_DESCRIPTION_PATTERN.test(description)) continue;

    for (const entry of vendor.itemList ?? []) {
      const attunementItem = items[entry.itemHash];
      if (!attunementItem) continue;
      const weaponHash = attunementItemWeaponHash(attunementItem);
      if (weaponHash == null) continue;
      const weapon = items[weaponHash];
      if (!weapon) continue;

      if (weapon.itemType !== WEAPON_ITEM_TYPE) continue;
      overrides.set(weaponHash, source);
    }
  }

  return overrides;
}

/** Flatten the manifest definitions into a searchable weapon index. */
export function buildWeaponIndex(
  defs: ManifestDefs,
  version: string,
  ammoTypes: AmmoTypeRef[] = [],
): { index: WeaponIndex; detailIndex: WeaponDetailIndex } {
  const items = defs.DestinyInventoryItemDefinition;
  const plugSets = defs.DestinyPlugSetDefinition;
  const stats = defs.DestinyStatDefinition;
  const sandboxPerks = defs.DestinySandboxPerkDefinition ?? {};
  const damageTypes = defs.DestinyDamageTypeDefinition;
  const collectibles = defs.DestinyCollectibleDefinition;
  const presentationNodes = defs.DestinyPresentationNodeDefinition;
  const sourceOverrides = deriveAttunementSourceOverrides(defs);

  const weapons: WeaponDoc[] = [];

  for (const item of Object.values(items)) {

    if (item.itemType !== WEAPON_ITEM_TYPE || item.redacted) continue;
    const name = item.displayProperties?.name;
    if (!name || !item.sockets || !item.equippingBlock) continue;

    // Which socket indexes are intrinsic vs. perk columns?
    const intrinsicIdx = new Set<number>();
    const perkIdx: number[] = [];
    for (const cat of item.sockets.socketCategories ?? []) {
      if (cat.socketCategoryHash === SOCKET_CATEGORY_INTRINSIC) {
        for (const i of cat.socketIndexes) intrinsicIdx.add(i);
      } else if (cat.socketCategoryHash === SOCKET_CATEGORY_WEAPON_PERKS) {
        for (const i of cat.socketIndexes) perkIdx.push(i);
      }
    }

    const columns: PerkColumn[] = [];
    for (const idx of [...intrinsicIdx, ...perkIdx]) {
      const entry = item.sockets.socketEntries[idx];
      if (!entry) continue;
      const isIntrinsic = intrinsicIdx.has(idx);

      const candidates = collectSocketPlugCandidates(entry, plugSets, items);
      if (!candidates.length) continue;

      const { perks, identifier } = buildColumnPerks(candidates, items);
      if (!perks.length) continue;
      columns.push({ kind: columnKind(isIntrinsic, identifier), perks });
    }

    const weaponStats: WeaponStat[] = [];
    for (const s of Object.values(item.stats?.stats ?? {})) {
      const statName = stats[s.statHash]?.displayProperties?.name;
      if (statName) weaponStats.push({ hash: s.statHash, name: statName, value: s.value });
    }

    const investmentStats = weaponInvestmentStats(item, stats);
    const statGroupHash = item.stats?.statGroupHash ?? undefined;
    const masterworkOptions = buildWeaponMasterworkOptions(item, items, plugSets, stats);

    const element =
      (item.defaultDamageTypeHash != null
        ? damageTypes[item.defaultDamageTypeHash]?.displayProperties?.name
        : undefined) ?? "Kinetic";
    const collectible =
      item.collectibleHash != null ? collectibles[item.collectibleHash] : undefined;
    const resolvedSources = resolveWeaponSources(
      name,
      collectible?.sourceString,
      presentationNodes,
      collectible?.parentNodeHashes,
    );
    const sourceOverride = sourceOverrides.get(item.hash);
    const { source, sources } = sourceOverride
      ? sourceFields(sourceOverride, sourceLabels(resolvedSources))
      : resolvedSources;
    const season = resolveWeaponSeason(item, collectible, defs);

    const perkNames: string[] = [];
    const perkHashes: number[] = [];
    for (const col of columns) {
      for (const p of col.perks) {
        if (p.name) perkNames.push(p.name);
        perkHashes.push(p.hash);
        for (const alt of p.alternateHashes ?? []) perkHashes.push(alt);
      }
    }

    weapons.push({
      hash: item.hash,
      name,
      icon: item.displayProperties?.icon || undefined,
      watermark: item.iconWatermark || undefined,
      screenshot: item.screenshot || undefined,
      flavor: item.flavorText || undefined,
      type: item.itemTypeDisplayName || "Weapon",
      element,
      ammo: AMMO_NAMES[item.equippingBlock.ammoType] ?? "Primary",
      rarity: item.inventory?.tierTypeName ?? "Legendary",
      slot: BUCKET_SLOT[item.inventory?.bucketTypeHash ?? 0] ?? "",
      frame: columns.find((c) => c.kind === "Intrinsic")?.perks[0]?.name,
      craftable: item.inventory?.recipeItemHash != null,
      adept: /\((Adept|Timelost|Harrowed)\)/.test(name),
      seasonNumber: season?.seasonNumber,
      seasonName: season?.seasonName,
      source,
      sources,
      releaseIndex: item.index,
      stats: weaponStats,
      investmentStats: investmentStats.length > 0 ? investmentStats : undefined,
      statGroupHash,
      ...(masterworkOptions?.length ? { masterworkOptions } : {}),
      columns,
      perks: [...new Set(perkNames)],
      perkHashes: [...new Set(perkHashes)],
    });
  }

  weapons.sort((a, b) => a.name.localeCompare(b.name));
  // After reconciling: merged pools can add frames, and each frame brings its champion.
  const reconciled = reconcileAdeptTierPools(reconcileCraftableTwins(weapons)).map((weapon) => ({
    ...weapon,
    champions: weaponChampions(weapon.columns, items[weapon.hash]?.breakerType, (hash) =>
      plugChampion(items[hash], sandboxPerks),
    ),
  }));
  const { index, detailIndex } = internWeaponCatalog(reconciled, version);
  const statGroupHashes = new Set<number>();
  for (const weapon of weapons) {
    if (weapon.statGroupHash != null) statGroupHashes.add(weapon.statGroupHash);
  }
  return {
    index: {
      ...index,
      damageTypes: buildDamageTypeCatalog(defs),
      weaponTypes: buildWeaponTypeCatalog(defs),
      ammoTypes,
      statCurves: buildStatCurves(
        defs,
        new Set(index.weapons.flatMap((w) => (w.statGroupHash != null ? [w.statGroupHash] : []))),
      ),
    },
    detailIndex: {
      ...detailIndex,
      statGroups: buildStatGroupCatalog(defs, statGroupHashes),
    },
  };
}
