"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, Layout3ColumnIcon, Layout3RowIcon, Settings01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
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
  CHARACTER_COLUMNS,
  ITEMS_LAYOUTS,
  TILE_SIZES,
  setViewSettings,
  useViewSettings,
  type CharacterColumns,
  type ItemsLayout,
  type TileSize,
} from "@/lib/inventory/view-settings";
import { cn } from "@/lib/utils";
import { TOOLBAR_ICON_BUTTON } from "./toolbar-icon";

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

const TILE_SIZE_LABELS: Record<TileSize, string> = { large: "Large", medium: "Medium", small: "Small" };

/**
 * Square, like the rest of the page. The picked option: a light fill and a border. Hover
 * rings the option like the page's other controls (d2-hover-ring); its group spaces the
 * options apart (OPTION_GROUP), so a ring never runs into the next option's border.
 */
const PICKED_ITEM =
  "rounded-none d2-hover-ring transition-[background-color,border-color,outline-offset] data-checked:border-foreground/20 data-checked:bg-foreground/8 data-checked:focus:border-foreground/25 data-checked:focus:bg-foreground/10";
/** A radio group of PICKED_ITEMs: room between them for the hover ring (1px, 2px off). */
const OPTION_GROUP = "flex flex-col gap-1.5";

/**
 * The Items page's settings menu, by the sort menu: which layout it uses, how big its
 * item tiles are, and whether they show ornaments.
 */
export function ItemsSettings() {
  const view = useViewSettings();

  return (
    <DropdownMenu>
      <TooltipLabel label="Items settings">
        <DropdownMenuTrigger aria-label="Items settings" className={TOOLBAR_ICON_BUTTON}>
          <HugeiconsIcon icon={Settings01Icon} aria-hidden />
        </DropdownMenuTrigger>
      </TooltipLabel>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Layout</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            className={OPTION_GROUP}
            value={view.layout}
            onValueChange={(layout) => setViewSettings({ ...view, layout: layout as ItemsLayout })}
          >
            {ITEMS_LAYOUTS.map((layout) => (
              <DropdownMenuRadioItem
                key={layout}
                value={layout}
                closeOnClick
                className={cn("h-auto items-start py-1.5", PICKED_ITEM)}
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
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Item size</DropdownMenuLabel>
          {/* Stays open: the tiles resize behind it, so sizes can be tried in turn. */}
          <DropdownMenuRadioGroup
            className={OPTION_GROUP}
            value={view.tileSize}
            onValueChange={(tileSize) => setViewSettings({ ...view, tileSize: tileSize as TileSize })}
          >
            {TILE_SIZES.map((size) => (
              <DropdownMenuRadioItem key={size} value={size} className={PICKED_ITEM}>
                {TILE_SIZE_LABELS[size]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {/* A checkbox item leaves the menu open: the tiles swap their art behind it. */}
        <DropdownMenuCheckboxItem
          indicator="start"
          checked={view.showOrnaments}
          onCheckedChange={(checked) => setViewSettings({ ...view, showOrnaments: checked === true })}
          className="h-auto items-start py-1.5 [&>[data-slot=dropdown-menu-checkbox-item-indicator]]:top-2"
        >
          <span className="flex flex-col">
            Show ornaments
            <span className="text-muted-foreground text-xs">Exotic weapons always show theirs</span>
          </span>
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const CHARACTER_COLUMN_LABELS: Record<CharacterColumns, string> = {
  current: "Current character",
  all: "All characters",
};

/**
 * Legacy columns, beside the vault's tabs: just the character played last, in its place,
 * giving the vault the room (and its armor cut to that class); or every character side by
 * side. The same menu as the Items settings, so it highlights only what's under the
 * pointer and marks the pick the same way.
 */
export function CharacterColumnsMenu() {
  const view = useViewSettings();
  return (
    <DropdownMenu>
      {/* As tall as the tabs' well beside it, whatever the theme draws round that, and the
          same light fill. */}
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            aria-label={`Characters shown: ${CHARACTER_COLUMN_LABELS[view.characterColumns]}`}
            className="h-auto self-stretch bg-primary/6 py-0 pr-2 pl-2.5 font-normal"
          />
        }
      >
        {CHARACTER_COLUMN_LABELS[view.characterColumns]}
        <HugeiconsIcon icon={ArrowDown01Icon} className="size-4 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuRadioGroup
          className={OPTION_GROUP}
          value={view.characterColumns}
          onValueChange={(v) => setViewSettings({ ...view, characterColumns: v as CharacterColumns })}
        >
          {CHARACTER_COLUMNS.map((v) => (
            <DropdownMenuRadioItem key={v} value={v} closeOnClick className={PICKED_ITEM}>
              {CHARACTER_COLUMN_LABELS[v]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
