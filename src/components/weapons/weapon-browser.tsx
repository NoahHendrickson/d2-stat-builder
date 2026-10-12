"use client";

import Image from "next/image";
import { useSearchParams } from "next/navigation";
import {
  createContext,
  memo,
  type CSSProperties,
  type ReactNode,
  useContext,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUpDownIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PerkTooltip } from "@/components/weapons/perk-tooltip";
import { WeaponStats } from "@/components/weapons/weapon-stats";
import { WeaponSearchBox } from "@/components/weapons/weapon-search-box";
import { clarityLines } from "@/lib/weapons/clarity";
import { weaponDisplayStats } from "@/lib/weapons/display-stats";
import { useClarity } from "@/lib/weapons/use-clarity";
import { useWeaponCatalog } from "@/lib/weapons/use-weapon-catalog";
import {
  activeFilterChips,
  buildFilterIndex,
  pendingPairValue,
  withFilter,
  withoutFilter,
} from "@/lib/weapons/filter-suggestions";
import { SORTS, readSearchState } from "@/lib/weapons/search-state";
import type { WeaponCatalog } from "@/lib/weapons/catalog";
import type {
  AmmoTypeRef,
  ChampionTypeRef,
  DamageTypeRef,
  PerkRef,
  WeaponSummary,
} from "@/lib/weapons/types";
import { weaponTypeIcon } from "@/lib/weapons/weapon-type-icon-paths";
import { useMinWidth } from "@/lib/use-min-width";
import { cn } from "@/lib/utils";
import { ItemWatermark } from "@/components/armor-thumb";

const SORT_ITEMS: Record<string, string> = Object.fromEntries(SORTS);
/** Tailwind `lg`: from here the details sit beside the list instead of in a dialog. */
const SPLIT_MIN_PX = 1024;
/** A result row's nameplate height, and the gap left between plates. */
const ROW_PX = 40;
const ROW_GAP_PX = 4;

/** Each element's tint, as RGB channels: the chip colours from the search box. */
const ELEMENT_PLATE: Record<string, string> = {
  Arc: "40 180 220",
  Solar: "255 120 40",
  Void: "125 88 194",
  Stasis: "60 140 220",
  Strand: "60 200 120",
  Kinetic: "180 180 180",
};

/**
 * A row's look, a pane of tinted glass over the page: its element's colour,
 * easing off to the right. The open weapon's row doesn't ease off but
 * brightens toward its end instead.
 */
function nameplate(element: string, current: boolean): CSSProperties {
  const tint = ELEMENT_PLATE[element] ?? ELEMENT_PLATE.Kinetic;
  const [from, to] = current ? [0.3, 0.42] : [0.28, 0.12];
  return {
    background: `linear-gradient(90deg, rgb(${tint} / ${from}), rgb(${tint} / ${to}))`,
  };
}

function WeaponIcon({
  weapon,
  size = 44,
  className,
}: {
  weapon: WeaponSummary;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={cn("relative block shrink-0 bg-foreground/5", className)}
      style={{ width: size, height: size }}
    >
      {weapon.icon && (
        <Image
          src={`https://www.bungie.net${weapon.icon}`}
          alt=""
          width={size}
          height={size}
          unoptimized
        />
      )}
      {weapon.watermark && <ItemWatermark watermark={weapon.watermark} />}
    </span>
  );
}

/** The element's damage-type glyph from the catalog; Kinetic's is white, so it inverts on light. */
function ElementIcon({
  element,
  damageTypes,
  size = 14,
}: {
  element: string;
  damageTypes: readonly DamageTypeRef[] | undefined;
  size?: number;
}) {
  const icon = damageTypes?.find((type) => type.name === element)?.icon;
  if (!icon) return <span>{element}</span>;
  return (
    <Image
      className={cn(
        "shrink-0",
        element === "Kinetic" && "invert dark:invert-0",
      )}
      src={`https://www.bungie.net${icon}`}
      alt={element}
      width={size}
      height={size}
      unoptimized
    />
  );
}

