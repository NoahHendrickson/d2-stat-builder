"use client";

import { useMemo, type ReactNode } from "react";
import type { ArmorPiece } from "@/lib/armory/normalize";
import type { LoadoutWeapon } from "@/lib/armory/weapons";
import type { Manifest } from "@/lib/manifest/load";
import { statIconsFromManifest } from "@/lib/manifest/stat-icons";
import { resolveLoadout } from "@/lib/loadouts/resolve";
import { transientLoadout, type SavedLoadoutData } from "@/lib/loadouts/types";
import { LoadoutStatLine } from "@/components/loadouts/loadout-stat-line";
import { cn } from "@/lib/utils";

export interface GearLookups {
  pieceMap: ReadonlyMap<string, ArmorPiece>;
  weaponMap: ReadonlyMap<string, LoadoutWeapon>;
  manifest: Manifest;
}

/**
 * Unsaved gear shown as a loadout card (an in-game slot, what's equipped): the loadout
 * under a stand-in id, and its items resolved against the armory. Memoized: both are
 * heavy, and the views showing them re-render often.
 */
export function usePreviewLoadout(
  data: SavedLoadoutData,
  id: string,
  { pieceMap, weaponMap, manifest }: GearLookups,
) {
  return useMemo(
    () => ({
      shown: transientLoadout(id, data),
      resolved: resolveLoadout(data.loadout, pieceMap, manifest, weaponMap),
    }),
    [data, id, pieceMap, weaponMap, manifest],
  );
}

/** A preview card: an optional icon, title, stats and actions, then what's in it. */
export function LoadoutPreviewFrame({
  label,
  leading,
  title,
  titleClassName,
  titleAction,
  subtitle,
  data,
  manifest,
  actions,
  className,
  children,
}: {
  /** The card's accessible name. */
  label: string;
  /** Drawn before the title (a slot's emblem). */
  leading?: ReactNode;
  title: string;
  titleClassName?: string;
  /** A small control right after the title. */
  titleAction?: ReactNode;
  subtitle: string;
  /** The loadout on show; its stats go in the header. */
  data?: SavedLoadoutData;
  manifest: Manifest;
  actions: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const statIcons = statIconsFromManifest(manifest);
  return (
    <article
      aria-label={label}
      className={cn("@container d2-card-frame flex min-w-0 flex-col gap-4 p-4", className)}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-48 items-center gap-3">
          {leading}
          <div className="flex min-w-0 flex-col">
            <div className="flex min-w-0 items-center gap-1">
              <h3 className={cn("truncate text-base leading-6 font-medium", titleClassName)}>{title}</h3>
              {titleAction}
            </div>
            <p className="text-muted-foreground truncate text-xs leading-4">{subtitle}</p>
          </div>
        </div>
        {data?.optimizer && (
          <div className="flex items-center gap-4 text-sm leading-5 tabular-nums max-md:w-full max-md:justify-between max-md:gap-1">
            <LoadoutStatLine optimizer={data.optimizer} statIcons={statIcons} />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </div>
      {children}
    </article>
  );
}
