"use client";

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Layout3ColumnIcon, Layout3RowIcon, Settings01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TooltipLabel } from "@/components/ui/tooltip";
import {
  ITEMS_LAYOUTS,
  setViewSettings,
  useViewSettings,
  type ItemsLayout,
} from "@/lib/inventory/view-settings";
import { seenFlag } from "@/lib/seen-flag";

const intro = seenFlag("stat-builder:items-layout-intro-seen");

const LAYOUTS: Record<ItemsLayout, { label: string; detail: string; icon: typeof Layout3RowIcon }> = {
  rows: {
    label: "Character rows",
    detail: "Like the in-game character screen",
    icon: Layout3RowIcon,
  },
  legacy: {
    label: "Legacy columns",
    detail: "Characters side by side in columns",
    icon: Layout3ColumnIcon,
  },
};

/**
 * The Items page's settings menu, by the sort menu: which layout it uses. The first visit
 * opens it by itself with a word on the new layout, so anyone who'd rather have the old
 * one finds the switch; closing it (any way) counts as seen. Only mounted on the client
 * once the inventory is in, so reading storage up front is safe.
 */
export function ItemsSettings() {
  const view = useViewSettings();
  const [introOpen, setIntroOpen] = useState(() => !intro.seen());
  const [open, setOpen] = useState(introOpen);

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next || !introOpen) return;
        intro.markSeen();
        setIntroOpen(false);
      }}
      // Opened by itself, it doesn't lock the page.
      modal={!introOpen}
    >
      <TooltipLabel label="Items settings">
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="Items settings" />}>
          <HugeiconsIcon icon={Settings01Icon} aria-hidden />
        </DropdownMenuTrigger>
      </TooltipLabel>
      <DropdownMenuContent align="end" className="w-72">
        {introOpen && (
          <>
            <div className="flex flex-col gap-1 px-1.5 pt-1 pb-1.5 text-sm">
              <p className="font-medium">New: character rows</p>
              <p className="text-muted-foreground text-xs">
                Items now looks like the in-game character screen. Prefer the old layout?
                Switch back here any time.
              </p>
            </div>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuGroup>
          <DropdownMenuLabel>Layout</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={view.layout}
            onValueChange={(layout) => setViewSettings({ ...view, layout: layout as ItemsLayout })}
          >
            {ITEMS_LAYOUTS.map((layout) => (
              <DropdownMenuRadioItem
                key={layout}
                value={layout}
                closeOnClick
                // Square, like the rest of the page. The picked layout: a light fill and a border.
                className="h-auto items-start rounded-none py-1.5 data-checked:border-foreground/20 data-checked:bg-foreground/8 data-checked:focus:border-foreground/25 data-checked:focus:bg-foreground/10"
              >
                <HugeiconsIcon icon={LAYOUTS[layout].icon} className="mt-0.5" aria-hidden />
                <span className="flex flex-col">
                  {LAYOUTS[layout].label}
                  <span className="text-muted-foreground text-xs">{LAYOUTS[layout].detail}</span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
