"use client";

import { useMemo } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import type { InventoryItem, ManagerInventory } from "@/lib/inventory/build";
import { forEachItem } from "@/lib/inventory/search";
import { ItemTile } from "./item-tile";
import { useItemComparator } from "./view-menu";

/**
 * Every item the search matches in one flat list, wherever it lives, in the View
 * menu's sort order. Non-modal like Compare, so a
 * tile opens its details popup over it and the search box stays live behind it.
 */
export function SearchResultsDrawer({
  inventory,
  query,
  matches,
  open,
  onClose,
}: {
  inventory: ManagerInventory;
  query: string;
  matches: ReadonlySet<string> | null;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Drawer open={open && matches !== null} onOpenChange={(o) => !o && onClose()} swipeDirection="down" modal={false}>
      <DrawerContent
        aria-label="Search results"
        className="d2-sidebar-opaque d2-line rounded-none border border-transparent shadow-none data-[swipe-axis=y]:[--drawer-content-max-height:min(70dvh,48rem)] [--bleed:0px] [--drawer-bleed-background:var(--glass-opaque)]"
        style={{ left: "var(--app-sidebar-width, 0px)" }}
      >
        {matches && <Results inventory={inventory} query={query} matches={matches} onClose={onClose} />}
      </DrawerContent>
    </Drawer>
  );
}

function Results({
  inventory,
  query,
  matches,
  onClose,
}: {
  inventory: ManagerInventory;
  query: string;
  matches: ReadonlySet<string>;
  onClose: () => void;
}) {
  const compare = useItemComparator();
  const items = useMemo(() => {
    const found: InventoryItem[] = [];
    forEachItem(inventory, (item) => {
      if (matches.has(item.key)) found.push(item);
    });
    return found.sort(compare);
  }, [inventory, matches, compare]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-foreground/12 flex items-center gap-3 border-b px-4 py-2.5">
        <DrawerTitle className="text-base font-medium">
          {matches.size.toLocaleString()} {matches.size === 1 ? "item" : "items"}
        </DrawerTitle>
        <span className="text-muted-foreground min-w-0 truncate font-mono text-xs">{query}</span>
        <Button size="icon-sm" variant="ghost" className="ml-auto" aria-label="Close search results" onClick={onClose}>
          <HugeiconsIcon icon={Cancel01Icon} aria-hidden />
        </Button>
      </div>
      <div className="d2-scroll min-h-0 flex-1 overflow-auto px-4 py-3">
        {items.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing matches.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {items.map((item) => (
              <ItemTile key={item.key} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
