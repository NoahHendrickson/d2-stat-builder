"use client";

import Image from "next/image";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PerkTooltip } from "@/components/weapons/perk-tooltip";
import type { clarityLines } from "@/lib/weapons/clarity";
import type { PerkRef } from "@/lib/weapons/types";

/**
 * The frame (intrinsic) as the Items popover shows it under its header: a
 * tinted strip with the icon and name, its description on hover. Sits flush
 * under a section's rule and runs out to the card's edges.
 */
export function FrameRow({
  perk,
  insight,
}: {
  perk: PerkRef;
  insight: ReturnType<typeof clarityLines>;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        delay={0}
        render={
          <div className="-mx-(--card-spacing) -mt-(--card-spacing) mb-3 flex items-center gap-2 bg-foreground/4 px-(--card-spacing) py-2 text-xs" />
        }
      >
        {perk.icon && (
          <Image
            src={`https://www.bungie.net${perk.icon}`}
            alt=""
            width={24}
            height={24}
            className="size-6 shrink-0"
            unoptimized
          />
        )}
        {perk.name}
      </TooltipTrigger>
      <TooltipContent side="right" align="start" className="max-w-sm">
        <PerkTooltip perk={perk} insight={insight} />
      </TooltipContent>
    </Tooltip>
  );
}
