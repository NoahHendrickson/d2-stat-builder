"use client";

import { useMemo } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import type { InventoryItem, ManagerInventory } from "@/lib/inventory/build";
import { characterName } from "@/lib/inventory/moves";
import { forEachItem } from "@/lib/inventory/search";
import { ItemTile } from "./item-tile";
import { useItemComparator } from "./view-menu";

interface Group {
  key: string;
  label: string;
  items: InventoryItem[];
}

/**
 * Every item the search matches in one place, grouped by where it is: each character,
 * their postmasters, the vault, then account-wide items. Non-modal like Compare, so a
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
  const groups = useMemo(() => {
    const byKey = new Map<string, Group>();
    const order: string[] = [
      ...inventory.characters.map((c) => `character:${c.id}`),
      ...inventory.characters.map((c) => `postmaster:${c.id}`),
      "vault",
      "account",
    ];
    const labels = new Map<string, string>([
      ...inventory.characters.map((c): [string, string] => [`character:${c.id}`, characterName(c)]),
      ...inventory.characters.map((c): [string, string] => [`postmaster:${c.id}`, `${characterName(c)} postmaster`]),
      ["vault", "Vault"],
      ["account", "Account"],
    ]);
    forEachItem(inventory, (item, place) => {
      if (!matches.has(item.key)) return;
      const key =
        place.kind === "character" || place.kind === "postmaster" ? `${place.kind}:${place.characterId}` : place.kind;
      let group = byKey.get(key);
      if (!group) byKey.set(key, (group = { key, label: labels.get(key) ?? "Other", items: [] }));
      group.items.push(item);
    });
    return order.flatMap((key) => {
      const group = byKey.get(key);
      return group ? [{ ...group, items: group.items.toSorted(compare) }] : [];
    });
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
      <div className="d2-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-4 py-3">
        {groups.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing matches.</p>
        ) : (
          groups.map((group) => (
            <section key={group.key} aria-label={group.label} className="flex flex-col gap-2">
              <h3 className="flex items-baseline gap-2 text-sm">
                <span className="font-medium">{group.label}</span>
                <span className="text-muted-foreground tabular-nums">{group.items.length.toLocaleString()}</span>
              </h3>
              <div className="flex flex-wrap gap-1">
                {group.items.map((item) => (
                  <ItemTile key={item.key} item={item} />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
