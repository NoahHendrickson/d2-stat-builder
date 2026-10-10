"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import { HugeiconsIcon } from "@hugeicons/react";
import { GitCompareIcon, SquareLock02Icon, SquareUnlock02Icon } from "@hugeicons/core-free-icons";
import { PerkTooltip } from "@/components/weapons/perk-tooltip";
import { ItemWatermark, TierPips } from "@/components/armor-thumb";
import { PowerValue } from "@/components/power-value";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { STAT_LABELS } from "@/lib/armory/stats";
import { useProfile } from "@/lib/armory/use-profile";
import { applyPerks, type PerkChange } from "@/lib/inventory/apply-perks";
import { armorDetails } from "@/lib/inventory/armor-details";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import { BREAKER_NAMES, type InventoryItem, type ManagerInventory } from "@/lib/inventory/build";
import { locate } from "@/lib/inventory/moves";
import { weaponCopies } from "@/lib/inventory/search";
import {
  weaponRoll,
  weaponStats,
  type DetailPlug,
  type ItemStat,
  type PerkColumn,
  type WeaponRoll,
} from "@/lib/inventory/weapon-details";
import { useManifest } from "@/lib/manifest/use-manifest";
import { clarityLines, type ClarityMap } from "@/lib/weapons/clarity";
import { weaponDisplayStats } from "@/lib/weapons/display-stats";
import { WEAPON_STAT_NUMBERS } from "@/lib/weapons/stat-order";
import type { PerkRef } from "@/lib/weapons/types";
import { useClarity } from "@/lib/weapons/use-clarity";
import { useWeaponCatalog } from "@/lib/weapons/use-weapon-catalog";
import { cn } from "@/lib/utils";
import { TAG_BUTTON, TagButtons } from "./tag-buttons";

const ITEM_TYPE_ARMOR = 2;
const ITEM_TYPE_WEAPON = 3;

/** Header plate per TierType, like the game's item header. */
const TIER_HEADER: Record<number, string> = {
  6: "bg-exotic text-black",
  5: "bg-legendary text-white",
  4: "bg-rare text-white",
  3: "bg-uncommon text-white",
  2: "bg-common text-black",
};

export interface ItemDetailsTarget {
  key: string;
  anchor: HTMLElement;
}

/**
 * The panel a tile opens (DIM's item popup, styled after Figma 128:5799): a rarity
 * header with the season watermark and tier pips, then for weapons the perk grid (click
 * a perk it rolled to preview it, then apply) and live stats, for armor its stats, set
 * bonus, and mods, and at the bottom the item's tag.
 */
