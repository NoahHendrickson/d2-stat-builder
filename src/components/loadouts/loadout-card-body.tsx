"use client";

import type { CSSProperties, ReactNode } from "react";
import { subclassFromPlug } from "@/lib/armory/fragments";
import { isFullyMasterworked } from "@/lib/armory/masterwork";
import { armorPipTier } from "@/lib/armory/normalize";
import { SLOT_LABELS } from "@/lib/armory/stats";
import { artifactPerkColumns, artifactPerkSockets } from "@/lib/armory/artifact-items";
import { ABILITY_KINDS, ABILITY_LABELS } from "@/lib/dim/subclasses";
import type { Manifest } from "@/lib/manifest/load";
import { WEAPON_SLOT_LABELS } from "@/lib/armory/weapons";
import type {
  ResolvedArtifact,
  ResolvedArmorItem,
  ResolvedLoadout,
  ResolvedSubclass,
  ResolvedWeaponItem,
} from "@/lib/loadouts/resolve";
import { superSocketIndex } from "@/lib/loadouts/subclass";
import type { SavedLoadout } from "@/lib/loadouts/types";
import { archetypeStatIcon } from "@/lib/armory/archetypes";
import { ArmorThumb } from "@/components/armor-thumb";
import {
  ArchetypeGlyph,
  ITEM_TILE_FOOTER_PX,
  MasterworkGlow,
} from "@/components/item-tile-parts";
import { ManifestIcon, PlugIcon, TILE_FRAME } from "@/components/loadouts/loadout-row-details";
import { LOADOUT_SLOT_WELL_CLASS } from "@/components/loadouts/loadout-weapons-editor";
import { cn } from "@/lib/utils";

/** Mod tiles: 44px on the wide card, 36px in the compact icon columns. */
const MOD_SIZE_CLASS = "size-9 @3xl:size-11";

/** A subclass or armor column: the same corner-tick well as the editor's columns. */
const COLUMN_WELL_CLASS = "d2-corner-well flex h-full min-w-0 flex-col p-2 @3xl:p-3";

/**
 * A mod tile in an armor box: the fixed sizes in the compact icon columns, then from `@6xl`
 * one cell of the box's grid (see PieceColumn).
 */
const PIECE_MOD_CLASS = cn(MOD_SIZE_CLASS, "@6xl:aspect-square @6xl:h-auto @6xl:w-full");

/** An unfilled mod socket: the game's empty-slot bracket corners. */
function EmptySocket({ className }: { className: string }) {
  return <span className={cn("d2-brackets shrink-0 bg-black/20", className)} aria-hidden />;
}

type SocketTile = { index: number; hash?: number };

/**
 * One row of mod tiles. From `@6xl` the row dissolves into the armor box's grid;
 * `newLine` starts its first tile on a fresh grid line beside the thumbnail.
 */
function ModRow({
  sockets,
  manifest,
  newLine = false,
}: {
  sockets: SocketTile[];
  manifest: Manifest;
  newLine?: boolean;
}) {
  if (sockets.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 @6xl:contents">
      {sockets.map(({ index, hash }, i) => {
        const tileClass = cn(PIECE_MOD_CLASS, newLine && i === 0 && "@6xl:col-start-2");
        return hash === undefined ? (
          <EmptySocket key={index} className={tileClass} />
        ) : (
          <PlugIcon
            key={index}
            hash={hash}
            manifest={manifest}
            size={40}
            sizeClassName={tileClass}
            className="rounded-none"
          />
        );
      })}
    </div>
  );
}

/** A run of tiles; groups are told apart by the gaps between them, not labels. */
function TileRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1">
      {children}
    </div>
  );
}

/** A saved weapon as the editor's slot shows it: art, slot, name, type. */
function WeaponSlot({ item }: { item: ResolvedWeaponItem }) {
  const label = WEAPON_SLOT_LABELS[item.slot];
  return (
    <div role="group" aria-label={`${label} weapon: ${item.name}`} className={LOADOUT_SLOT_WELL_CLASS}>
      <ArmorThumb
        icon={item.icon}
        watermark={item.weapon?.watermark}
        size={48}
        className={cn(item.missing && "opacity-50")}
      />
      <span className="flex min-w-0 flex-col">
        <span className="d2-label text-[10px] leading-4">{label}</span>
        <span
          className={cn("truncate text-sm leading-5", item.weapon?.isExotic && "text-exotic")}
          title={item.name}
        >
          {item.name}
        </span>
        <span className="text-muted-foreground truncate text-xs leading-4">
          {item.missing ? <span className="text-warning">Missing</span> : item.weapon?.typeName}
        </span>
      </span>
    </div>
  );
}

