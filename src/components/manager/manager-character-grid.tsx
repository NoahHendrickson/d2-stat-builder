"use client";

import { useMemo, useState, type ReactNode } from "react";
import Image from "next/image";
import { HugeiconsIcon } from "@hugeicons/react";
import { PlantIcon } from "@hugeicons/core-free-icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PowerValue } from "@/components/power-value";
import { StatGlyph } from "@/components/stat-glyph";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CLASS_NAMES,
  RACE_NAMES,
  STAT_DISPLAY_ORDER,
  STAT_LABELS,
  type StatIconMap,
} from "@/lib/armory/stats";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import type { BucketRow } from "@/lib/inventory/buckets";
import type { InventoryItem, ManagerCharacter, ManagerInventory } from "@/lib/inventory/build";
import { statIconsFromManifest } from "@/lib/manifest/stat-icons";
import { useManifest } from "@/lib/manifest/use-manifest";
import { CHARACTER_SLOTS } from "@/lib/inventory/moves";
import { cn } from "@/lib/utils";
import { useStoreValue } from "@/lib/value-store";
import { EmptyTile, ItemTile } from "./item-tile";
import { farmingStore } from "./farming";
import { useItemComparator } from "./view-menu";
import { dragStore, useManagerActions, usePhoneTiles, usePinnedPlateClass } from "./manager-context";
import { DropZone, canLand } from "./manager-drop-zone";
import { AlignedVault, SLOT_ROWS } from "./manager-vault";

const POSTMASTER_FALLBACK_CAPACITY = 21;
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
  const postmasterCapacity = inventory.postmasterCapacity ?? POSTMASTER_FALLBACK_CAPACITY;
  const columns = {
    gridTemplateColumns: `${compact ? "max-content" : `repeat(${characters.length}, max-content)`}${aligned ? " minmax(0, 1fr)" : ""}`,
  };
  // Nameplate, postmaster, then every slot row: each column spans them all on a subgrid,
  // so rows still line up across characters (and with the vault). Aligned, the vault's
  // title and tabs sit level with the nameplates (compact, a row of character tabs comes
  // first for them to share), and the vault ends with a row for what no character holds.
  const rowCount = 2 + SLOT_ROWS.length;
  const firstRow = aligned && compact ? 2 : 1;
  const manifestStatus = useManifest();
  const manifest = manifestStatus.state === "ready" ? manifestStatus.manifest : undefined;
  const statIcons = useMemo(() => statIconsFromManifest(manifest), [manifest]);
  const compare = useItemComparator();

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
        vault && "sticky top-8 z-20 -mx-4 -mt-3 px-4 pt-3 group-data-scrolled/manager:bg-glass-opaque",
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
            <CharacterHeader character={c} statIcons={statIcons} />
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
 * The character's emblem nameplate, laid out like the game's character select: class and
 * race beside the emblem's icon, Power at the top right. Pinned while the grid scrolls.
 * Dropping on it sends the item to that character (and pulls postmaster items).
 */