export function ItemDetails({
  inventory,
  target,
  onClose,
  onLock,
  onCompare,
}: {
  inventory: ManagerInventory;
  target: ItemDetailsTarget | null;
  onClose: () => void;
  onLock: (item: InventoryItem, locked: boolean) => void;
  /** Open Compare for every copy of this weapon. */
  onCompare: (item: InventoryItem) => void;
}) {
  const found = target ? locate(inventory, target.key) : undefined;
  const copies =
    found?.item.itemType === ITEM_TYPE_WEAPON ? weaponCopies(inventory, found.item.name).length : 0;
  return (
    <Popover
      open={Boolean(found)}
      onOpenChange={(open, { reason, event }) => {
        // A press on the tile that opened the panel is left to the tile's click, which
        // closes it (closing here would have that click open it straight back up).
        if (reason === "outside-press" && target?.anchor.contains(event.target as Node)) return;
        if (!open) onClose();
      }}
    >
      <PopoverContent
        anchor={target?.anchor}
        side="right"
        align="start"
        sideOffset={8}
        // At least 300px, wider when the header's type line needs it (that line never
        // wraps); w-min lets everything else wrap rather than widen the panel.
        className="max-h-(--available-height) w-min max-w-[calc(100vw-1rem)] min-w-[300px] gap-0 overflow-y-auto p-0"
        style={PANEL_FRAME}
      >
        {found && (
          <>
            <Header item={found.item} onLock={onLock} />
            {found.item.itemType === ITEM_TYPE_WEAPON && found.item.instanceId ? (
              <WeaponRollView
                key={found.item.instanceId}
                item={found.item}
                instanceId={found.item.instanceId}
                characterId={found.place.kind === "character" ? found.place.characterId : undefined}
              />
            ) : found.item.itemType === ITEM_TYPE_ARMOR && found.item.instanceId ? (
              <ArmorView instanceId={found.item.instanceId} itemHash={found.item.itemHash} />
            ) : (
              <ItemDescription itemHash={found.item.itemHash} />
            )}
            {(found.item.instanceId || copies > 1) && (
              <div className={cn(SECTION, "flex-row flex-wrap items-center gap-1")}>
                {found.item.instanceId && <TagButtons instanceId={found.item.instanceId} />}
                {copies > 1 && (
                  <button
                    type="button"
                    onClick={() => onCompare(found.item)}
                    className={cn(TAG_BUTTON, "border-foreground/12 bg-foreground/4 shrink-0 gap-1 px-3 text-[0.8rem] font-medium")}
                  >
                    <HugeiconsIcon icon={GitCompareIcon} className="size-3.5" aria-hidden />
                    Compare {copies} copies
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * The panel's frame: plain white at 32%. d2-glass draws its line with border-image,
 * which would hide a plain border colour.
 */
const PANEL_FRAME: React.CSSProperties = { borderImage: "none", borderColor: "rgb(255 255 255 / 0.32)" };

/** A section of the panel: 12px in, a faint rule under it. */
const SECTION = "border-foreground/24 flex flex-col gap-2 border-b p-3 last:border-b-0";

/** Watermark box in the header's top-left corner, as in the game's inspect screen. */
const WATERMARK_PX = 64;

/**
 * The rarity plate: name, then element and type; the season watermark and tier pips in
 * the corner; Power and the lock on the right. Masterworked: a gold rule along the
 * bottom with a faint gold glow rising from it (Figma 134:143).
 */
function Header({
  item,
  onLock,
}: {
  item: InventoryItem;
  onLock: (item: InventoryItem, locked: boolean) => void;
}) {
  const lockLabel = item.locked ? "Unlock" : "Lock";
  const dark = item.tierType === 6 || item.tierType === 2;
  return (
    <div
      className={cn(
        // min-h: the 64px watermark box and its tier pips fit with room below.
        "relative flex min-h-17 flex-col justify-center gap-1 overflow-hidden py-2.5 pr-3 pl-[26px]",
        TIER_HEADER[item.tierType] ?? "bg-foreground/10",
        item.masterworked && "border-b-2 border-[#ffcf11] shadow-[inset_0_-6px_8px_rgb(255_207_17/0.13)]",
      )}
    >
      {(item.watermark || item.gearTier) && (
        <span
          aria-hidden
          className="pointer-events-none absolute top-0 left-0"
          style={{ width: WATERMARK_PX, height: WATERMARK_PX }}
        >
          {item.watermark && <ItemWatermark watermark={item.watermark} />}
          {item.gearTier !== undefined && <TierPips tier={item.gearTier} />}
        </span>
      )}
      <div className="relative flex items-start justify-between gap-3">
        <p className="text-[15px] leading-tight font-medium">{item.name}</p>
        {item.instanceId && (
          <button
            type="button"
            title={`${lockLabel} (in game too)`}
            aria-label={lockLabel}
            aria-pressed={item.locked}
            onClick={() => onLock(item, !item.locked)}
            className="-m-1 shrink-0 p-1 opacity-75 outline-none hover:opacity-100 focus-visible:d2-tile-selected"
          >
            <HugeiconsIcon
              icon={item.locked ? SquareLock02Icon : SquareUnlock02Icon}
              className="size-3.5"
              aria-hidden
            />
          </button>
        )}
      </div>
      <div className="relative flex items-center justify-between gap-3">
        <span
          className={cn(
            "flex shrink-0 items-center gap-1.5 text-[13px] whitespace-nowrap",
            dark ? "text-black/65" : "text-white/65",
          )}
        >
          {item.damageIcon && (
            <Image
              src={`${BUNGIE_IMAGE_BASE}${item.damageIcon}`}
              alt=""
              width={16}
              height={16}
              className="size-3.5"
              unoptimized
            />
          )}
          {item.typeName}
          {item.breakerIcon && (
            <span className="ml-1.5 flex items-center gap-1" title={`Stuns ${BREAKER_NAMES[item.breakerType ?? 0] ?? "champions"}`}>
              <Image
                src={`${BUNGIE_IMAGE_BASE}${item.breakerIcon}`}
                alt=""
                width={14}
                height={14}
                className={cn("size-3.5", dark && "brightness-0")}
                unoptimized
              />
              {BREAKER_NAMES[item.breakerType ?? 0]}
            </span>
          )}
        </span>
        {item.power !== undefined && (
          <PowerValue value={item.power} size="xs" className="text-inherit" />
        )}
      </div>
    </div>
  );
}

/** Reads the weapon's live roll and stats from the profile for `WeaponRollPanel`. */
function WeaponRollView({
  item,
  instanceId,
  characterId,
}: {
  item: InventoryItem;
  instanceId: string;
  /** The character holding it; perks can't be changed on vault items. */
  characterId: string | undefined;
}) {
  const { query: profile, membershipId } = useProfile();
  const queryClient = useQueryClient();
  const manifestStatus = useManifest();
  const manifest = manifestStatus.state === "ready" ? manifestStatus.manifest : undefined;
  const roll = useMemo(
    () => (profile.data && manifest ? weaponRoll(profile.data, manifest, instanceId) : undefined),
    [profile.data, manifest, instanceId],
  );
  const stats = useMemo(
    () => (profile.data && manifest ? weaponStats(profile.data, manifest, instanceId) : []),
    [profile.data, manifest, instanceId],
  );
  if (!roll) return null;
  return (
    <WeaponRollPanel
      item={item}
      roll={roll}
      stats={stats}
      onApply={
        characterId
          ? (plugs) => applyPerks(item, characterId, plugs, { queryClient, membershipId })
          : undefined
      }
    />
  );
}

/**
 * The weapon's live roll: stats, frame, perks, mods. Hovering a perk the weapon rolled
 * previews its stat change; clicking picks it (several columns at once), and Apply
 * perks swaps them in-game.
 */
export function WeaponRollPanel({
  item,
  roll,
  stats,
  onApply,
}: {
  item: InventoryItem;
  roll: WeaponRoll;
  stats: ItemStat[];
  /** Swap in the picked perks; resolves true when all went in. Absent: can't apply here. */
  onApply?: (plugs: PerkChange[]) => Promise<boolean>;
}) {
  const catalog = useWeaponCatalog().data;
  const clarity = useClarity();
  const [hovered, setHovered] = useState<{ socketIndex: number; hash: number } | null>(null);
  /** Picked perk per socket index (only where it differs from what's in the socket). */
  const [picked, setPicked] = useState<Record<number, number>>({});
  const [applying, setApplying] = useState(false);

  // The weapon search catalog knows each perk's stat bonuses, enhanced text, and the
  // weapon's stat curves; without it (or for weapons it lacks) there's no preview.
  const perkRefs = useMemo(() => {
    const map = new Map<number, PerkRef>();
    for (const perk of catalog?.perks ?? []) {
      map.set(perk.hash, perk);
      for (const alt of perk.alternateHashes ?? []) map.set(alt, perk);
    }
    return map;
  }, [catalog]);
  // Owned copies are often an older or reissued version the catalog lists under another
  // hash; a same-name version shares the stat curves and perk bonuses the preview needs.
  const catalogWeapon = useMemo(
    () =>
      catalog?.weapons.find((w) => w.hash === item.itemHash) ??
      catalog?.weapons.find((w) => w.name === item.name),
    [catalog, item.itemHash, item.name],
  );

  const refFor = (plug: DetailPlug): PerkRef =>
    perkRefs.get(plug.hash) ?? {
      hash: plug.hash,
      name: plug.name,
      icon: plug.icon,
      description: plug.description,
      currentlyCanRoll: true,
    };

  // What each column would hold: the hovered perk, else the picked one, else the current.
  const chosen = (c: PerkColumn): DetailPlug => {
    const hash =
      hovered?.socketIndex === c.socketIndex ? hovered.hash : (picked[c.socketIndex] ?? c.current.hash);
    return c.options.find((o) => o.hash === hash) ?? c.current;
  };
  const changes: PerkChange[] = roll.columns.flatMap((c) => {
    const hash = picked[c.socketIndex];
    return hash !== undefined && hash !== c.current.hash ? [{ socketIndex: c.socketIndex, plugItemHash: hash }] : [];
  });

  // The change the catalog computes for the chosen perks, added to the live stats.
  let preview: Record<string, number> | undefined;
  const previewing = hovered !== null || changes.length > 0;
  if (previewing && catalogWeapon && catalog) {
    const before = weaponDisplayStats(catalogWeapon, catalog.statCurves, roll.columns.map((c) => refFor(c.current)));
    const after = weaponDisplayStats(catalogWeapon, catalog.statCurves, roll.columns.map((c) => refFor(chosen(c))));
    preview = {};
    for (const s of stats) {
      const value = s.value + ((after[s.name] ?? 0) - (before[s.name] ?? 0));
      // Bar stats cap at 100 in-game; counts (RPM, magazine) don't.
      preview[s.name] = WEAPON_STAT_NUMBERS.includes(s.name) ? value : clamp(value);
    }
  }

  const pick = (c: PerkColumn, hash: number) =>
    setPicked((prev) => {
      const next = { ...prev };
      if (hash === c.current.hash || prev[c.socketIndex] === hash) delete next[c.socketIndex];
      else next[c.socketIndex] = hash;
      return next;
    });

  const apply = async () => {
    if (!onApply || changes.length === 0) return;
    setApplying(true);
    const ok = await onApply(changes);
    setApplying(false);
    if (ok) setPicked({});
  };

  const masterwork = roll.mods.find((m) => m.kind === "masterwork");
  // Masterwork and weapon mod on the left, the cosmetics (shader, ornament) past a rule.
  const gearMods = roll.mods.filter((m) => m.kind === "mod");
  const cosmetics = roll.mods.filter((m) => m.kind === "shader" || m.kind === "ornament");

  return (
    <>
      {roll.frame && <FrameRow plug={roll.frame} />}
      {(roll.columns.length > 0 || roll.mods.length > 0) && (
        <div className={cn(SECTION, "gap-4")}>
          <div className="flex gap-2 overflow-x-auto" aria-label="Perks">
            {roll.columns.map((column) =>
              column.origin && column.options.length <= 1 ? (
                <div key={column.socketIndex} className="flex flex-col gap-1.5">
                  <PlainPlug plug={column.current} refFor={refFor} clarity={clarity} />
                </div>
              ) : (
                <PerkColumnView
                  key={column.socketIndex}
                  column={column}
                  selected={picked[column.socketIndex] ?? column.current.hash}
                  refFor={refFor}
                  clarity={clarity}
                  onHover={(hash) =>
                    setHovered(hash === null ? null : { socketIndex: column.socketIndex, hash })
                  }
                  onPick={(hash) => pick(column, hash)}
                />
              ),
            )}
          </div>
          {(masterwork || gearMods.length > 0 || cosmetics.length > 0) && (
            <div className="flex items-center gap-4" aria-label="Mods">
              {(masterwork || gearMods.length > 0) && (
                <div className="flex items-center gap-1.5">
                  {masterwork && <PlainPlug plug={masterwork} size={MOD_PX} />}
                  {gearMods.map((mod, i) => (
                    <PlugBadge key={`mod:${i}`} plug={mod} size={MOD_PX - 2} />
                  ))}
                </div>
              )}
              {(masterwork || gearMods.length > 0) && cosmetics.length > 0 && (
                <span aria-hidden className="bg-foreground/12 h-6 w-px" />
              )}
              {cosmetics.length > 0 && (
                <div className="flex items-center gap-1.5">
                  {cosmetics.map((mod, i) => (
                    <PlugBadge key={`${mod.kind}:${i}`} plug={mod} size={MOD_PX - 2} />
                  ))}
                </div>
              )}
            </div>
          )}
          {changes.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="xs" disabled={!onApply || applying} onClick={() => void apply()}>
                {applying ? "Applying…" : `Apply ${changes.length === 1 ? "perk" : `${changes.length} perks`}`}
              </Button>
              <Button size="xs" variant="ghost" disabled={applying} onClick={() => setPicked({})}>
                Reset
              </Button>
              {!onApply && (
                <span className="text-muted-foreground text-xs">Move it to a character to change perks</span>
              )}
            </div>
          )}
        </div>
      )}
      {stats.length > 0 && (
        <div className={SECTION}>
          <StatRows stats={stats} preview={preview} />
        </div>
      )}
    </>
  );
}

/** Perk cells: 40px with a 30px icon (Figma 128:5799's 56/40, scaled down). */
const PERK_CELL = "relative flex size-10 shrink-0 items-center justify-center";

/** Masterwork and mod icons, including the mods' 1px line. */
const MOD_PX = 36;

/** The frame (intrinsic) on its own row under the header: icon and name. */
function FrameRow({ plug }: { plug: DetailPlug }) {
  return (
    <Tooltip>
      <TooltipTrigger
        delay={0}
        render={<div className="bg-foreground/4 flex items-center gap-2 px-4 py-2 text-xs" />}
      >
        <PlugIcon plug={plug} size={24} />
        {plug.name}
      </TooltipTrigger>
      <TooltipContent side="right" align="start" className="max-w-sm">
        <p className="font-medium">{plug.name}</p>
        {plug.description && <p className="text-muted-foreground">{plug.description}</p>}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * A plug shown without a cell (the masterwork, a lone origin trait), with its perk
 * tooltip on hover.
 */
function PlainPlug({
  plug,
  refFor,
  clarity,
  size,
}: {
  plug: DetailPlug;
  refFor?: (plug: DetailPlug) => PerkRef;
  clarity?: ClarityMap;
  /** Icon size; default is the perk cell's 30px icon centred in its 40px. */
  size?: number;
}) {
  const ref = refFor?.(plug);
  return (
    <Tooltip>
      <TooltipTrigger
        delay={0}
        render={<span className={size ? "block" : PERK_CELL} aria-label={plug.name} />}
      >
        <PlugIcon plug={plug} size={size ?? 30} />
      </TooltipTrigger>
      <TooltipContent side="right" align="start" className="max-w-sm">
        {ref ? (
          <PerkTooltip perk={ref} insight={clarityLines(clarity, ref)} />
        ) : (
          <>
            <p className="font-medium">{plug.name}</p>
            {plug.description && <p className="text-muted-foreground">{plug.description}</p>}
          </>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

/** A socketed plug's icon with its name and description on hover. */
function PlugBadge({ plug, size = 26 }: { plug: DetailPlug; size?: number }) {
  return (
    <Tooltip>
      <TooltipTrigger delay={0} render={<span className="d2-line block" />}>
        <PlugIcon plug={plug} size={size} />
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs">
        <p className="font-medium">{plug.name}</p>
        {plug.description && <p className="text-muted-foreground">{plug.description}</p>}
      </TooltipContent>
    </Tooltip>
  );
}

/** Armor 3.0 stats scale: a single piece tops out in the 40s. */
const ARMOR_STAT_BAR_MAX = 45;

/** Reads an armor piece's details from the profile for its panel. */
function ArmorView({ instanceId, itemHash }: { instanceId: string; itemHash: number }) {
  const { query: profile } = useProfile();
  const manifestStatus = useManifest();
  const manifest = manifestStatus.state === "ready" ? manifestStatus.manifest : undefined;
  const details = useMemo(
    () => (profile.data && manifest ? armorDetails(profile.data, manifest, instanceId, itemHash) : undefined),
    [profile.data, manifest, instanceId, itemHash],
  );
  if (!details) return null;
  // Exotics can tune any stat, so no one row gets the glyph.
  const tunedStat = details.tunable === "any" ? undefined : details.tunable;
  return (
    <div className={SECTION}>
      {/* A column for the tuning glyph, left of the stat, when one stat is tunable. */}
      <dl
        className={cn(
          "grid items-center gap-x-2.5 gap-y-1 text-[13px]",
          tunedStat ? "grid-cols-[0.75rem_auto_2rem_1fr]" : "grid-cols-[auto_2rem_1fr]",
        )}
      >
        {details.stats.map(({ key, value }) => (
          <div key={key} className="contents">
            <dt className="contents">
              {tunedStat && (
                <span title={tunedStat === key ? `Tunable: tuning can add +5 ${STAT_LABELS[key]}` : undefined}>
                  {tunedStat === key && <TuningIcon />}
                </span>
              )}
              <span className="text-muted-foreground">{STAT_LABELS[key]}</span>
            </dt>
            <dd className="tabular-nums">{value}</dd>
            <dd aria-hidden className="bg-foreground/10 relative h-2">
              <span
                className="bg-foreground/80 absolute inset-y-0 left-0"
                style={{ width: `${Math.min(100, (value / ARMOR_STAT_BAR_MAX) * 100)}%` }}
              />
            </dd>
          </div>
        ))}
      </dl>
      {details.tunable === "any" && (
        <p className="text-muted-foreground flex items-center gap-1.5 text-[13px]">
          <TuningIcon />
          Tunable: any stat
        </p>
      )}
      {(details.archetype || details.energy) && (
        <div className="flex items-center justify-between gap-3 text-[13px]">
          {details.archetype ? (
            <span className="flex items-center gap-2">
              <PlugIcon plug={details.archetype} size={22} />
              {details.archetype.name}
            </span>
          ) : (
            <span />
          )}
          {details.energy && (
            <span className="text-muted-foreground tabular-nums">
              Energy {details.energy.used} / {details.energy.capacity}
            </span>
          )}
        </div>
      )}
      {details.intrinsic && (
        <div className="flex items-start gap-2.5">
          <PlugIcon plug={details.intrinsic} size={28} />
          <div className="flex flex-col gap-0.5 text-[13px]">
            <span className="font-medium">{details.intrinsic.name}</span>
            {details.intrinsic.description && (
              <span className="text-muted-foreground">{details.intrinsic.description}</span>
            )}
          </div>
        </div>
      )}
      {details.set && (
        <div className="flex flex-col gap-1 text-[13px]">
          <span className="d2-label">{details.set.name}</span>
          {details.set.perks.map((perk) => (
            <p key={perk.count}>
              <span className="font-medium">
                {perk.count}-piece {perk.name}
              </span>
              {perk.description && <span className="text-muted-foreground">: {perk.description}</span>}
            </p>
          ))}
        </div>
      )}
      {details.plugs.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Mods">
          {details.plugs.map((plug, i) => (
            <PlugBadge key={`${plug.hash}:${i}`} plug={plug} size={30} />
          ))}
        </div>
      )}
    </div>
  );
}

/** The game's tuning glyph (up and down arrows over offset bars), from the user's tuning.svg. */
function TuningIcon() {
  return (
    <svg viewBox="0 0 27 32" className="h-3.5 w-auto" fill="currentColor" role="img" aria-label="Tunable">
      <path d="M20 32L13 25H17L20 28L23 25H27L20 32Z" />
      <path d="M14 7H10L7 4L4 7H0L7 0L14 7Z" />
      <rect x="13" y="20" width="14" height="2" />
      <rect y="10" width="14" height="2" />
      <rect y="15" width="27" height="2" />
    </svg>
  );
}

/** The definition's description, for gear without a stats panel (ghosts, ships, …). */
function ItemDescription({ itemHash }: { itemHash: number }) {
  const manifestStatus = useManifest();
  const description =
    manifestStatus.state === "ready"
      ? manifestStatus.manifest.def("DestinyInventoryItemDefinition", itemHash)?.displayProperties
          ?.description
      : undefined;
  if (!description) return null;
  return (
    <p className={cn(SECTION, "text-muted-foreground block text-[11px] whitespace-pre-line")}>
      {description}
    </p>
  );
}

const clamp = (value: number) => Math.min(Math.max(value, 0), 100);

/** Name, value, and bar per stat on one line; a previewed change shows green or red. */
function StatRows({ stats, preview }: { stats: ItemStat[]; preview?: Record<string, number> }) {
  return (
    <dl className="grid grid-cols-[auto_1.75rem_1fr] items-center gap-x-2 gap-y-0.5 text-[11px]">
      {stats.map(({ name, value: base }) => {
        const value = preview?.[name] ?? base;
        const bar = !WEAPON_STAT_NUMBERS.includes(name);
        const low = clamp(Math.min(value, base));
        const high = clamp(Math.max(value, base));
        return (
          <div key={name} className="contents">
            <dt className="text-muted-foreground text-right">{name}</dt>
            <dd
              className={cn(
                "tabular-nums",
                value > base && "text-positive",
                value < base && "text-destructive",
              )}
            >
              {value}
            </dd>
            <dd aria-hidden className={cn("relative h-1.5", bar && "bg-foreground/10")}>
              {bar && (
                <>
                  <span className="bg-foreground/80 absolute inset-y-0 left-0" style={{ width: `${low}%` }} />
                  {value !== base && (
                    <span
                      className={cn("absolute inset-y-0", value > base ? "bg-positive" : "bg-destructive")}
                      style={{ left: `${low}%`, width: `${high - low}%` }}
                    />
                  )}
                </>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function PlugIcon({ plug, size }: { plug: DetailPlug; size: number }) {
  return plug.icon ? (
    <Image
      src={`${BUNGIE_IMAGE_BASE}${plug.icon}`}
      alt=""
      width={size}
      height={size}
      style={{ width: size, height: size }}
      unoptimized
    />
  ) : (
    <span className="bg-muted block" style={{ width: size, height: size }} />
  );
}

/**
 * One perk column: every option it rolled. The perk it will have is filled blue; when
 * another one is picked, the one in the socket now keeps a faint blue fill.
 */
function PerkColumnView({
  column,
  selected,
  refFor,
  clarity,
  onHover,
  onPick,
}: {
  column: PerkColumn;
  selected: number;
  refFor: (plug: DetailPlug) => PerkRef;
  clarity: ClarityMap | undefined;
  onHover: (hash: number | null) => void;
  onPick: (hash: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {column.options.map((option) => {
        const isSelected = option.hash === selected;
        const isCurrent = option.hash === column.current.hash;
        const ref = refFor(option);
        return (
          <Tooltip key={option.hash}>
            <TooltipTrigger
              delay={0}
              render={
                <button
                  type="button"
                  aria-label={isCurrent ? `${option.name} (equipped)` : option.name}
                  aria-pressed={isSelected}
                  onClick={() => onPick(option.hash)}
                  onPointerEnter={() => !isSelected && onHover(option.hash)}
                  onPointerLeave={() => onHover(null)}
                  className={cn(
                    PERK_CELL,
                    "border-foreground/12 rounded-full border outline-none focus-visible:d2-tile-selected",
                    isSelected
                      ? "bg-[#305f8e]"
                      : isCurrent
                        ? "bg-[#305f8e]/35"
                        : "bg-foreground/4 hover:bg-foreground/10",
                  )}
                />
              }
            >
              <PlugIcon plug={option} size={30} />
              {option.enhanced && (
                <Image
                  src="/manager/perk-enhanced.svg"
                  alt=""
                  width={8}
                  height={8}
                  className="absolute top-0.5 left-0.5"
                />
              )}
            </TooltipTrigger>
            <TooltipContent side="right" align="start" className="max-w-sm">
              <PerkTooltip perk={ref} insight={clarityLines(clarity, ref)} />
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