/** The in-game HUD tints: white (Primary), green (Special), purple (Heavy). */
const AMMO_COLOR: Record<string, string> = {
  Primary: "text-foreground",
  Special: "text-[#58c26c]",
  Heavy: "text-[#7d58c2]",
};

/**
 * Ammo HUD icon used as a mask so it takes the ammo color; falls back to the name.
 * `tight` trims the empty margin Bungie's square art leaves either side of the glyph.
 */
function AmmoIcon({
  ammo,
  ammoTypes,
  tight = false,
}: {
  ammo: string;
  ammoTypes: readonly AmmoTypeRef[] | undefined;
  tight?: boolean;
}) {
  const icon = ammoTypes?.find((type) => type.name === ammo)?.icon;
  if (!icon) return <span>{ammo}</span>;
  const mask = `url("https://www.bungie.net${icon}") center / contain no-repeat`;
  return (
    <span
      role="img"
      aria-label={ammo}
      className={cn(
        "-my-1.5 inline-block size-[30px] shrink-0 bg-current",
        tight && "-mx-1.5",
        AMMO_COLOR[ammo],
      )}
      style={{ mask, WebkitMask: mask }}
    />
  );
}

/** The anti-champion glyph from the catalog; Bungie's is white, so it inverts on light. */
function ChampionIcon({
  champion,
  championTypes,
}: {
  champion: string;
  championTypes: readonly ChampionTypeRef[] | undefined;
}) {
  const icon = championTypes?.find((type) => type.name === champion)?.icon;
  if (!icon) return null;
  return (
    <Image
      className="shrink-0 invert dark:invert-0"
      src={`https://www.bungie.net${icon}`}
      alt={`Anti-${champion}`}
      width={18}
      height={18}
      unoptimized
    />
  );
}

/**
 * The weapon type's silhouette, as a mask so it takes the text colour. In a
 * list row it fills a set slot so the icons after it line up; `tight` sizes it
 * to the silhouette instead, by an invisible copy of the art at the same height.
 */
function TypeSilhouette({
  weapon,
  tight = false,
}: {
  weapon: WeaponSummary;
  tight?: boolean;
}) {
  const icon = weaponTypeIcon(weapon.type, AMMO_TYPE[weapon.ammo]);
  // A type without a silhouette keeps its slot, so the icons after it stay in line.
  if (!icon) return <span className="w-11 shrink-0" />;
  const mask = `url("${icon}") center / contain no-repeat`;
  if (tight) {
    return (
      <span
        role="img"
        aria-label={weapon.type}
        className="relative h-3 shrink-0"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={icon} alt="" className="invisible h-full w-auto" />
        <span
          className="absolute inset-0 bg-foreground"
          style={{ mask, WebkitMask: mask }}
        />
      </span>
    );
  }
  return (
    <span
      role="img"
      aria-label={weapon.type}
      className="h-3 w-11 shrink-0 bg-foreground"
      style={{ mask, WebkitMask: mask }}
    />
  );
}

type RevealRow = {
  /** The chip whose name is open, by label, and that name's full width. */
  open: { label: string; width: number } | null;
  /** Room held before the chip under the pointer, so it stays put as the rest settle. */
  hold: { label: string; px: number } | null;
  register: (label: string, chip: HTMLElement) => () => void;
  enter: (label: string, width: number, chip: HTMLElement, pointerX: number) => void;
  leave: () => void;
};

const RevealRowContext = createContext<RevealRow | null>(null);

/**
 * The details header's chips, opened one at a time. A name stays open until
 * the pointer reaches another chip or leaves the row, so crossing the gap
 * between two chips doesn't close it under the pointer. Entering a chip sends
 * every other chip back to its place and closes their names. If that would
 * carry the entered chip out from under the pointer, it holds room before it
 * for exactly what goes away to its left, easing in step, so it stays put;
 * otherwise it slides along with the rest. Leaving the row lets the room go.
 */
