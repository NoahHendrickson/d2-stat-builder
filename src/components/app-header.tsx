"use client";

import { APP_HEADER_HEIGHT } from "@/components/app-sidebar";
import { ArmoryStatus } from "@/components/armory/armory-status";
import { cn } from "@/lib/utils";

/**
 * The main column's header strip: the current page's title on the left, the
 * armor / game-data / account cluster on the right (Figma 46:2947). Its height
 * matches the sidebar's brand row.
 */
export function AppHeader({ title, className }: { title: string; className?: string }) {
  return (
    <header
      className={cn(
        APP_HEADER_HEIGHT,
        "flex shrink-0 items-center justify-between gap-4 border-b border-foreground/8 px-6",
        className,
      )}
    >
      <h1 className="min-w-0 truncate text-base font-medium">{title}</h1>
      <ArmoryStatus variant="toolbar" />
    </header>
  );
}
