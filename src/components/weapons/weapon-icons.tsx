"use client";

import Image from "next/image";
import { ItemWatermark } from "@/components/armor-thumb";
import { cn } from "@/lib/utils";
import type { AmmoTypeRef, ChampionTypeRef, DamageTypeRef, WeaponSummary } from "@/lib/weapons/types";
import { weaponTypeIcon } from "@/lib/weapons/weapon-type-icon-paths";

/**
 * The weapon search's icons, shared by the result rows and the details header:
 * the weapon's own icon, its element, ammo, champions and type silhouette.
 */

/** Ammo names as DestinyAmmunitionType, for the heavy grenade launcher silhouette. */
export const AMMO_TYPE: Record<string, number> = { Primary: 1, Special: 2, Heavy: 3 };

export function WeaponIcon({
  weapon,
  size = 44,
  className,
}: {
  weapon: WeaponSummary;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={cn("relative block shrink-0 bg-foreground/5", className)}
      style={{ width: size, height: size }}
    >
      {weapon.icon && (
        <Image
          src={`https://www.bungie.net${weapon.icon}`}
          alt=""
          width={size}
          height={size}
          unoptimized
        />
      )}
      {weapon.watermark && <ItemWatermark watermark={weapon.watermark} />}
    </span>
  );
}

/** The element's damage-type glyph from the catalog; Kinetic's is white, so it inverts on light. */
export function ElementIcon({
  element,
  damageTypes,
  size = 14,
}: {
  element: string;
  damageTypes: readonly DamageTypeRef[] | undefined;
  size?: number;
}) {
  const icon = damageTypes?.find((type) => type.name === element)?.icon;
  if (!icon) return <span>{element}</span>;
  return (
    <Image
      className={cn(
        "shrink-0",
        element === "Kinetic" && "invert dark:invert-0",
      )}
      src={`https://www.bungie.net${icon}`}
      alt={element}
      width={size}
      height={size}
      unoptimized
    />
  );
}

/** The in-game HUD tints: white (Primary), green (Special), purple (Heavy). */
const AMMO_COLOR: Record<string, string> = {
  Primary: "text-foreground",
  Special: "text-[#58c26c]",
  Heavy: "text-[#7d58c2]",
};

/**
 * Ammo HUD icon used as a mask so it takes the ammo color; falls back to the name.
 * `tight` trims the empty margin Bungie's square art leaves either side of the glyph.
 */
export function AmmoIcon({
  ammo,
  ammoTypes,
  tight = false,
}: {
  ammo: string;
  ammoTypes: readonly AmmoTypeRef[] | undefined;
  tight?: boolean;
}) {
  const icon = ammoTypes?.find((type) => type.name === ammo)?.icon;
  if (!icon) return <span>{ammo}</span>;
  const mask = `url("https://www.bungie.net${icon}") center / contain no-repeat`;
  return (
    <span
      role="img"
      aria-label={ammo}
      className={cn(
        "-my-1.5 inline-block size-[30px] shrink-0 bg-current",
        tight && "-mx-1.5",
        AMMO_COLOR[ammo],
      )}
      style={{ mask, WebkitMask: mask }}
    />
  );
}

/** The anti-champion glyph from the catalog; Bungie's is white, so it inverts on light. */
export function ChampionIcon({
  champion,
  championTypes,
}: {
  champion: string;
  championTypes: readonly ChampionTypeRef[] | undefined;
}) {
  const icon = championTypes?.find((type) => type.name === champion)?.icon;
  if (!icon) return null;
  return (
    <Image
      className="shrink-0 invert dark:invert-0"
      src={`https://www.bungie.net${icon}`}
      alt={`Anti-${champion}`}
      width={18}
      height={18}
      unoptimized
    />
  );
}

/**
 * The weapon type's silhouette, as a mask so it takes the text colour. In a
 * list row it fills a set slot so the icons after it line up; `tight` sizes it
 * to the silhouette instead, by an invisible copy of the art at the same height.
 */
export function TypeSilhouette({
  weapon,
  tight = false,
}: {
  weapon: WeaponSummary;
  tight?: boolean;
}) {
  const icon = weaponTypeIcon(weapon.type, AMMO_TYPE[weapon.ammo]);
  // A type without a silhouette keeps its slot, so the icons after it stay in line.
  if (!icon) return <span className="w-11 shrink-0" />;
  const mask = `url("${icon}") center / contain no-repeat`;
  if (tight) {
    return (
      <span
        role="img"
        aria-label={weapon.type}
        className="relative h-3 shrink-0"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={icon} alt="" className="invisible h-full w-auto" />
        <span
          className="absolute inset-0 bg-foreground"
          style={{ mask, WebkitMask: mask }}
        />
      </span>
    );
  }
  return (
    <span
      role="img"
      aria-label={weapon.type}
      className="h-3 w-11 shrink-0 bg-foreground"
      style={{ mask, WebkitMask: mask }}
    />
  );
}