/**
 * The saved artifact at the foot of the subclass box: its name on top, then the art with
 * its perks in grid order beside it, two rows of four.
 */
function ArtifactBlock({ artifact, manifest }: { artifact: ResolvedArtifact; manifest: Manifest }) {
  const picked = new Set(artifact.perks);
  const ordered = artifactPerkColumns(artifactPerkSockets(manifest, artifact.itemHash))
    .flat()
    .filter((hash) => picked.has(hash));
  // A perk the cached columns don't list still shows, after the rest.
  const perks = [...ordered, ...artifact.perks.filter((hash) => !ordered.includes(hash))];
  return (
    <div
      role="group"
      aria-label={`Artifact: ${artifact.name}`}
      className="mt-auto flex flex-col gap-2 border-t border-foreground/15 pt-3"
    >
      <span className="truncate text-sm font-medium" title={artifact.name}>
        {artifact.name}
      </span>
      <div className="flex min-w-0 items-center gap-2.5">
        <ArmorThumb icon={artifact.icon} size={64} className={TILE_FRAME} />
        {perks.length > 0 ? (
          <div role="group" aria-label="Artifact perks" className="grid grid-cols-4 gap-1">
            {perks.map((hash) => (
              <PlugIcon
                key={hash}
                hash={hash}
                manifest={manifest}
                size={32}
                className="rounded-none"
                framed
              />
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">No perks</p>
        )}
      </div>
    </div>
  );
}

/**
 * Super as the column's badge, then one evenly spaced grid of tiles: abilities and aspects
 * on the first row, fragments on the second. Names live in the tooltips. The artifact,
 * when saved, sits at the foot.
 */
function SubclassColumn({
  subclass,
  artifact,
  manifest,
  classType,
}: {
  subclass: ResolvedSubclass | undefined;
  artifact: ResolvedArtifact | undefined;
  manifest: Manifest;
  classType: number;
}) {
  const artifactBlock = artifact && <ArtifactBlock artifact={artifact} manifest={manifest} />;
  if (!subclass) {
    return (
      <section aria-label="Subclass" className={cn(COLUMN_WELL_CLASS, "gap-3")}>
        <p className="text-muted-foreground text-xs">No subclass saved</p>
        {artifactBlock}
      </section>
    );
  }
  const subclassDef = manifest.def("DestinyInventoryItemDefinition", subclass.itemHash);
  const subclassName =
    subclassDef?.displayProperties?.name ?? subclass.subclass ?? "Subclass";
  const superStart = superSocketIndex(manifest, subclass.itemHash);
  const initialSuperHash =
    superStart !== undefined
      ? subclassDef?.sockets?.socketEntries[superStart]?.singleInitialItemHash
      : undefined;
  const superDef = manifest.def(
    "DestinyInventoryItemDefinition",
    subclass.superHash ?? (initialSuperHash || undefined),
  );
  const superName = superDef?.displayProperties?.name;
  // Pinned abilities besides the Super, in socket order (class ability, jump, melee, grenade).
  const abilities = ABILITY_KINDS.filter((kind) => kind !== "super").flatMap((kind) => {
    const hash = subclass.abilityHashes[kind];
    return hash === undefined ? [] : [{ kind, hash }];
  });

  // 40px so four abilities + two aspects, or six fragments, fit the 18.5rem column on one line.
  const tile = {
    manifest,
    size: 40,
    sizeClassName: "size-10",
    className: "rounded-none",
    element: subclass.subclass,
  } as const;

  return (
    <section aria-label={`Subclass: ${subclassName}`} className={cn(COLUMN_WELL_CLASS, "gap-3")}>
      <div className="flex min-w-0 items-center gap-2.5">
        <ManifestIcon
          icon={superDef?.displayProperties?.icon ?? subclassDef?.displayProperties?.icon}
          label={superName ? `${superName}, ${subclassName}` : subclassName}
          size={48}
          className="rounded-none"
          diamond={superDef?.displayProperties?.icon !== undefined}
          element={subclassFromPlug(superDef) ?? subclass.subclass}
        />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">{superName ?? subclassName}</span>
          {superName && (
            <span className="text-muted-foreground truncate text-xs">{subclassName}</span>
          )}
        </div>
      </div>
      {abilities.length + subclass.aspectHashes.length + subclass.fragmentHashes.length > 0 && (
        <div className="flex flex-col gap-1">
          {abilities.length + subclass.aspectHashes.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {abilities.length > 0 && (
                <TileRow label="Abilities">
                  {abilities.map(({ kind, hash }) => (
                    <PlugIcon key={kind} hash={hash} suffix={ABILITY_LABELS[kind]} {...tile} />
                  ))}
                </TileRow>
              )}
              {subclass.aspectHashes.length > 0 && (
                <TileRow label="Aspects">
                  {subclass.aspectHashes.map((hash) => (
                    <PlugIcon key={hash} hash={hash} suffix="Aspect" {...tile} />
                  ))}
                </TileRow>
              )}
            </div>
          )}
          {subclass.fragmentHashes.length > 0 && (
            <TileRow label="Fragments">
              {subclass.fragmentHashes.map((hash, i) => (
                <PlugIcon
                  key={`${hash}-${i}`}
                  hash={hash}
                  suffix="Fragment"
                  classType={classType}
                  {...tile}
                />
              ))}
            </TileRow>
          )}
        </div>
      )}
      {artifactBlock}
    </section>
  );
}

/**
 * A piece's art as the Manager's item tile shows it: a grey frame (gold, with an
 * inner glow, when masterworked) over a bar with the archetype glyph and Power. The
 * Manager's 60px tile: 58px art inside the frame.
 */
function PieceTile({ item, manifest }: { item: ResolvedArmorItem; manifest: Manifest }) {
  const { piece } = item;
  const masterworked = isFullyMasterworked(piece);
  const archetypeIcon = archetypeStatIcon(manifest, piece?.archetype);
  return (
    <div
      className={cn(
        "flex w-15 shrink-0 flex-col self-start p-px @6xl:row-span-2",
        masterworked ? "bg-item-frame-masterwork" : "bg-item-frame",
        item.missing && "opacity-50",
      )}
    >
      <ArmorThumb
        icon={item.icon}
        watermark={piece?.watermark}
        alt={item.name}
        size={60}
        gearTier={armorPipTier(piece)}
        className="bg-item-backing size-[58px]"
      >
        {masterworked && <MasterworkGlow />}
      </ArmorThumb>
      <span
        className="flex items-center gap-0.5 px-0.5 text-[11px] leading-none font-medium text-black tabular-nums"
        style={{ height: ITEM_TILE_FOOTER_PX }}
      >
        <span className="flex-1" />
        {archetypeIcon && <ArchetypeGlyph icon={archetypeIcon} />}
        {piece?.power}
      </span>
    </div>
  );
}

/**
 * One armor piece: its mod sockets in socket order (the saved placement where there is
 * one, an empty bracket where there isn't) in two rows, the stat mod with the tuning /
 * artifice socket on top and the armor mods underneath. In the compact icon columns the
 * art sits above the rows; from `@6xl` the name and power head the box and the box is a
 * grid: a 48px art column spanning both rows, then three mod columns that share the rest
 * of the width up to 44px each.
 */
function PieceColumn({
  item,
  placement,
  manifest,
}: {
  item: ResolvedArmorItem;
  placement: Record<number, number> | undefined;
  manifest: Manifest;
}) {
  const { piece } = item;
  const top: SocketTile[] = [];
  const bottom: SocketTile[] = [];
  if (piece?.armorSockets) {
    for (const s of piece.armorSockets) {
      (s.kind === "other" ? bottom : top).push({ index: s.index, hash: placement?.[s.index] });
    }
  } else {
    // Missing piece: no socket kinds to sort by, so the placement in socket order.
    for (const [index, hash] of Object.entries(placement ?? {})) {
      top.push({ index: Number(index), hash });
    }
    top.sort((a, b) => a.index - b.index);
  }
  const slotLabel = item.slot ? SLOT_LABELS[item.slot] : "Armor";
  // A missing piece's empty slot, the tile's size; from @6xl it spans both rows of the
  // box's grid, at the top.
  const artClass = "h-[76px] w-15 @6xl:row-span-2";

  return (
    <section
      aria-label={`${item.name}, ${slotLabel}`}
      className={cn(COLUMN_WELL_CLASS, "gap-2")}
    >
      <div className="hidden min-w-0 flex-col @6xl:flex">
        <span
          className={cn(
            "truncate text-sm leading-5",
            piece?.isExotic && "text-exotic",
            item.missing && "text-muted-foreground",
          )}
          title={item.name}
        >
          {item.name}
        </span>
        {/* Power is on the tile. */}
        {item.missing ? (
          <span className="text-warning text-xs">Missing</span>
        ) : (
          <span className="text-muted-foreground text-xs">{slotLabel}</span>
        )}
      </div>
      <div className="flex flex-col gap-2 @6xl:grid @6xl:grid-cols-[auto_repeat(3,minmax(0,2.75rem))] @6xl:gap-1">
        {item.icon ? (
          <PieceTile item={item} manifest={manifest} />
        ) : (
          <span className={cn("d2-brackets shrink-0 bg-black/25", artClass)} aria-hidden />
        )}
        {top.length + bottom.length > 0 && (
          <div className="flex flex-col gap-1 @6xl:contents" aria-label="Mods">
            <ModRow sockets={top} manifest={manifest} />
            <ModRow sockets={bottom} manifest={manifest} newLine={top.length > 0} />
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * The card's body, laid out like the editor drawer: the subclass box (artifact at its
 * foot) on the far left, then one box per armor piece with its mods, and the weapons as a
 * row of slots under the pieces, beside the subclass box. Below the card's `@3xl` width
 * the subclass sits on top and the weapons span the card; below `@6xl` the pieces shrink
 * to icon columns.
 */
export function LoadoutCardBody({
  saved,
  resolved,
  manifest,
}: {
  saved: SavedLoadout;
  resolved: ResolvedLoadout;
  manifest: Manifest;
}) {
  const { loadout, modPlacement } = saved;
  const pieceCols = Math.max(resolved.armor.length, 1);
  const hasWeapons = resolved.weapons.length > 0;
  return (
    <div className="flex flex-col gap-3">
      <div
        className="grid gap-2 [grid-template-columns:repeat(var(--pieces),minmax(0,1fr))] @3xl:[grid-template-columns:minmax(18.5rem,1.25fr)_repeat(var(--pieces),minmax(0,1fr))]"
        style={{ "--pieces": pieceCols } as CSSProperties}
      >
        <div className={cn("col-span-full @3xl:col-span-1", hasWeapons && "@3xl:row-span-2")}>
          <SubclassColumn
            subclass={resolved.subclass}
            artifact={resolved.artifact}
            manifest={manifest}
            classType={loadout.classType}
          />
        </div>
        {resolved.armor.map((item, i) => (
          <PieceColumn
            key={`${item.ref.id ?? item.ref.hash}-${i}`}
            item={item}
            placement={item.ref.id ? modPlacement?.[item.ref.id] : undefined}
            manifest={manifest}
          />
        ))}
        {hasWeapons && (
          <div
            role="group"
            aria-label="Weapons"
            className="col-span-full grid grid-cols-1 gap-2 @lg:grid-cols-3 @3xl:col-[2/-1]"
          >
            {resolved.weapons.map((item) => (
              <WeaponSlot key={item.ref.id ?? item.ref.hash} item={item} />
            ))}
          </div>
        )}
      </div>
      {/* Loadouts from elsewhere (imports, DIM) carry a mod list but no per-piece placement. */}
      {!modPlacement && loadout.parameters.mods.length > 0 && (
        <div className="flex items-center gap-2 text-xs">
          <span className="d2-label text-[10px]">Mods</span>
          <div className="flex flex-wrap gap-1">
            {loadout.parameters.mods.map((hash, i) => (
              <PlugIcon
                key={`${hash}-${i}`}
                hash={hash}
                manifest={manifest}
                size={40}
                sizeClassName={MOD_SIZE_CLASS}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