function useRevealRow(): RevealRow {
  const [open, setOpen] = useState<RevealRow["open"]>(null);
  const [hold, setHold] = useState<RevealRow["hold"]>(null);
  const chips = useRef(new Map<string, HTMLElement>());
  const current = useRef<string | null>(null);
  return {
    open,
    hold,
    register(label, chip) {
      chips.current.set(label, chip);
      return () => {
        if (chips.current.get(label) === chip) chips.current.delete(label);
      };
    },
    enter(label, width, chip, pointerX) {
      if (current.current === label) return;
      current.current = label;
      // What sits to its left right now, even part way through easing: held
      // room (a margin) and open names.
      let px = 0;
      for (const other of chips.current.values()) {
        const before =
          other === chip ||
          Boolean(other.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING);
        if (!before) continue;
        px += parseFloat(getComputedStyle(other).marginLeft) || 0;
        const name = other.lastElementChild;
        if (other !== chip && name) px += name.getBoundingClientRect().width;
      }
      // Where its right edge lands with nothing held: its frame, closed, plus
      // the full name. Short of the pointer (with some slack), it must hold.
      const box = chip.getBoundingClientRect();
      const name = chip.lastElementChild?.getBoundingClientRect().width ?? 0;
      const right = box.left - px + box.width - name + width;
      setOpen({ label, width });
      setHold(px > 0.5 && pointerX > right - 8 ? { label, px } : null);
    },
    leave() {
      current.current = null;
      setOpen(null);
      setHold(null);
    },
  };
}

/**
 * One of the details header's icons, whose name slides open beside it in a
 * frame on hover, like the build card's icon actions. Names and held room ease
 * over the same time, in px, so a chip held in place stays exactly there.
 */
function RevealChip({ label, children }: { label: string; children: ReactNode }) {
  const row = useContext(RevealRowContext);
  const text = useRef<HTMLSpanElement>(null);
  const open = row?.open?.label === label ? row.open : null;
  return (
    <span
      ref={(chip) => (row && chip ? row.register(label, chip) : undefined)}
      data-open={open ? true : undefined}
      onPointerEnter={(event) => {
        if (text.current) {
          row?.enter(
            label,
            text.current.offsetWidth,
            event.currentTarget,
            event.clientX,
          );
        }
      }}
      className="inline-flex shrink-0 items-center border border-transparent px-1.5 py-1 transition-[background-color,border-color,color,margin-left] duration-200 ease-out motion-reduce:transition-none data-open:border-foreground/24 data-open:bg-foreground/4 data-open:text-foreground normal:rounded-md"
      style={{ marginLeft: row?.hold?.label === label ? row.hold.px : 0 }}
    >
      {children}
      {/* The name; last in the chip, where the row reads its width. */}
      <span
        className="overflow-hidden transition-[width] duration-200 ease-out motion-reduce:transition-none"
        style={{ width: open?.width ?? 0 }}
      >
        <span ref={text} className="block w-max pl-2 text-sm whitespace-nowrap">
          {label}
        </span>
      </span>
    </span>
  );
}

/**
 * A list row icon's name in the site's tooltip, quick to open. The trigger is
 * a span, as the icon already sits inside the row's button.
 */
function IconTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        delay={100}
        render={<span className="flex shrink-0 items-center" />}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Ammo names as DestinyAmmunitionType, for the heavy grenade launcher silhouette. */
const AMMO_TYPE: Record<string, number> = { Primary: 1, Special: 2, Heavy: 3 };

/** The icon of the weapon's frame (its intrinsic perk), looked up by the frame's name. */
function frameIcon(weapon: WeaponSummary, perks: readonly PerkRef[]): string | undefined {
  if (!weapon.frame) return undefined;
  for (const column of weapon.columns) {
    if (column.kind !== "Intrinsic") continue;
    for (const index of column.perkIndices) {
      const perk = perks[index];
      if (perk?.name === weapon.frame) return perk.icon;
    }
  }
  return undefined;
}

/** A perk's place in the grid: which column, and its catalog index. */
type PerkPick = { column: number; perk: number };

/** Masterworks pick like their own column; no real column index is negative. */
const MASTERWORK = -1;

/**
 * Memoized: the list beside it re-renders this page as it scrolls (the virtualizer
 * lives in the same parent), and the details would otherwise recompute their stats and
 * rebuild every perk tile each time for a weapon that hasn't changed.
 */
