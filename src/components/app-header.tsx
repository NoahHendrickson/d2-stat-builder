"use client";

import Image from "next/image";
import { SidebarSimple } from "@phosphor-icons/react";
import { ViewTabs } from "@/components/view-tabs";
import { ArmoryStatusToolbar } from "@/components/armory/armory-status";
import { Button } from "@/components/ui/button";
import { TooltipLabel } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Figma 46:1659 — logo + view switch on the left, compact account/status
 * cluster on the right. Lives on the main column, not the loadouts sidebar.
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
        "flex shrink-0 items-start justify-between gap-4 p-4 [--icon-tab-surface:var(--sidebar)]",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-4">
        {collapsed && onExpand && (
          <TooltipLabel label="Show sidebar">
            <Button
              variant="ghost"
              size="icon-lg"
              aria-label="Show sidebar"
              onClick={onExpand}
            >
              <SidebarSimple weight="bold" aria-hidden />
            </Button>
          </TooltipLabel>
        )}
        <Image
          src="/sidebar-logo.svg"
          alt=""
          width={36}
          height={36}
          className="size-9 shrink-0 rounded-[6px]"
          unoptimized
          aria-hidden
        />
        <ViewTabs />
      </div>
      <ArmoryStatusToolbar />
    </header>
  );
}
