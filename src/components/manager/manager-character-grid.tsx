"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CLASS_NAMES } from "@/lib/armory/stats";
import { SLOT_ROWS, slotRowsForVaultTab, type BucketRow } from "@/lib/inventory/buckets";
import type { ItemsPagePlan } from "@/lib/inventory/items-page-plan";
import { useViewSettings } from "@/lib/inventory/view-settings";
import type { InventoryItem, ManagerCharacter, ManagerInventory } from "@/lib/inventory/build";
import { CHARACTER_SLOTS } from "@/lib/inventory/moves";
import { cn } from "@/lib/utils";
import { useStoreValue } from "@/lib/value-store";
import { EmptyTile, ItemTile } from "./item-tile";
import { CharacterNameplate, PostmasterCell, useCharacterSetup } from "./character-plate";
import {
  dragStore,
  useManagerActions,
  usePhoneLayout,
  usePinnedPlateClass,
  useTileMetrics,
} from "./manager-context";
import { DropZone, canLand } from "./manager-drop-zone";
import { AlignedVault } from "./manager-vault";

/** The phone vault tab's value: never a character id (those are long numbers). */
const VAULT_TAB = "vault";

/**
 * Every character side by side (`all`); one at a time under a tab strip, starting on the
 * one played last (`tabs`); or just the one played last, with no tabs (`current`). Hidden
 * characters stay mounted, so a drag that started on one still ends when a tab switches
 * away from it. When `aligned`, the vault
 * is one more column on the same rows, so each of its slots starts level with that slot
 * on the characters, and a row is as tall as the taller of the two.
 */
export function InventoryGrid({
  inventory,
  characters: shownCharacters,
  aligned,
  vault,
  vaultAction,
}: {
  /** Current character: its vault armor already cut to that class (vaultForClass). */
  inventory: ManagerInventory;
  characters: Extract<ItemsPagePlan, { kind: "columns" }>["characters"];
  aligned: boolean;
  /** Aligned: a control beside the vault's tabs. */
  vaultAction?: ReactNode;
  /**
   * Phones: the vault as one more tab after the characters, its pane in place of theirs
   * while picked. The tab strip stays pinned over both.
   */
  vault?: { open: boolean; onOpenChange: (open: boolean) => void; pane: ReactNode };
}) {
  const { characters } = inventory;
  const [picked, setPicked] = useState<string | null>(null);
  const compact = shownCharacters !== "all";
  const currentOnly = shownCharacters === "current";
  const shown = (shownCharacters === "tabs" && characters.find((c) => c.id === picked)) || characters[0];
  const columns = {
    gridTemplateColumns: `${compact ? "max-content" : `repeat(${characters.length}, max-content)`}${aligned ? " minmax(0, 1fr)" : ""}`,
  };
  // Nameplate, postmaster, then every slot row: each column spans them all on a subgrid,
  // so rows still line up across characters (and with the vault). Aligned, the vault's
  // title and tabs sit level with the nameplates (compact, a row of character tabs comes
  // first for them to share), and the vault ends with a row for what no character holds.
  // Current character, on the aligned vault's Weapons or Armor tab: just those slots, so
  // they and the vault's tiles both start at the top. (A vault below keeps every slot, or
  // its tabs would jump under the pointer.)
  const { vaultTab } = useViewSettings();
  const rows = currentOnly && aligned ? slotRowsForVaultTab(vaultTab) : SLOT_ROWS;
  // The Armor tab beside every slot: the vault's armor runs from the top, past the weapon
  // slots (a drop anywhere on a character sends it there), not down level with the armor.
  const flowVault = aligned && vaultTab === "armor" && !currentOnly;
  const rowCount = 2 + rows.length;
  const firstRow = aligned && shownCharacters === "tabs" ? 2 : 1;
  /** The tabs row, if any, the characters' rows, then (aligned) the vault's last row. */
  const gridRows = firstRow - 1 + rowCount + (aligned ? 1 : 0);
  const { manifest, statIcons, compare, postmasterCapacity } = useCharacterSetup(inventory);
  const pinnedPlate = usePinnedPlateClass();
  const phone = usePhoneLayout();

  const vaultOpen = vault?.open ?? false;
  // Once opened, the vault pane stays mounted, hidden while a character shows: dragging a
  // vault tile onto a character tab switches to that character, and a drag source that
  // unmounts never gets its dragend.
  const [vaultMounted, setVaultMounted] = useState(false);
  if (vaultOpen && !vaultMounted) setVaultMounted(true);
  const tabs = shownCharacters === "tabs" && shown && (
    <Tabs
      value={vaultOpen ? VAULT_TAB : shown.id}
      onValueChange={(id) => {
        vault?.onOpenChange(id === VAULT_TAB);
        if (id !== VAULT_TAB) setPicked(id as string);
      }}
      className={cn(
        "pb-3",
        aligned && "col-[1/-2] row-start-1 self-end",
        // Pinned under the search bar (as the nameplates are on wider screens), filled once
        // something scrolls under it.
        vault && "sticky top-8 z-20 -mx-4 -mt-3 px-4 pt-3 group-data-scrolled/manager:d2-sticky-fill",
      )}
    >
      <TabsList variant="line" aria-label="Characters" className="w-full justify-start">
        {characters.map((c) => (
          <CharacterTab
            key={c.id}
            character={c}
            onPick={() => {
              vault?.onOpenChange(false);
              setPicked(c.id);
            }}
          />
        ))}
        {vault && (
          <TabsTrigger value={VAULT_TAB} className="flex-none px-1.5">
            Vault
          </TabsTrigger>
        )}
      </TabsList>
    </Tabs>
  );

  return (
    <section aria-label={aligned ? "Characters and vault" : "Characters"} className="flex flex-col">
      {!aligned && tabs}
      {vault && vaultMounted && <div className={cn(!vaultOpen && "hidden")}>{vault.pane}</div>}
      <div
        className={cn("grid", vaultOpen && "hidden")}
        style={{
          ...columns,
          // A flowing vault spans the slot rows and the vault's last row; that row is the
          // flexible one, so it grows to fit the vault and the slot rows keep their size.
          ...(flowVault && { gridTemplateRows: `repeat(${gridRows - 1}, auto) 1fr` }),
        }}
      >
        {aligned && tabs}
        {characters.map((c) => (
          // The whole column is one target (padding splits the gap between columns), so a
          // drop anywhere on a character sends the item there.
          <DropZone
            key={c.id}
            to={{ kind: "character", characterId: c.id }}
            column
            label={CLASS_NAMES[c.classType] ?? "Guardian"}
            className={cn(
              "grid grid-rows-subgrid",
              !compact ? "px-4 first:pl-0 last:pr-0" : c !== shown && "hidden",
              compact && aligned && "pr-3",
            )}
            // To the grid's end, so its pinned nameplate stays in view down a long vault.
            style={{ gridRow: `${firstRow} / ${gridRows + 1}` }}
          >
            <CharacterNameplate
              character={c}
              statIcons={statIcons}
              manifest={manifest}
              // Inset like the slot tiles in their drop zones, so the column has one edge.
              className={cn(pinnedPlate, !phone && "px-1")}
            />
            {/* Phones keep the plain cell: the card's frame would push a full line of tiles off screen. */}
            <PostmasterCell
              items={c.postmaster}
              capacity={postmasterCapacity}
              card={!phone}
              owner={CLASS_NAMES[c.classType] ?? "Guardian"}
            />
            {/* Weapons, armor, general: no headings, just a wider gap before each group. */}
            {rows.map(({ row, groupStart }) => (
              <CharacterCell
                key={row.hash}
                character={c}
                row={row}
                groupStart={groupStart}
                compare={compare}
              />
            ))}
          </DropZone>
        ))}
        {aligned && (
          <AlignedVault
            inventory={inventory}
            headerRows={firstRow}
            rowSpan={gridRows}
            rows={rows}
            flow={flowVault}
            action={vaultAction}
          />
        )}
      </div>
    </section>
  );
}