const WeaponDetails = memo(function WeaponDetails({
  weapon,
  catalog,
  inDialog = false,
}: {
  weapon: WeaponSummary;
  catalog: WeaponCatalog;
  inDialog?: boolean;
}) {
  const clarity = useClarity();
  // One picked perk per column (column index → perk index); a hovered perk
  // previews in place of its column's pick. Keyed by weapon, so both reset.
  const [picked, setPicked] = useState<Record<number, number>>({});
  const [hovered, setHovered] = useState<PerkPick | null>(null);
  const statsFor = (picks: Record<number, number>) =>
    weaponDisplayStats(
      weapon,
      catalog.statCurves,
      Object.values(picks).flatMap((i) => catalog.perks[i] ?? []),
    );
  // Picks are the settled roll, drawn plain; a hover shows its change against
  // them in green and red.
  const current = statsFor(picked);
  const preview = hovered
    ? statsFor({ ...picked, [hovered.column]: hovered.perk })
    : current;
  function toggle(column: number, perk: number) {
    setPicked(({ [column]: current, ...rest }) =>
      current === perk ? rest : { ...rest, [column]: perk },
    );
  }
  const masterworks = weapon.masterworks ?? [];
  const hasIntrinsic = weapon.columns.some((c) => c.kind === "Intrinsic");
  // A frame (or exotic intrinsic) with no alternatives can't be picked, so it
  // stays in the header alone, its tooltip with it, and the masterworks move
  // up into its column.
  const fixedFrame = weapon.columns.find(
    (c) => c.kind === "Intrinsic" && c.perkIndices.length === 1,
  );
  const framePerk = fixedFrame && catalog.perks[fixedFrame.perkIndices[0]];
  const frame = framePerk?.icon ?? frameIcon(weapon, catalog.perks);
  const frameName = framePerk?.name ?? weapon.frame ?? "Frame";

  /**
   * One perk's tile. `columnKey` is the column it picks in (MASTERWORK for
   * masterworks).
   */
  function perkTile(columnKey: number, index: number) {
    const perk = catalog.perks[index];
    if (!perk) return null;
    const selected = picked[columnKey] === index;
    const label = perk.currentlyCanRoll ? perk.name : `${perk.name} (retired)`;
    const masterwork = columnKey === MASTERWORK;
    // Drawn like the Items popover's perk grid (PerkColumnView), at the full size of
    // its Figma cell: a round cell with a hairline, filled blue once picked, and
    // the enhanced arrow in the top-left for perks with an enhanced tier. The
    // name lives in the tooltip. Masterwork art is its own framed square, so it
    // goes without a cell; once one is picked, the others dim.
    const iconSize = masterwork ? 44 : 34;
    const content = (
      <>
        {perk.icon && (
          <Image
            src={`https://www.bungie.net${perk.icon}`}
            alt=""
            width={iconSize}
            height={iconSize}
            unoptimized
          />
        )}
        {perk.alternateHashes?.length ? (
          <Image
            src="/manager/perk-enhanced.svg"
            alt=""
            width={10}
            height={10}
            className="absolute top-1 left-1"
          />
        ) : null}
      </>
    );
    const trigger = (
      <button
        type="button"
        aria-label={label}
        aria-pressed={selected}
        onClick={() => toggle(columnKey, index)}
        onPointerEnter={() => setHovered({ column: columnKey, perk: index })}
        // Leaving a tile ends its preview, even into the gaps between
        // tiles; only clear if a neighbour hasn't already taken over.
        onPointerLeave={() =>
          setHovered((h) =>
            h?.column === columnKey && h.perk === index ? null : h,
          )
        }
        className={cn(
          "relative flex size-14 shrink-0 items-center justify-center outline-none",
          masterwork
            ? cn(
                "transition-[opacity,filter] hover:brightness-125 focus-visible:[&>img]:d2-tile-selected",
                picked[MASTERWORK] !== undefined &&
                  !selected &&
                  "opacity-40 hover:opacity-100",
              )
            : cn(
                "rounded-full border border-foreground/12 transition-colors focus-visible:d2-tile-selected",
                selected
                  ? "bg-[#305f8e]"
                  : "bg-foreground/4 hover:bg-foreground/10",
              ),
          !perk.currentlyCanRoll && "opacity-40",
        )}
      />
    );
    return (
      <Tooltip key={index}>
        <TooltipTrigger delay={0} render={trigger}>
          {content}
        </TooltipTrigger>
        <TooltipContent side="right" align="start" className="max-w-sm">
          <PerkTooltip perk={perk} insight={clarityLines(clarity, perk)} />
        </TooltipContent>
      </Tooltip>
    );
  }

  const poolLabel = catalog.poolLabel(weapon.hash);
  // Where it drops from, each part named so the bare values read.
  const origin = (
    [
      ["Source", poolLabel !== weapon.source ? weapon.source : undefined],
      ["Season", weapon.seasonName],
    ] satisfies [string, string | undefined][]
  ).filter((part): part is [string, string] => Boolean(part[1]));
  const reveal = useRevealRow();
  const Title = inDialog ? DialogTitle : "h2";
  const Description = inDialog ? DialogDescription : "div";
  return (
    <>
      {/* The list row, opened up: the same outlined icon, the name, then the
          row's icons in the same order with where it drops from after them. */}
      <div className={cn("flex items-center gap-4", inDialog && "pr-8")}>
        <WeaponIcon
          weapon={weapon}
          size={inDialog ? 56 : 72}
          className="outline-1 -outline-offset-1 outline-foreground/24"
        />
        <div className="grid min-w-0 gap-2">
          <Title
            className={cn(
              "font-medium",
              inDialog ? "text-base" : "text-xl",
              weapon.rarity === "Exotic" && "text-amber-300",
            )}
          >
            {weapon.name}
            {poolLabel && (
              <span className="ml-2 font-normal text-muted-foreground">
                {poolLabel}
              </span>
            )}
          </Title>
          {/* Pulled left by a chip's padding and border, so the first icon
              lines up under the name. */}
          <Description
            className="-ml-[7px] flex items-center gap-1.5 text-muted-foreground"
            onPointerLeave={reveal.leave}
          >
            <RevealRowContext value={reveal}>
              {weaponTypeIcon(weapon.type, AMMO_TYPE[weapon.ammo]) && (
                <RevealChip label={weapon.type}>
                  <TypeSilhouette weapon={weapon} tight />
                </RevealChip>
              )}
              <RevealChip label={weapon.element}>
                <ElementIcon
                  element={weapon.element}
                  damageTypes={catalog.damageTypes}
                  size={18}
                />
              </RevealChip>
              {frame && (
                <Tooltip>
                  <TooltipTrigger
                    // Its full description and Clarity insight, which no perk
                    // tile carries once a fixed frame leaves the grid.
                    disabled={!framePerk}
                    render={<span className="inline-flex shrink-0" />}
                  >
                    <RevealChip label={frameName}>
                      <Image
                        className="shrink-0"
                        src={`https://www.bungie.net${frame}`}
                        alt={frameName}
                        width={20}
                        height={20}
                        unoptimized
                      />
                    </RevealChip>
                  </TooltipTrigger>
                  {framePerk && (
                    <TooltipContent
                      side="bottom"
                      align="start"
                      className="max-w-sm"
                    >
                      <PerkTooltip
                        perk={framePerk}
                        insight={clarityLines(clarity, framePerk)}
                      />
                    </TooltipContent>
                  )}
                </Tooltip>
              )}
              <RevealChip label={`${weapon.ammo} ammo`}>
                <AmmoIcon
                  ammo={weapon.ammo}
                  ammoTypes={catalog.ammoTypes}
                  tight
                />
              </RevealChip>
              {weapon.champions?.map((champion) => (
                <RevealChip key={champion} label={`Anti-${champion}`}>
                  <ChampionIcon
                    champion={champion}
                    championTypes={catalog.championTypes}
                  />
                </RevealChip>
              ))}
              {/* Last on the line and the one part that gives way, so the
                  header stays two lines in a narrow pane. */}
              {origin.length > 0 && (
                <span
                  className="ml-2 min-w-0 truncate"
                  title={origin
                    .map(([name, value]) => `${name}: ${value}`)
                    .join(", ")}
                >
                  {origin.map(([name, value]) => (
                    <span key={name} className="mr-4 last:mr-0">
                      {name}: {value}
                    </span>
                  ))}
                </span>
              )}
            </RevealRowContext>
          </Description>
        </div>
      </div>
      <div aria-hidden className="d2-rule" />
      {/* Perks first, the stats they move beside them on the right; the stats
          take what width is left, dropping below once that is under 16rem. */}
      <div className="flex flex-wrap items-start gap-6">
        <div className="flex max-w-full gap-2.5 overflow-x-auto pb-1">
          {!hasIntrinsic && masterworks.length > 0 && (
            <section
              aria-label="Masterwork"
              className="flex shrink-0 flex-col gap-2.5"
            >
              {masterworks.map((index) => perkTile(MASTERWORK, index))}
            </section>
          )}
          {weapon.columns.map((column, i) =>
            column === fixedFrame && masterworks.length === 0 ? null : (
              <section
                key={i}
                aria-label={column.kind}
                className="flex shrink-0 flex-col gap-2.5"
              >
                {column !== fixedFrame &&
                  column.perkIndices.map((index) => perkTile(i, index))}
                {column.kind === "Intrinsic" && masterworks.length > 0 && (
                  // Masterworks sit under a pickable frame, a step apart from
                  // it, or top the column when the frame is fixed.
                  <div
                    role="group"
                    aria-label="Masterwork"
                    className={cn(
                      "flex flex-col gap-2.5",
                      column !== fixedFrame && "mt-2.5",
                    )}
                  >
                    {masterworks.map((index) => perkTile(MASTERWORK, index))}
                  </div>
                )}
              </section>
            ),
          )}
        </div>
        {Object.keys(current).length > 0 && (
          <div className="min-w-64 flex-1 basis-64">
            <WeaponStats base={current} stats={preview} />
          </div>
        )}
      </div>
    </>
  );
});

