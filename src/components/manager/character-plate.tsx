"use client";

// A character's nameplates and postmaster, shared by both layouts: the narrow plate atop a
// character column, the strip across a character row, and the postmaster cell under each.
import { useEffect, useMemo, useState, type ReactNode } from "react";
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
import {
  CLASS_NAMES,
  RACE_NAMES,
  STAT_DISPLAY_ORDER,
  STAT_LABELS,
  type StatIconMap,
} from "@/lib/armory/stats";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import type { InventoryItem, ManagerCharacter, ManagerInventory } from "@/lib/inventory/build";
import { iconTint } from "@/lib/inventory/emblem-tint";
import type { Manifest } from "@/lib/manifest/load";
import { statIconsFromManifest } from "@/lib/manifest/stat-icons";
import { useManifest } from "@/lib/manifest/use-manifest";
import { cn } from "@/lib/utils";
import { useStoreValue } from "@/lib/value-store";
import { ItemTile } from "./item-tile";
import { farmingStore } from "./farming";
import { usePhoneLayout, useTileMetrics } from "./manager-context";
import { useItemComparator } from "./view-menu";

const POSTMASTER_FALLBACK_CAPACITY = 21;

/** A character column's nameplate height (and the vault's beside it). */
export const PLATE_HEIGHT = "h-14";
/** A character row's strip height (and the vault's nameplate beside the rows). */
export const STRIP_HEIGHT = "h-16";

const MAX_POWER_TITLE = "The highest gear power this character could equip from your whole account";

/** What every character layout reads alongside the inventory. */
export function useCharacterSetup(inventory: ManagerInventory): {
  manifest: Manifest | undefined;
  statIcons: StatIconMap;
  compare: (a: InventoryItem, b: InventoryItem) => number;
  postmasterCapacity: number;
} {
  const manifestStatus = useManifest();
  const manifest = manifestStatus.state === "ready" ? manifestStatus.manifest : undefined;
  const statIcons = useMemo(() => statIconsFromManifest(manifest), [manifest]);
  const compare = useItemComparator();
  return {
    manifest,
    statIcons,
    compare,
    postmasterCapacity: inventory.postmasterCapacity ?? POSTMASTER_FALLBACK_CAPACITY,
  };
}

/** Bungie's emblem colour as CSS, the fill while (or if) an emblem image doesn't load. */
function emblemColorCss(character: ManagerCharacter): string | undefined {
  const c = character.emblemColor;
  return c ? `rgb(${c.red} ${c.green} ${c.blue})` : undefined;
}

/**
 * A character column's emblem nameplate, laid out like the game's character select: class
 * and race beside the emblem's icon, Power at the top right, and its armor stats below.
 * Opens the character's menu (farming mode).
 */
export function CharacterNameplate({
  character,
  statIcons,
  className,
}: {
  character: ManagerCharacter;
  statIcons: StatIconMap;
  className?: string;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const farming = useStoreValue(farmingStore) === character.id;
  const name = CLASS_NAMES[character.classType] ?? "Guardian";
  const race = RACE_NAMES[character.raceType];
  const fallbackColor = emblemColorCss(character);

  return (
    <div className={className}>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label={`${name} options`}
              className={cn(
                "relative block w-full overflow-hidden text-left outline-none focus-visible:d2-tile-selected normal:rounded-[12px]",
                PLATE_HEIGHT,
              )}
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
                <span className="text-[11px] leading-none text-white/70 tabular-nums" title={MAX_POWER_TITLE}>
                  Max {character.maxPower}
                </span>
              )}
            </div>
          </div>
          {farming && <FarmingMark />}
        </DropdownMenuTrigger>
        <FarmingMenu characterId={character.id} farming={farming} />
      </DropdownMenu>
      <CharacterStats stats={character.stats} icons={statIcons} />
    </div>
  );
}

/**
 * The strip across a character row, drawn like the game's roster nameplates: the emblem's
 * square icon filling the strip's height at its left, the strip tinted a dark shade of the
 * icon's main colour (Bungie's emblem colour until that's read), the class in white with
 * the race greyed beside it, then `readout`, then Power over Max at the right; a light rule
 * along the bottom and a white bar closing the end. The icon and name open the character's
 * menu (`readout` can hold its own tooltips, which can't sit inside a button).
 */
