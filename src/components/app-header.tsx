"use client";

import Image from "next/image";
import { SidebarSimple } from "@phosphor-icons/react";
import { ViewTabs } from "@/components/view-tabs";
import { ArmoryStatus } from "@/components/armory/armory-status";
import { Button } from "@/components/ui/button";
import { TooltipLabel } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Figma 69:968 — a 76px strip over the backdrop: 28px logo + icon view switch
 * on the left, the armor / game-data / account cluster on the right. Lives on
 * the main column, not the loadouts sidebar.
 */
export function AppHeader({
  collapsed,
  onExpand,
  className,
}: {
  collapsed?: boolean;
  onExpand?: () => void;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex h-[76px] shrink-0 items-center justify-between gap-4 px-4",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-4">
        {collapsed && onExpand && (
          <TooltipLabel label="Show loadouts">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Show loadouts"
              onClick={onExpand}
            >
              <SidebarSimple weight="bold" aria-hidden />
            </Button>
          </TooltipLabel>
        )}
        <Image
          src="/sidebar-logo.svg"
          alt=""
          width={28}
          height={28}
          className="size-7 shrink-0 rounded-[4px]"
          unoptimized
          aria-hidden
        />
        <ViewTabs />
      </div>
      <ArmoryStatus variant="toolbar" />
    </header>
  );
}
