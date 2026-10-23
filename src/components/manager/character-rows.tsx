"use client";

import { useMemo, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import Image from "next/image";
import { TooltipLabel } from "@/components/ui/tooltip";
import { StatGlyph } from "@/components/stat-glyph";
import { SetBonusChip, setBonusesFor } from "@/components/loadouts/loadout-row-details";
import {
  CLASS_NAMES,
  STAT_DISPLAY_ORDER,
  STAT_LABELS,
  type StatIconMap,
} from "@/lib/armory/stats";
import {
  ARMOR_ROWS,
  BUCKETS,
  GENERAL_ROWS,
  WEAPON_ROWS,
  type BucketRow,
} from "@/lib/inventory/buckets";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import { equippedSetCounts } from "@/lib/inventory/armor-details";
import {
  BREAKER_NAMES,
  type InventoryItem,
  type ManagerCharacter,
  type ManagerInventory,
} from "@/lib/inventory/build";
import { CHARACTER_SLOTS } from "@/lib/inventory/moves";
import {
  ROW_COLUMN_GAP_PX,
  ROW_INVENTORY_COLUMNS,
  ROW_MIDDLE_PX,
  ZONE_PAD_PX,
  rowInfoWidth,
  zoneWidth,
} from "@/lib/inventory/items-page-plan";
import { ABILITY_LABELS } from "@/lib/dim/subclasses";
import type { Manifest } from "@/lib/manifest/load";
import { ManifestIcon, PlugIcon } from "@/components/loadouts/loadout-icons";
import { ClassGlyph } from "@/components/class-glyph";
import { EmptyTile, ItemTile } from "./item-tile";
import { CharacterStrip, PostmasterCell, useCharacterSetup } from "./character-plate";
import { DropZone } from "./manager-drop-zone";
import { useTileMetrics } from "./manager-context";

const [GHOST_ROW, SPARROW_ROW, SHIP_ROW] = GENERAL_ROWS as [BucketRow, BucketRow, BucketRow];

/**
 * Wider screens: one row per character, laid out like the game's character screen. The
 * nameplate strip across the top; under it the postmaster, over a big faint class sigil,
 * and the gear: the subclass, weapons and Ghost down the left, the armor down the right,
 * then the Sparrow and Ship, one each side. Each slot's unequipped items sit in a 3×3 grid
 * on the side away from the middle.
 */
export function CharacterRows({ inventory }: { inventory: ManagerInventory }) {
  const { manifest, statIcons, compare, postmasterCapacity } = useCharacterSetup(inventory);

  return (
    <section aria-label="Characters" className="flex shrink-0 flex-col gap-10">
      {inventory.characters.map((c) => (
        <CharacterRow
          key={c.id}
          character={c}
          statIcons={statIcons}
          manifest={manifest}
          compare={compare}
          postmasterCapacity={postmasterCapacity}
        />
      ))}
    </section>
  );
}

/** Each slot's grid line and side: the game's, with the Sparrow and Ship on a line of their own. */
const SLOT_PLACES: { row: BucketRow; line: number; side: "left" | "right" }[] = [
  // The subclass takes the left of line 1.
  ...WEAPON_ROWS.map((row, i) => ({ row, line: i + 2, side: "left" as const })),
  { row: GHOST_ROW, line: WEAPON_ROWS.length + 2, side: "left" },
  ...ARMOR_ROWS.map((row, i) => ({ row, line: i + 1, side: "right" as const })),
  { row: SPARROW_ROW, line: ARMOR_ROWS.length + 1, side: "left" },
  { row: SHIP_ROW, line: ARMOR_ROWS.length + 1, side: "right" },
];

function CharacterRow({
  character,
  statIcons,
  manifest,
  compare,
  postmasterCapacity,
}: {
  character: ManagerCharacter;
  statIcons: StatIconMap;
  manifest: Manifest | undefined;
  compare: (a: InventoryItem, b: InventoryItem) => number;
  postmasterCapacity: number;
}) {
  const tiles = useTileMetrics();
  const inventory = zoneWidth(ROW_INVENTORY_COLUMNS, tiles);
  const equipped = zoneWidth(1, tiles);
  // Inventory, equipped, the middle gap, equipped, inventory.
  const gear: CSSProperties = {
    gridTemplateColumns: `${inventory}px ${equipped}px ${ROW_MIDDLE_PX}px ${equipped}px ${inventory}px`,
    columnGap: tiles.gap,
    rowGap: tiles.gap,
  };

  return (
    // The whole row is one target, so a drop anywhere on a character sends the item there.
    <DropZone
      to={{ kind: "character", characterId: character.id }}
      column
      label={CLASS_NAMES[character.classType] ?? "Guardian"}
      className="isolate"
    >
      {/* The strip as a header across the row, carrying the stats, champions, and set
          bonuses; under it the postmaster and the gear, their tops level. */}
      <div className="flex flex-col gap-4">
        <CharacterStrip
          character={character}
          readout={<StripReadout character={character} statIcons={statIcons} manifest={manifest} />}
        />
        <div className="flex items-start" style={{ columnGap: ROW_COLUMN_GAP_PX }}>
          {/* pt-1: level with the tiles, which sit inside their drop zones' padding. */}
          <div className="relative shrink-0 self-stretch pt-1" style={{ width: rowInfoWidth(tiles) }}>
            {/* The class's sigil, big and faint behind the column, in place of a banner. */}
            <ClassGlyph
              aria-hidden
              classType={character.classType}
              className="pointer-events-none absolute top-1/2 left-1/2 -z-10 h-88 w-auto -translate-x-1/2 -translate-y-1/2 text-foreground opacity-[0.07]"
            />
            <PostmasterCell items={character.postmaster} capacity={postmasterCapacity} />
          </div>
          <div className="grid self-start" style={gear}>
            <SubclassSlot character={character} manifest={manifest} />
            {SLOT_PLACES.map(({ row, line, side }) => (
              <Slot
                key={row.hash}
                character={character}
                row={row}
                line={line}
                side={side}
                compare={compare}
              />
            ))}
          </div>
        </div>
      </div>
    </DropZone>
  );
}

/**
 * What the nameplate strip carries: the character's six armor stats (value, then icon) in
 * a row, the champions its weapons stun, and a round cell per set bonus its
 * equipped armor has active.
 */
function StripReadout({
  character,
  statIcons,
  manifest,
}: {
  character: ManagerCharacter;
  statIcons: StatIconMap;
  manifest: Manifest | undefined;
}) {
  const { equipped } = character;
  const bonuses = useMemo(
    () => (manifest ? setBonusesFor(equippedSetCounts(equipped, manifest), manifest) : []),
    [equipped, manifest],
  );

  return (
    <div role="group" aria-label="Stats and set bonuses" className="flex items-center gap-5">
      <dl className="flex items-center gap-4 text-sm leading-none tabular-nums">
        {STAT_DISPLAY_ORDER.map((key) => (
          // Value first, as the game lists them; the icon names the stat.
          <div key={key} className="flex flex-row-reverse items-center gap-1">
            <dt>
              <StatGlyph src={statIcons[key]} label={STAT_LABELS[key]} className="size-4" />
            </dt>
            <dd>{character.stats[key] ?? "–"}</dd>
          </div>
        ))}
      </dl>
      <ChampionStuns equipped={equipped} manifest={manifest} />
      <SetBonusChip bonuses={bonuses} small className="gap-1" />
    </div>
  );
}

/** Teal, as the game draws a loadout's champion icons. */
const CHAMPION_TILE = "#2f8b8f";

/** Champion types by BreakerType, in the game's order: Barrier, Overload, Unstoppable. */
const CHAMPION_TYPES = Object.keys(BREAKER_NAMES).map(Number);

/**
 * A tile per champion type, in the game's order: teal with the icon when an equipped
 * weapon stuns it on its own (by its frame or an intrinsic), clear and faded when none
 * does. The seasonal artifact's champion perks aren't counted. The tooltip names the
 * weapons.
 */
function ChampionStuns({
  equipped,
  manifest,
}: {
  equipped: ManagerCharacter["equipped"];
  manifest: Manifest | undefined;
}) {
  const icons = useMemo(() => {
    const byType = new Map<number, string>();
    for (const breaker of Object.values(manifest?.all("DestinyBreakerTypeDefinition") ?? {})) {
      const icon = breaker.displayProperties?.icon;
      if (icon) byType.set(breaker.enumValue, icon);
    }
    return byType;
  }, [manifest]);
  const weapons = new Map<number, string[]>();
  for (const row of WEAPON_ROWS) {
    const weapon = equipped[row.hash];
    if (!weapon?.breakerType) continue;
    weapons.set(weapon.breakerType, [...(weapons.get(weapon.breakerType) ?? []), weapon.name]);
  }

  return (
    <ul aria-label="Champions your weapons stun" className="flex gap-1">
      {CHAMPION_TYPES.map((type) => {
        const stunning = weapons.get(type);
        const icon = icons.get(type);
        const label = `${BREAKER_NAMES[type]}: ${stunning ? stunning.join(", ") : "no equipped weapon stuns it on its own"}`;
        return (
          <li key={type}>
            <TooltipLabel label={label}>
              <span
                tabIndex={0}
                aria-label={label}
                className={cn(
                  "flex size-6 items-center justify-center outline-none focus-visible:d2-tile-selected normal:rounded-sm",
                  !stunning && "border border-white/20",
                )}
                style={stunning ? { background: CHAMPION_TILE } : undefined}
              >
                {icon && (
                  <Image
                    src={`${BUNGIE_IMAGE_BASE}${icon}`}
                    alt=""
                    width={16}
                    height={16}
                    className={cn("size-4", !stunning && "opacity-30")}
                    unoptimized
                  />
                )}
              </span>
            </TooltipLabel>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The subclass line's icons for a tile size: the widest line (four abilities, or six
 * fragments 2px apart) fits the 3×3 grid's width, and the Super's diamond its column.
 */
function subclassIcons(tile: number) {
  if (tile >= 60) return { ability: "size-10", fragment: "size-[30px]", super: 64 } as const;
  if (tile >= 52) return { ability: "size-9", fragment: "size-[26px]", super: 48 } as const;
  return { ability: "size-8", fragment: "size-[22px]", super: 48 } as const;
}

/**
 * The subclass line: the equipped Super's diamond (the subclass's own icon until the
 * manifest knows the Super), and to its left what it's set up with, like the weapons'
 * 3×3 grids: abilities, then aspects, then fragments, a line each. For show only.
 */
function SubclassSlot({
  character,
  manifest,
}: {
  character: ManagerCharacter;
  manifest: Manifest | undefined;
}) {
  const setup = character.subclass;
  const item = character.equipped[BUCKETS.subclass];
  const superHash = setup?.abilities.find((a) => a.kind === "super")?.hash;
  const superDef = manifest?.def("DestinyInventoryItemDefinition", superHash);
  const abilities = setup?.abilities.filter((a) => a.kind !== "super") ?? [];
  const tiles = useTileMetrics();
  const icons = subclassIcons(tiles.tile);
  const tile = manifest && {
    manifest,
    size: 40 as const,
    sizeClassName: icons.ability,
    className: "rounded-none",
    element: setup?.subclass,
  };

  return (
    <>
      {tile && setup && (
        <div
          role="group"
          aria-label="Subclass setup"
          className="flex flex-col items-end gap-2 self-start p-1"
          style={{ gridRow: 1, gridColumn: 1 }}
        >
          {abilities.length > 0 && (
            <div className="flex gap-1">
              {abilities.map(({ kind, hash }) => (
                <PlugIcon key={kind} hash={hash} suffix={ABILITY_LABELS[kind]} {...tile} />
              ))}
            </div>
          )}
          {setup.aspects.length > 0 && (
            <div className="flex gap-1">
              {setup.aspects.map((hash, i) => (
                <PlugIcon key={`${hash}-${i}`} hash={hash} suffix="Aspect" {...tile} />
              ))}
            </div>
          )}
          {setup.fragments.length > 0 && (
            // Up to six: 30px each with large tiles, 2px apart, fits the 3×3 grid's width (204px).
            <div className="flex gap-0.5">
              {setup.fragments.map((hash, i) => (
                <PlugIcon
                  key={`${hash}-${i}`}
                  hash={hash}
                  suffix="Fragment"
                  classType={character.classType}
                  {...tile}
                  size={32}
                  sizeClassName={icons.fragment}
                />
              ))}
            </div>
          )}
        </div>
      )}
      <div
        className="flex items-center justify-center self-start"
        style={{ gridRow: 1, gridColumn: 2, height: tiles.height + 2 * ZONE_PAD_PX }}
      >
        {item && (
          <ManifestIcon
            icon={superDef?.displayProperties?.icon ?? item.icon}
            label={superDef ? `${superDef.displayProperties.name}, ${item.name}` : item.name}
            size={icons.super}
            className="rounded-none"
            diamond={superDef?.displayProperties?.icon !== undefined}
            element={setup?.subclass}
          />
        )}
      </div>
    </>
  );
}

/**
 * One slot on one grid line: the equipped item (drop here to equip) and the rest of the
 * slot (drop here to send it to this character), on the side away from the middle. The
 * left side's items run right to left, so the first one sits next to the equipped item.
 */
function Slot({
  character,
  row,
  line,
  side,
  compare,
}: {
  character: ManagerCharacter;
  row: BucketRow;
  /** The grid line it sits on (1–6). */
  line: number;
  side: "left" | "right";
  compare: (a: InventoryItem, b: InventoryItem) => number;
}) {
  const equipped = character.equipped[row.hash];
  const unsorted = character.inventory[row.hash];
  const items = useMemo(() => [...(unsorted ?? [])].sort(compare), [unsorted, compare]);
  const empty = Math.max(0, CHARACTER_SLOTS - items.length);
  const left = side === "left";
  const tiles = useTileMetrics();

  return (
    <>
      <DropZone
        to={{ kind: "character", characterId: character.id, equipped: true }}
        bucket={row.hash}
        label={`${row.label}, equipped`}
        className="self-start p-1"
        style={{ gridRow: line, gridColumn: left ? 2 : 4 }}
      >
        {equipped ? <ItemTile item={equipped} /> : <EmptyTile />}
      </DropZone>
      <DropZone
        to={{ kind: "character", characterId: character.id }}
        bucket={row.hash}
        label={row.label}
        className="grid content-start self-start p-1 *:[direction:ltr]"
        style={{
          gridRow: line,
          gridColumn: left ? 1 : 5,
          gridTemplateColumns: `repeat(${ROW_INVENTORY_COLUMNS}, ${tiles.tile}px)`,
          gap: tiles.gap,
          direction: left ? "rtl" : undefined,
        }}
      >
        {items.map((item) => (
          <ItemTile key={item.key} item={item} />
        ))}
        {Array.from({ length: empty }, (_, i) => (
          <EmptyTile key={i} />
        ))}
      </DropZone>
    </>
  );
}
