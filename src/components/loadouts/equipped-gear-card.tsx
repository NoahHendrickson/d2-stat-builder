"use client";

import { useMemo } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, FloppyDiskIcon, Loading03Icon } from "@hugeicons/core-free-icons";
import type { ArmorPiece } from "@/lib/armory/normalize";
import { CLASS_NAMES, type StatIconMap } from "@/lib/armory/stats";
import type { LoadoutWeapon } from "@/lib/armory/weapons";
import type { Manifest } from "@/lib/manifest/load";
import { resolveLoadout } from "@/lib/loadouts/resolve";
import { transientLoadout, type SavedLoadoutData } from "@/lib/loadouts/types";
import { LoadoutCardBody } from "@/components/loadouts/loadout-card-body";
import { LoadoutStatLine } from "@/components/loadouts/loadout-stat-line";
import { Button } from "@/components/ui/button";
import { TooltipLabel } from "@/components/ui/tooltip";

/**
 * A character's equipped gear as a loadout card, above the saved ones: the same body as
 * a saved card, with Save (under the name it starts with) and a close button.
 */
export function EquippedGearCard({
  data,
  pieceMap,
  weaponMap,
  manifest,
  statIcons,
  blockedLabel,
  saving,
  onSave,
  onClose,
}: {
  data: SavedLoadoutData;
  pieceMap: ReadonlyMap<string, ArmorPiece>;
  weaponMap: ReadonlyMap<string, LoadoutWeapon>;
  manifest: Manifest;
  statIcons: StatIconMap;
  /** Why Save can't run right now, if it can't. */
  blockedLabel?: string;
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
}) {
  const { loadout, optimizer } = data;
  const shown = useMemo(() => transientLoadout(`equipped-${loadout.id}`, data), [data, loadout.id]);
  const resolved = useMemo(
    () => resolveLoadout(loadout, pieceMap, manifest, weaponMap),
    [loadout, pieceMap, manifest, weaponMap],
  );
  const className = CLASS_NAMES[loadout.classType] ?? "Guardian";

  return (
    <article
      aria-label={`${className}'s equipped gear`}
      // Capped so the saved loadouts below always keep room; the card scrolls past that.
      className="@container d2-card-frame d2-reveal d2-scroll flex max-h-[60%] shrink-0 flex-col gap-4 overflow-y-auto overscroll-contain p-4"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-48 flex-col">
          <h3 className="truncate text-base leading-6 font-medium">Equipped gear</h3>
          <p className="text-muted-foreground truncate text-xs leading-4">Saves as {loadout.name}</p>
        </div>
        {optimizer && (
          <div className="flex h-9 items-center gap-4 px-2 text-sm leading-5 tabular-nums max-md:w-full max-md:justify-between max-md:gap-1 max-md:px-1">
            <LoadoutStatLine optimizer={optimizer} statIcons={statIcons} />
          </div>
        )}
        <div className="flex shrink-0 items-center gap-2">
          <TooltipLabel label={blockedLabel} disabled={!!blockedLabel}>
            <Button
              variant="emphatic"
              size="xs"
              className="h-8 gap-1.5 px-4"
              onClick={onSave}
              disabled={!!blockedLabel || saving}
            >
              <HugeiconsIcon
                icon={saving ? Loading03Icon : FloppyDiskIcon}
                className={saving ? "animate-spin" : undefined}
                aria-hidden
              />
              Save loadout
            </Button>
          </TooltipLabel>
          <TooltipLabel label="Close">
            <Button size="icon" variant="dashed" aria-label="Close equipped gear" onClick={onClose}>
              <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-4" aria-hidden />
            </Button>
          </TooltipLabel>
        </div>
      </div>
      <LoadoutCardBody saved={shown} resolved={resolved} manifest={manifest} />
    </article>
  );
}