/**
 * A character's tab in the compact grid. Dragging an item over it switches to that
 * character, so the item can go onto a slot there; dropping on the tab itself sends the
 * item to that character.
 */
function CharacterTab({ character, onPick }: { character: ManagerCharacter; onPick: () => void }) {
  const actions = useManagerActions();
  const drag = useStoreValue(dragStore);
  const [over, setOver] = useState(false);
  const to = { kind: "character", characterId: character.id } as const;
  const accepts = drag !== null && actions !== null && canLand(actions, drag, to);

  return (
    <TabsTrigger
      value={character.id}
      className={cn("flex-none px-1.5", accepts && (over ? "bg-foreground/15" : "bg-foreground/5"))}
      onDragEnter={() => {
        if (drag) onPick();
      }}
      onDragOver={(e) => {
        if (!accepts) return;
        setOver(true);
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        if (!accepts || !actions) return;
        e.preventDefault();
        actions.move(drag.item, drag.place, to);
        actions.dragEnd();
      }}
    >
      {CLASS_NAMES[character.classType] ?? "Guardian"}
    </TabsTrigger>
  );
}

/**
 * One slot for one character: the equipped item (drop here to equip), then a 3×3 grid
 * of the rest (drop here to send it to this character).
 */
function CharacterCell({
  character,
  row,
  groupStart,
  compare,
}: {
  character: ManagerCharacter;
  row: BucketRow;
  /** First row of weapons / armor / general: set apart from the group above. */
  groupStart: boolean;
  compare: (a: InventoryItem, b: InventoryItem) => number;
}) {
  const equipped = character.equipped[row.hash];
  const unsorted = character.inventory[row.hash];
  const items = useMemo(() => [...(unsorted ?? [])].sort(compare), [unsorted, compare]);
  const empty = Math.max(0, CHARACTER_SLOTS - items.length);
  // Phones: the rest of the slot in as many columns as fill the width (two rows, not three),
  // a double gap after the equipped tile, and no drop padding (touch doesn't drag).
  const phone = usePhoneLayout();
  const tiles = useTileMetrics();

  return (
    // Tiles keep to the top: an aligned row grows with the vault's slot beside it.
    <div
      // Wider screens: the 3×3 grid keeps to the column's right edge, level with the
      // postmaster card's when that widens the column past the slot.
      className={cn("flex items-start", !phone && "justify-between", groupStart && "pt-5")}
      style={{ columnGap: phone ? tiles.gap * 2 : tiles.gap, paddingBottom: tiles.gap }}
      aria-label={row.label}
    >
      <DropZone
        to={{ kind: "character", characterId: character.id, equipped: true }}
        bucket={row.hash}
        className={cn("self-start p-1", phone && "p-0")}
      >
        {equipped ? <ItemTile item={equipped} /> : <EmptyTile />}
      </DropZone>
      <DropZone
        to={{ kind: "character", characterId: character.id }}
        bucket={row.hash}
        className={cn("grid content-start p-1", phone && "p-0")}
        style={{
          gridTemplateColumns: `repeat(${phone ? tiles.cols - 1 : 3}, ${tiles.tile}px)`,
          gap: tiles.gap,
        }}
      >
        {items.map((item) => (
          <ItemTile key={item.key} item={item} />
        ))}
        {Array.from({ length: empty }, (_, i) => (
          <EmptyTile key={i} />
        ))}
      </DropZone>
    </div>
  );
}