export function CharacterStrip({
  character,
  readout,
}: {
  character: ManagerCharacter;
  readout: ReactNode;
}) {
  const [iconFailed, setIconFailed] = useState(false);
  const [tint, setTint] = useState<{ src: string; color: string }>();
  const farming = useStoreValue(farmingStore) === character.id;
  const name = CLASS_NAMES[character.classType] ?? "Guardian";
  const race = RACE_NAMES[character.raceType];
  const fallbackColor = emblemColorCss(character);
  const iconSrc = character.emblemPath ? `${BUNGIE_IMAGE_BASE}${character.emblemPath}` : undefined;
  // A tint read from an earlier emblem's icon doesn't carry over when the emblem changes.
  const stripColor = (tint?.src === iconSrc ? tint?.color : undefined) ?? fallbackColor;

  useEffect(() => {
    if (!iconSrc) return;
    // The tint is read off a copy loaded with anonymous CORS (canvas pixels need it). The
    // visible icon loads without it, so a response missing the CORS header only loses
    // the tint, never the icon.
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const color = iconTint(img);
      if (color) setTint({ src: iconSrc, color });
    };
    img.src = iconSrc;
    return () => {
      img.onload = null;
    };
  }, [iconSrc]);

  return (
    <div
      className={cn(
        "relative flex items-center overflow-hidden bg-[#131418] text-white normal:rounded-[12px]",
        STRIP_HEIGHT,
      )}
      style={stripColor ? { backgroundColor: `color-mix(in srgb, ${stripColor} 40%, #131418)` } : undefined}
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label={`${name} options`}
              className="relative flex h-full min-w-0 flex-1 items-center text-left outline-none focus-visible:d2-tile-selected"
            />
          }
        >
          {iconSrc && !iconFailed ? (
            <Image
              src={iconSrc}
              alt=""
              width={96}
              height={96}
              className="size-16 shrink-0"
              onError={() => setIconFailed(true)}
              unoptimized
            />
          ) : (
            <div className="bg-muted size-16 shrink-0" style={{ backgroundColor: fallbackColor }} />
          )}
          <span className="flex min-w-0 items-baseline gap-2 truncate pl-3 text-xl leading-none">
            {name}
            {race && <span className="text-white/50">{race}</span>}
          </span>
          {farming && <FarmingMark />}
        </DropdownMenuTrigger>
        <FarmingMenu characterId={character.id} farming={farming} />
      </DropdownMenu>
      <div className="flex shrink-0 items-center gap-6 pl-4">{readout}</div>
      {/* Power over Max, leaving the strip's width to the name and the readout. */}
      <div className="flex shrink-0 flex-col items-end gap-1.5 pr-4 pl-5">
        <PowerValue value={character.light} className="text-base leading-none" tone="gold" />
        {character.maxPower !== undefined && (
          <span className="text-xs leading-none text-white/60 tabular-nums" title={MAX_POWER_TITLE}>
            Max {character.maxPower}
          </span>
        )}
      </div>
      <span aria-hidden className="absolute right-1 bottom-0 left-16 h-0.5 bg-white/45" />
      <span aria-hidden className="h-full w-1 shrink-0 bg-white" />
    </div>
  );
}

function FarmingMark() {
  return (
    <HugeiconsIcon
      icon={PlantIcon}
      className="absolute top-1.5 left-1.5 size-4 text-white drop-shadow"
      aria-label="Farming"
    />
  );
}

/** The character menu: farming mode on or off. */
function FarmingMenu({ characterId, farming }: { characterId: string; farming: boolean }) {
  return (
    <DropdownMenuContent align="start" className="w-64">
      <DropdownMenuItem
        className="h-auto items-start py-1.5"
        onClick={() => farmingStore.set(farming ? null : characterId)}
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

export function PostmasterCell({ items, capacity }: { items: InventoryItem[]; capacity: number }) {
  // The game warns once the postmaster is close to overflowing (and losing items).
  const nearlyFull = items.length >= capacity - 3;
  const phone = usePhoneLayout();
  const tiles = useTileMetrics();
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
        // The slot rows' tile size; four across keeps the grid inside the column width they
        // set. Phones: a full line of tiles, like the slots under it.
        <div
          className="grid"
          style={{
            gridTemplateColumns: `repeat(${phone ? tiles.cols : 4}, ${tiles.tile}px)`,
            gap: tiles.gap,
          }}
        >
          {items.map((item) => (
            <ItemTile key={item.key} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
