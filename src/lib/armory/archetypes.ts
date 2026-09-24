import { memoByManifest } from "../manifest/memo";
import type { DreamArchetype } from "../optimizer/dream";
import {
  ARMOR_ARCHETYPE_PLUG_CATEGORY,
  STAT_LABELS,
  STAT_ORDER,
} from "./stats";

const STAT_BY_LABEL = new Map(
  STAT_ORDER.map((key, i) => [STAT_LABELS[key].toLowerCase(), i]),
);

/**
 * Read an archetype plug's "Primary Stat: X / Secondary Stat: Y" description lines
 * into stat indices, or null when either is missing or unrecognized.
 */
export function parseArchetypeDescription(
  description: string,
): { primary: number; secondary: number } | null {
  const stat = (label: string) => {
    const m = description.match(new RegExp(`${label} Stat:\\s*([A-Za-z]+)`, "i"));
    return m ? STAT_BY_LABEL.get(m[1].toLowerCase()) : undefined;
  };
  const primary = stat("Primary");
  const secondary = stat("Secondary");
  if (primary === undefined || secondary === undefined || primary === secondary) return null;
  return { primary, secondary };
}

/**
 * Every Armor 3.0 archetype (Gunner, Brawler, …) with its primary and secondary stat,
 * scanned from the archetype plugs so a new archetype needs no code change. Sorted by
 * name; one entry per name (redacted and duplicate plugs skipped).
 */
export const getArchetypes = memoByManifest((manifest): DreamArchetype[] => {
  const byName = new Map<string, DreamArchetype>();
  const table = manifest.all("DestinyInventoryItemDefinition");
  for (const key in table) {
    const def = table[key];
    if (def.plug?.plugCategoryIdentifier !== ARMOR_ARCHETYPE_PLUG_CATEGORY) continue;
    const name = def.displayProperties?.name;
    if (def.redacted || !name || byName.has(name)) continue;
    const stats = parseArchetypeDescription(def.displayProperties.description ?? "");
    if (stats) byName.set(name, { name, ...stats });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
});
