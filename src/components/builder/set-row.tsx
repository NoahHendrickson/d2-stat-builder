"use client";

import { memo } from "react";
import { GridFour, PushPin } from "@phosphor-icons/react";
import {
  Tooltip,
  TooltipContent,
  TooltipLabel,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { ArmorSetInfo, SetPerkInfo } from "@/lib/armory/sets";

export const SetRow = memo(function SetRow({
  set,
  pinned,
  req,
  onTogglePin,
  onToggleSet,
  onOpenGrid,
}: {
  set: ArmorSetInfo;
  pinned: boolean;
  req: 2 | 4 | undefined;
  onTogglePin: (setHash: number) => void;
  onToggleSet: (setHash: number, count: 2 | 4) => void;
  /** Open the roll-grid modal on this set. */
  onOpenGrid: (setHash: number) => void;
}) {
  const perk2Info = set.perks.find((p) => p.requiredCount === 2);
  const perk4Info = set.perks.find((p) => p.requiredCount === 4);
  return (
    <div className="group/set-row relative col-span-full grid grid-cols-subgrid items-center">
      {/* Pin sits in a reserved gutter inside the name column. Floating it
          outside the row (Figma 17:5828) gets clipped by the card padding and
          the settings pane's overflow-y-auto. */}
      <TooltipLabel label={pinned ? "Unpin set" : "Pin set"}>
        <button
          type="button"
          onClick={() => onTogglePin(set.setHash)}
          aria-label={pinned ? "Unpin set" : "Pin set"}
          className={cn(
            "absolute top-1/2 left-0 z-10 flex size-6 -translate-y-1/2 items-center justify-center rounded-none transition-opacity outline-none focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-outline-strong",
            pinned
              ? "text-foreground"
              : "text-muted-foreground opacity-0 group-hover/set-row:opacity-100 group-focus-within/set-row:opacity-100 hover:text-foreground",
          )}
        >
          <PushPin
            weight={pinned ? "fill" : "regular"}
            className="size-4"
            aria-hidden
          />
        </button>
      </TooltipLabel>
      <span className="truncate pl-7 text-sm">
        {set.name} ({set.ownedCount})
      </span>
      <SetPerkCell
        active={req === 2}
        disabled={set.ownedCount < 2}
        perk={perk2Info}
        onToggle={() => onToggleSet(set.setHash, 2)}
      />
      <SetPerkCell
        active={req === 4}
        disabled={set.ownedCount < 4}
        perk={perk4Info}
        onToggle={() => onToggleSet(set.setHash, 4)}
      />
      <TooltipLabel label={`${set.name} rolls by archetype`}>
        <button
          type="button"
          onClick={() => onOpenGrid(set.setHash)}
          aria-label={`${set.name} rolls by archetype`}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-outline-strong flex size-6 cursor-pointer items-center justify-center rounded-none outline-none focus-visible:ring-1"
        >
          <GridFour className="size-4" aria-hidden />
        </button>
      </TooltipLabel>
    </div>
  );
});

function perkTooltipContent(perk: SetPerkInfo | undefined): string | null {
  if (!perk) return null;
  return perk.description?.trim() || perk.name;
}

/**
 * One set-bonus cell (Figma 17:5704): a 16px checkbox and the perk name, both
 * toggling the requirement. The name carries the perk description as a tooltip.
 */
function SetPerkCell({
  active,
  disabled,
  perk,
  onToggle,
}: {
  active: boolean;
  disabled: boolean;
  perk: SetPerkInfo | undefined;
  onToggle: () => void;
}) {
  const tooltipContent = perkTooltipContent(perk);
  const label = (
    <button
      type="button"
      disabled={disabled}
      onClick={onToggle}
      aria-label={perk?.name}
      className={cn(
        "min-w-0 max-w-full truncate text-left text-sm disabled:cursor-not-allowed disabled:opacity-50",
        !disabled && "cursor-pointer",
      )}
    >
      {perk?.name}
    </button>
  );
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Checkbox
        checked={active}
        disabled={disabled}
        onCheckedChange={onToggle}
        aria-label={perk ? `Require ${perk.name}` : "Toggle set bonus"}
        className={cn(!disabled && "cursor-pointer")}
      />
      {tooltipContent ? (
        <Tooltip disableHoverablePopup>
          <TooltipTrigger delay={0} closeDelay={0} render={label} />
          <TooltipContent
            side="top"
            align="start"
            className="pointer-events-none max-w-sm px-4 py-3 text-sm leading-relaxed data-open:animate-none data-closed:animate-none"
          >
            {tooltipContent}
          </TooltipContent>
        </Tooltip>
      ) : (
        label
      )}
    </div>
  );
}
