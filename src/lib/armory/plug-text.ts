import type { Manifest } from "@/lib/manifest/load";
import { memoByManifest } from "@/lib/manifest/memo";
import { statModName } from "@/lib/dim/mod-hashes";

/** DestinyItemPerkEntryDefinition.perkVisibility: an internal perk the game never shows. */
const PERK_HIDDEN = 2;

/**
 * What a plug does, the way the game's tooltip tells it: the item's own description,
 * its visible perks' text, then its tooltip notes (raid-only, "matches your Super's
 * element"). On armor mods these say different things, so all of them show; hidden
 * perks are skipped (Harmonic mods carry one per element). Flavor text when there's
 * nothing else.
 */
export function plugDescription(
  def: {
    displayProperties?: { description?: string };
    flavorText?: string;
    perks?: { perkHash: number; perkVisibility?: number }[];
    tooltipNotifications?: { displayString: string }[];
  },
  manifest: Manifest,
): string | undefined {
  const parts = [
    def.displayProperties?.description,
    ...(def.perks ?? [])
      .filter((p) => p.perkVisibility !== PERK_HIDDEN)
      .map(
        (p) =>
          manifest.def("DestinySandboxPerkDefinition", p.perkHash)?.displayProperties
            ?.description,
      ),
    ...(def.tooltipNotifications ?? []).map((n) => n.displayString),
  ]
    .map((s) => s?.trim())
    .filter((s): s is string => Boolean(s));
  return [...new Set(parts)].join("\n\n") || def.flavorText?.trim() || undefined;
}

/** A plug's tooltip text: its label and, unless the label already says it all, a description. */
export interface PlugText {
  /** Stat and tuning mods read as what they do ("+10 Grenade"); everything else by name. */
  label: string;
  /** Left out for stat and tuning mods, whose label is the whole story. */
  description?: string;
}

const plugTextCache = memoByManifest(() => new Map<number, PlugText>());

/**
 * Label and description for a plug hash, cached per manifest: every mod tile, card icon
 * and picker tooltip reads it, so one rule decides what each shows.
 */
export function describePlug(manifest: Manifest, hash: number): PlugText {
  const cache = plugTextCache(manifest);
  let text = cache.get(hash);
  if (!text) {
    const def = manifest.def("DestinyInventoryItemDefinition", hash);
    const statLabel = statModName(manifest, hash);
    text = {
      label: statLabel ?? def?.displayProperties?.name ?? `#${hash}`,
      description: statLabel || !def ? undefined : plugDescription(def, manifest),
    };
    cache.set(hash, text);
  }
  return text;
}