function CharacterHeader({
  character,
  statIcons,
}: {
  character: ManagerCharacter;
  statIcons: StatIconMap;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const pinnedPlate = usePinnedPlateClass();
  const farming = useStoreValue(farmingStore) === character.id;
  const name = CLASS_NAMES[character.classType] ?? "Guardian";
  const race = RACE_NAMES[character.raceType];
  const fallbackColor = character.emblemColor
    ? `rgb(${character.emblemColor.red} ${character.emblemColor.green} ${character.emblemColor.blue})`
    : undefined;

  return (
    <div className={pinnedPlate}>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label={`${name} options`}
                className="relative block h-14 w-full overflow-hidden text-left outline-none focus-visible:d2-tile-selected normal:rounded-[12px]"
              />
            }
          >
            {character.emblemBackgroundPath && !imgFailed ? (
              <Image
                src={`${BUNGIE_IMAGE_BASE}${character.emblemBackgroundPath}`}
                alt=""
                fill
                sizes="320px"
                className="object-cover object-left"
                onError={() => setImgFailed(true)}
                unoptimized
              />
            ) : (
              <div
                className="bg-muted absolute inset-0"
                style={fallbackColor ? { backgroundColor: fallbackColor } : undefined}
              />
            )}
            {/* A light wash past the icon, so text stays readable on bright emblems. */}
            <div className="absolute inset-0 bg-gradient-to-r from-transparent from-20% to-black/30" />
            {/* The 474×96 art carries its icon in its left square. Covering the plate, the art
                scales to its height (icon 56px) or, on wider plates, its width (icon 96/474 of it). */}
            <div className="absolute inset-y-0 right-0 left-[max(3.5rem,calc(100%*96/474))] flex items-start justify-between gap-2 py-1.5 pr-3 pl-1">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-lg leading-tight font-medium text-white">{name}</span>
                {race && <span className="truncate text-sm leading-tight text-white/60">{race}</span>}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <PowerValue value={character.light} size="lg" tone="gold" className="leading-none" />
                {character.maxPower !== undefined && (
                  <span
                    className="text-[11px] leading-none text-white/70 tabular-nums"
                    title="The highest gear power this character could equip from your whole account"
                  >
                    Max {character.maxPower}
                  </span>
                )}
              </div>
            </div>
            {farming && (
              <HugeiconsIcon
                icon={PlantIcon}
                className="absolute top-1.5 left-1.5 size-4 text-white drop-shadow"
                aria-label="Farming"
              />
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuItem
              className="h-auto items-start py-1.5"
              onClick={() => farmingStore.set(farming ? null : character.id)}
            >
              <HugeiconsIcon icon={PlantIcon} className="mt-0.5" aria-hidden />
              <span className="flex flex-col">
                {farming ? "Stop farming mode" : "Farming mode"}
                <span className="text-muted-foreground text-xs">
                  Keep a slot free in each gear slot by sending extras to the vault
                </span>
              </span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      <CharacterStats stats={character.stats} icons={statIcons} />
    </div>
  );
}

/** The character's six armor stat totals, in the game's order. */
function CharacterStats({
  stats,
  icons,
}: {
  stats: ManagerCharacter["stats"];
  icons: StatIconMap;
}) {
  if (Object.keys(stats).length === 0) return null;
  return (
    <dl className="flex justify-between pt-2 text-[11px]">
      {STAT_DISPLAY_ORDER.map((key) => (
        <div key={key} className="flex items-center gap-1">
          <dt>
            <StatGlyph src={icons[key]} label={STAT_LABELS[key]} className="size-3.5" />
          </dt>
          <dd className="tabular-nums">{stats[key] ?? "–"}</dd>
        </div>
      ))}
    </dl>
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

function PostmasterCell({ items, capacity }: { items: InventoryItem[]; capacity: number }) {
  // The game warns once the postmaster is close to overflowing (and losing items).
  const nearlyFull = items.length >= capacity - 3;
  const phone = usePhoneTiles();
  return (
    <div className="flex flex-col gap-2 pt-2">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <h3 className="d2-label">Postmaster</h3>
        <span
          className={cn("tabular-nums", nearlyFull ? "text-destructive" : "text-muted-foreground")}
        >
          {items.length === 0 ? "Empty" : `${items.length} / ${capacity}`}
        </span>
      </div>
      {items.length > 0 && (
        // Full-size tiles like every slot row (smaller ones clip the Power); four across
        // keeps the grid inside the column width the slot rows set.
        <div
          className="grid grid-cols-[repeat(4,60px)] gap-2"
          // Phones: a full line of tiles, like the slots under it.
          style={
            phone
              ? { gridTemplateColumns: `repeat(${phone.cols}, ${phone.tile}px)`, gap: phone.gap }
              : undefined
          }
        >
          {items.map((item) => (
            <ItemTile key={item.key} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
