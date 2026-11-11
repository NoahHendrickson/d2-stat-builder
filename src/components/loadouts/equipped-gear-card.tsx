"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, FloppyDiskIcon, Loading03Icon } from "@hugeicons/core-free-icons";
import type { SavedLoadoutData } from "@/lib/loadouts/types";
import { LoadoutCardBody } from "@/components/loadouts/loadout-card-body";
import {
  LoadoutPreviewFrame,
  usePreviewLoadout,
  type GearLookups,
} from "@/components/loadouts/loadout-preview-frame";
import { Button } from "@/components/ui/button";
import { TooltipLabel } from "@/components/ui/tooltip";

/**
 * A character's equipped gear as a loadout card, above the saved ones: the same body as
 * a saved card, with Save (under the name it starts with) and a close button.
 */
export function EquippedGearCard({
  data,
  label,
  blockedLabel,
  saving,
  onSave,
  onClose,
  ...lookups
}: GearLookups & {
  data: SavedLoadoutData;
  /** Whose gear it is ("Hunter"). */
  label: string;
  /** Why Save can't run right now, if it can't. */
  blockedLabel?: string;
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
}) {
  const { shown, resolved } = usePreviewLoadout(data, "equipped", lookups);
  return (
    <LoadoutPreviewFrame
      label={`Equipped gear, ${label}`}
      title="Equipped gear"
      subtitle={`Saves as ${data.loadout.name}`}
      data={data}
      manifest={lookups.manifest}
      // Capped so the saved loadouts below always keep room; the card scrolls past that.
      className="d2-reveal d2-scroll max-h-[60%] shrink-0 overflow-y-auto overscroll-contain"
      actions={
        <>
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
        </>
      }
    >
      <LoadoutCardBody saved={shown} resolved={resolved} manifest={lookups.manifest} />
    </LoadoutPreviewFrame>
  );
}
