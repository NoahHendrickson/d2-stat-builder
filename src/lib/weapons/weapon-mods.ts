import type { DestinyInventoryItemDefinition } from "bungie-api-ts/destiny2";

import type { ManifestDefs } from "./manifest";
import type { PerkRef, StatMod } from "./types";

/** The plug an empty weapon mod socket starts with. */
const EMPTY_MOD_PLUG_ID = "v400.weapon.mod_empty";
const REQUIRES_ADEPT = /requires adept weapon/i;

function requiresAdept(def: DestinyInventoryItemDefinition): boolean {
  return (def.plug?.insertionRules ?? []).some((rule) => REQUIRES_ADEPT.test(rule.failureMessage));
}

function isEnhancedMod(def: DestinyInventoryItemDefinition): boolean {
  return /^Enhanced\b/.test(def.itemTypeDisplayName ?? "");
}

/**
 * A mod's stat modifiers. Adept mods mark theirs conditional (they need an adept
 * weapon), so on an adept weapon those count too; other conditional stats don't.
 */
function modStatMods(def: DestinyInventoryItemDefinition, adept: boolean): StatMod[] {
  const mods: StatMod[] = [];
  for (const inv of def.investmentStats ?? []) {
    if (inv.value === 0 || (inv.isConditionallyActive && !adept)) continue;
    mods.push({ hash: inv.statTypeHash, value: inv.value });
  }
  return mods;
}

/** Mods carry no description of their own; their visible sandbox perk does. */
function modDescription(
  def: DestinyInventoryItemDefinition,
  sandboxPerks: ManifestDefs["DestinySandboxPerkDefinition"],
): string | undefined {
  const own = def.displayProperties?.description?.trim();
  if (own) return own;
  for (const { perkHash, perkVisibility } of def.perks ?? []) {
    if (perkVisibility === 2) continue; // Hidden
    const text = sandboxPerks[perkHash]?.displayProperties?.description?.trim();
    if (text) return text;
  }
  return undefined;
}

/**
 * The weapon mods that can go in a weapon's mod socket and move one of the stats
 * it shows. Adept mods only count on adept weapons. Where a mod comes in a base
 * and an enhanced version, only the enhanced one is kept: it's the same mod with
 * bigger numbers, and anyone who can slot mods can slot it.
 */
export function buildWeaponModOptions(
  item: DestinyInventoryItemDefinition,
  items: Record<number, DestinyInventoryItemDefinition>,
  plugSets: ManifestDefs["DestinyPlugSetDefinition"],
  sandboxPerks: ManifestDefs["DestinySandboxPerkDefinition"],
  adept: boolean,
): PerkRef[] | undefined {
  const socket = item.sockets?.socketEntries?.find(
    (entry) =>
      items[entry.singleInitialItemHash]?.plug?.plugCategoryIdentifier === EMPTY_MOD_PLUG_ID,
  );
  const plugSetHash = socket?.reusablePlugSetHash;
  if (plugSetHash == null) return undefined;

  const shown = new Set<number>();
  for (const stat of Object.values(item.stats?.stats ?? {})) {
    if (stat.value > 0) shown.add(stat.statHash);
  }

  const byName = new Map<string, { def: DestinyInventoryItemDefinition; statMods: StatMod[] }>();
  for (const { plugItemHash } of plugSets[plugSetHash]?.reusablePlugItems ?? []) {
    const def = items[plugItemHash];
    const name = def?.displayProperties?.name;
    if (!def || !name || def.plug?.plugCategoryIdentifier === EMPTY_MOD_PLUG_ID) continue;
    const adeptOnly = requiresAdept(def);
    if (adeptOnly && !adept) continue;
    const statMods = modStatMods(def, adeptOnly);
    if (!statMods.some((mod) => shown.has(mod.hash))) continue;
    const existing = byName.get(name);
    if (existing && (isEnhancedMod(existing.def) || !isEnhancedMod(def))) continue;
    byName.set(name, { def, statMods });
  }
  if (byName.size === 0) return undefined;

  return [...byName.values()].map(({ def, statMods }) => ({
    hash: def.hash,
    name: def.displayProperties.name,
    icon: def.displayProperties.icon || undefined,
    currentlyCanRoll: true,
    description: modDescription(def, sandboxPerks),
    statMods,
  }));
}
