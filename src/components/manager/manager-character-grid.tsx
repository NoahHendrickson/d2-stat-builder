"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CLASS_NAMES } from "@/lib/armory/stats";
import { SLOT_ROWS, type BucketRow } from "@/lib/inventory/buckets";
import type { InventoryItem, ManagerCharacter, ManagerInventory } from "@/lib/inventory/build";
import { CHARACTER_SLOTS } from "@/lib/inventory/moves";
import { cn } from "@/lib/utils";
import { useStoreValue } from "@/lib/value-store";
import { EmptyTile, ItemTile } from "./item-tile";
import { CharacterNameplate, PostmasterCell, useCharacterSetup } from "./character-plate";
import { dragStore, useManagerActions, usePhoneTiles, usePinnedPlateClass } from "./manager-context";
import { DropZone, canLand } from "./manager-drop-zone";
import { AlignedVault } from "./manager-vault";

/** The phone vault tab's value: never a character id (those are long numbers). */
const VAULT_TAB = "vault";

/**
 * Every character side by side, or (when `compact`) one at a time under a tab strip,
 * starting on the one played last. The others stay mounted, just hidden, so a drag that
 * started on one still ends when a tab switches away from it. When `aligned`, the vault
 * is one more column on the same rows, so each of its slots starts level with that slot
 * on the characters, and a row is as tall as the taller of the two.
 */
export function InventoryGrid({
  inventory,
  compact,
  aligned,
  vault,
}: {
  inventory: ManagerInventory;
  compact: boolean;
  aligned: boolean;
  /**
   * Phones: the vault as one more tab after the characters, its pane in place of theirs
   * while picked. The tab strip stays pinned over both.
   */
  vault?: { open: boolean; onOpenChange: (open: boolean) => void; pane: ReactNode };
}) {
  const { characters } = inventory;
  const [picked, setPicked] = useState<string | null>(null);
  const shown = characters.find((c) => c.id === picked) ?? characters[0];
  const columns = {
    gridTemplateColumns: `${compact ? "max-content" : `repeat(${characters.length}, max-content)`}${aligned ? " minmax(0, 1fr)" : ""}`,
  };
  // Nameplate, postmaster, then every slot row: each column spans them all on a subgrid,
  // so rows still line up across characters (and with the vault). Aligned, the vault's
  // title and tabs sit level with the nameplates (compact, a row of character tabs comes
  // first for them to share), and the vault ends with a row for what no character holds.
  const rowCount = 2 + SLOT_ROWS.length;
  const firstRow = aligned && compact ? 2 : 1;
  const { statIcons, compare, postmasterCapacity } = useCharacterSetup(inventory);
  const pinnedPlate = usePinnedPlateClass();

  const vaultOpen = vault?.open ?? false;
  // Once opened, the vault pane stays mounted, hidden while a character shows: dragging a
  // vault tile onto a character tab switches to that character, and a drag source that
  // unmounts never gets its dragend.
  const [vaultMounted, setVaultMounted] = useState(false);
  if (vaultOpen && !vaultMounted) setVaultMounted(true);
  const tabs = compact && shown && (
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
      <div className={cn("grid", vaultOpen && "hidden")} style={columns}>
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
            style={{ gridRow: `${firstRow} / span ${rowCount}` }}
          >
            <CharacterNameplate character={c} statIcons={statIcons} className={pinnedPlate} />
            <PostmasterCell items={c.postmaster} capacity={postmasterCapacity} />
            {/* Weapons, armor, general: no headings, just a wider gap before each group. */}
            {SLOT_ROWS.map(({ row, groupStart }) => (
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
        {aligned && <AlignedVault inventory={inventory} headerRows={firstRow} rowSpan={firstRow + rowCount} />}
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
  const phone = usePhoneTiles();

  return (
    // Tiles keep to the top: an aligned row grows with the vault's slot beside it.
    <div
      className={cn("flex items-start gap-2 pb-2", groupStart && "pt-5")}
      style={phone ? { columnGap: phone.gap * 2, paddingBottom: phone.gap } : undefined}
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
        className={cn("grid grid-cols-[repeat(3,60px)] content-start gap-2 p-1", phone && "p-0")}
        style={
          phone
            ? { gridTemplateColumns: `repeat(${phone.cols - 1}, ${phone.tile}px)`, gap: phone.gap }
            : undefined
        }
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
