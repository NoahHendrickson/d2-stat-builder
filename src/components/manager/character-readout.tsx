"use client";

// What a character's equipped gear adds up to beyond its stats, shown by both layouts'
// nameplates: the champions its weapons stun and the armor set bonuses it has active.
import { useMemo } from "react";
import Image from "next/image";
import { TooltipLabel } from "@/components/ui/tooltip";
import { setBonusesFor, type SetBonus } from "@/components/loadouts/loadout-row-details";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import { equippedSetCounts } from "@/lib/inventory/armor-details";
import { WEAPON_ROWS } from "@/lib/inventory/buckets";
import { BREAKER_NAMES, type ManagerCharacter } from "@/lib/inventory/build";
import type { Manifest } from "@/lib/manifest/load";
import { cn } from "@/lib/utils";

/** The set bonuses `equipped`'s armor has active (none until the manifest is in). */
export function useEquippedSetBonuses(
  equipped: ManagerCharacter["equipped"],
  manifest: Manifest | undefined,
): SetBonus[] {
  return useMemo(
    () => (manifest ? setBonusesFor(equippedSetCounts(equipped, manifest), manifest) : []),
    [equipped, manifest],
  );
}

/** Teal, as the game draws a loadout's champion icons. */
const CHAMPION_TILE = "#2f8b8f";

/** Champion types by BreakerType, in the game's order: Barrier, Overload, Unstoppable. */
const CHAMPION_TYPES = Object.keys(BREAKER_NAMES).map(Number);

/**
 * A tile per champion type, in the game's order: teal with the icon when an equipped
 * weapon stuns it on its own (by its frame or an intrinsic), clear and faded when none
 * does. The seasonal artifact's champion perks aren't counted. The tooltip names the
 * weapons.
 */
export function ChampionStuns({
  equipped,
  manifest,
}: {
  equipped: ManagerCharacter["equipped"];
  manifest: Manifest | undefined;
}) {
  const icons = useMemo(() => {
    const byType = new Map<number, string>();
    for (const breaker of Object.values(manifest?.all("DestinyBreakerTypeDefinition") ?? {})) {
      const icon = breaker.displayProperties?.icon;
      if (icon) byType.set(breaker.enumValue, icon);
    }
    return byType;
  }, [manifest]);
  const weapons = new Map<number, string[]>();
  for (const row of WEAPON_ROWS) {
    const weapon = equipped[row.hash];
    if (!weapon?.breakerType) continue;
    weapons.set(weapon.breakerType, [...(weapons.get(weapon.breakerType) ?? []), weapon.name]);
  }

  return (
    <ul aria-label="Champions your weapons stun" className="flex gap-1">
      {CHAMPION_TYPES.map((type) => {
        const stunning = weapons.get(type);
        const icon = icons.get(type);
        const label = `${BREAKER_NAMES[type]}: ${stunning ? stunning.join(", ") : "no equipped weapon stuns it on its own"}`;
        return (
          <li key={type}>
            <TooltipLabel label={label}>
              <span
                tabIndex={0}
                aria-label={label}
                className={cn(
                  "flex size-6 items-center justify-center outline-none focus-visible:d2-tile-selected normal:rounded-sm",
                  !stunning && "border border-white/20",
                )}
                style={stunning ? { background: CHAMPION_TILE } : undefined}
              >
                {icon && (
                  <Image
                    src={`${BUNGIE_IMAGE_BASE}${icon}`}
                    alt=""
                    width={16}
                    height={16}
                    className={cn("size-4", !stunning && "opacity-30")}
                    unoptimized
                  />
                )}
              </span>
            </TooltipLabel>
          </li>
        );
      })}
    </ul>
  );
}