export function WeaponBrowser() {
  const query = useWeaponCatalog();
  const params = useSearchParams();
  const serialized = params.toString();
  const currentParams = useMemo(
    () => new URLSearchParams(serialized),
    [serialized],
  );
  const state = useMemo(() => readSearchState(currentParams), [currentParams]);
  const chips = useMemo(
    () => activeFilterChips(state, currentParams),
    [state, currentParams],
  );
  const deferred = useDeferredValue(state);
  const [picked, setPicked] = useState<WeaponSummary | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const split = useMinWidth(SPLIT_MIN_PX);
  const scrollRef = useRef<HTMLDivElement>(null);
  const detailsRef = useRef<HTMLElement>(null);
  const data = query.data;
  const results = useMemo(
    () => data?.search(deferred.query, deferred.filters, deferred.sort) ?? [],
    [data, deferred],
  );
  // A weapon always stays open: the last one picked (even after a search
  // filters it out), else the top result.
  const shown = picked ?? results[0] ?? null;
  // Half a perk combo narrows its list to perks that roll opposite that half.
  const comboFirst = pendingPairValue(currentParams, "perkCombo");
  const filterIndex = useMemo(() => {
    if (!data) return [];
    return buildFilterIndex(
      comboFirst
        ? { ...data.facets, perkCombo: data.comboPartners(comboFirst) }
        : data.facets,
    );
  }, [data, comboFirst]);
  // The virtualizer owns mutable measurements; don't memoize its returned methods.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: results.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_PX + ROW_GAP_PX,
    overscan: 8,
    getItemKey: (index) => results[index].hash,
  });
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [deferred]);
  useEffect(() => {
    detailsRef.current?.scrollTo({ top: 0 });
  }, [shown?.hash]);

  function navigate(next: URLSearchParams, push = false) {
    const url = `${window.location.pathname}${next.size ? `?${next}` : ""}`;
    window.history[push ? "pushState" : "replaceState"](null, "", url);
  }
  function update(key: string, values: string[], push = true) {
    const next = new URLSearchParams(window.location.search);
    next.delete(key);
    for (const value of values) if (value) next.append(key, value);
    navigate(next, push);
  }
  function currentUrlParams() {
    return new URLSearchParams(window.location.search);
  }

  return (
    <main className="flex h-full min-h-[480px] w-full gap-6 p-4 md:p-6">
      <div className="flex min-w-0 flex-1 flex-col gap-4 lg:w-[26rem] lg:flex-none xl:w-1/2 2xl:w-[44rem]">
        <h1 className="flex shrink-0 items-center gap-2 text-lg font-medium">
          <Image src="/weapon-search-icon.png" alt="" width={28} height={28} className="size-7" />
          Weapon search
        </h1>

        {/* Full-bleed band: from the sidebar's edge to the details divider (the page's
            padding on the left, the gap before the divider on the right). */}
        <div className="-mx-4 flex shrink-0 items-start md:-mx-6">
          <WeaponSearchBox
            index={filterIndex}
            query={state.query}
            params={currentParams}
            chips={chips}
            onQuery={(text) => update("q", [text], false)}
            onAdd={(value, category) =>
              navigate(withFilter(currentUrlParams(), value, category), true)
            }
            onRemove={(chip) =>
              navigate(withoutFilter(currentUrlParams(), chip), true)
            }
            onClear={() => navigate(new URLSearchParams(), true)}
            damageTypes={data?.damageTypes}
            ammoTypes={data?.ammoTypes}
            // The result count and sort ride at the end of the bar (Figma 120:127).
            trailing={
              <>
                <span
                  role="status"
                  className="ml-auto shrink-0 text-sm tabular-nums"
                  title={
                    data
                      ? `${results.length.toLocaleString()} weapons\nCatalog updated ${data.generatedAt.slice(0, 10)}`
                      : undefined
                  }
                >
                  {query.isPending ? (
                    "Loading…"
                  ) : state !== deferred ? (
                    <span className="text-muted-foreground">Updating…</span>
                  ) : (
                    <>
                      {results.length.toLocaleString()}
                      <span className="sr-only"> weapons</span>
                    </>
                  )}
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    className="flex size-7 shrink-0 items-center justify-center text-muted-foreground outline-none hover:text-foreground focus-visible:outline-1 data-popup-open:text-foreground"
                    aria-label={`Sort weapons: ${SORT_ITEMS[state.sort]}`}
                    title={`Sort: ${SORT_ITEMS[state.sort]}`}
                  >
                    <HugeiconsIcon icon={ArrowUpDownIcon} className="size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                    </DropdownMenuGroup>
                    <DropdownMenuRadioGroup
                      value={state.sort}
                      onValueChange={(value) => update("sort", [value])}
                    >
                      {SORTS.map(([value, label]) => (
                        <DropdownMenuRadioItem key={value} value={value}>
                          {label}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            }
          />
        </div>

        {query.isError ? (
          <div role="alert" className="py-8 text-sm">
            <p>{query.error.message}</p>
            <Button className="mt-3" onClick={() => void query.refetch()}>
              Try again
            </Button>
          </div>
        ) : (
          <div
            ref={scrollRef}
            className={cn(
              // Out into the page padding by the row's border, so the
              // thumbnails line up with the heading and the search bar's icon.
              "-mx-px min-h-40 flex-1 overflow-y-auto",
              state !== deferred && "opacity-60",
            )}
            aria-busy={query.isPending || state !== deferred}
          >
            {!query.isPending && results.length === 0 && (
              <div className="py-12 text-center">
                <p>No weapons match this search.</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Try removing a filter or searching for a different perk.
                </p>
              </div>
            )}
            <div
              className="relative w-full"
              style={{ height: virtualizer.getTotalSize() }}
              role="list"
              aria-label="Weapons"
            >
              {virtualizer.getVirtualItems().map((row) => {
                const weapon = results[row.index];
                const poolLabel = data?.poolLabel(weapon.hash);
                const current = weapon.hash === shown?.hash;
                const frame = data && frameIcon(weapon, data.perks);
                return (
                  <div
                    key={row.key}
                    role="listitem"
                    aria-posinset={row.index + 1}
                    aria-setsize={results.length}
                    className="absolute top-0 left-0 w-full"
                    style={{
                      height: row.size,
                      paddingBottom: ROW_GAP_PX,
                      transform: `translateY(${row.start}px)`,
                    }}
                  >
                    {/* A nameplate, like the game's roster: the icon square at the
                        left edge, then the name, the type's silhouette, and element,
                        frame, ammo, and champion icons, on a faint wash of the
                        element's colour. */}
                    <button
                      type="button"
                      // The open weapon keeps the hover frame.
                      className={cn(
                        "flex h-full w-full items-center gap-3 overflow-hidden border border-transparent pr-3 text-left outline-none dark:[text-shadow:0_1px_2px_rgb(0_0_0/0.5)] hover:border-foreground/50 focus-visible:border-foreground/50 normal:rounded-[10px]",
                        current && "border-foreground/50",
                      )}
                      style={nameplate(weapon.element, current)}
                      onClick={() => {
                        setPicked(weapon);
                        setDialogOpen(!split);
                      }}
                      aria-current={current || undefined}
                      aria-label={`View ${weapon.name} perks`}
                    >
                      <WeaponIcon weapon={weapon} size={ROW_PX - 2} />
                      <p
                        // A set width (shrinking alike on every row) so the icons after it line up.
                        className="min-w-0 shrink basis-60 truncate text-[15px]"
                      >
                        {weapon.name}
                        {poolLabel && (
                          <span className="ml-1.5 text-muted-foreground">
                            {poolLabel}
                          </span>
                        )}
                      </p>
                      {weaponTypeIcon(weapon.type, AMMO_TYPE[weapon.ammo]) ? (
                        <IconTip label={weapon.type}>
                          <TypeSilhouette weapon={weapon} />
                        </IconTip>
                      ) : (
                        <TypeSilhouette weapon={weapon} />
                      )}
                      <span className="flex shrink-0 items-center gap-4">
                        <IconTip label={weapon.element}>
                          <ElementIcon
                            element={weapon.element}
                            damageTypes={data?.damageTypes}
                            size={18}
                          />
                        </IconTip>
                        {/* Kept as an empty slot when missing, so the columns hold. */}
                        <span className="flex size-5 shrink-0">
                          {frame && (
                            <IconTip label={weapon.frame ?? "Frame"}>
                              <Image
                                src={`https://www.bungie.net${frame}`}
                                alt={weapon.frame ?? ""}
                                width={20}
                                height={20}
                                unoptimized
                              />
                            </IconTip>
                          )}
                        </span>
                        <IconTip label={`${weapon.ammo} ammo`}>
                          <AmmoIcon
                            ammo={weapon.ammo}
                            ammoTypes={data?.ammoTypes}
                          />
                        </IconTip>
                        <span className="flex items-center gap-1.5">
                          {weapon.champions?.map((champion) => (
                            <IconTip key={champion} label={`Anti-${champion}`}>
                              <ChampionIcon
                                champion={champion}
                                championTypes={data?.championTypes}
                              />
                            </IconTip>
                          ))}
                        </span>
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <aside
        ref={detailsRef}
        aria-label="Weapon details"
        className="hidden min-w-0 flex-1 overflow-y-auto border-l border-foreground/8 pl-6 lg:block"
      >
        {/* Below the split the dialog shows the details instead; this pane is hidden,
            so don't build a second copy of them (perks, stats, Clarity) behind it. */}
        {!split ? null : shown && data ? (
          // Keyed here, not on WeaponDetails, so the fade replays per weapon.
          <div key={shown.hash} className="d2-fade grid gap-4 text-sm">
            <WeaponDetails weapon={shown} catalog={data} />
          </div>
        ) : (
          !query.isPending && (
            <p className="pt-12 text-center text-sm text-muted-foreground">
              No weapon selected.
            </p>
          )
        )}
      </aside>
      <Dialog
        open={!split && dialogOpen && picked != null}
        onOpenChange={setDialogOpen}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl">
          {picked && data && (
            <WeaponDetails
              key={picked.hash}
              weapon={picked}
              catalog={data}
              inDialog
            />
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
