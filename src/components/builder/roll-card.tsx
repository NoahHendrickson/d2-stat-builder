"use client";

import type { ReactNode } from "react";
import { ArmorThumb } from "@/components/armor-thumb";
import { StatGlyph } from "@/components/stat-glyph";
import { BUILD_CARD_LIFT_CLASS } from "@/components/builder/build-results";
import { armorPipTier, type ArmorPiece } from "@/lib/armory/normalize";
import { isFullyMasterworked } from "@/lib/armory/masterwork";
import { STAT_DISPLAY_ORDER, STAT_LABELS, STAT_ORDER, type StatIconMap } from "@/lib/armory/stats";
import { cn } from "@/lib/utils";

/**
 * The card theoretical builds and Dream build options share: the build's stats, a line
 * about what to farm, one row per slot (archetype, tertiary, tuned stat), and its mods.
 */

const STAT_COLS = STAT_DISPLAY_ORDER.map((key) => ({ key, i: STAT_ORDER.indexOf(key) }));

export function Glyph({ stat, icons, className }: { stat: number; icons: StatIconMap; className?: string }) {
  const key = STAT_ORDER[stat];
  return <StatGlyph src={icons[key]} label={STAT_LABELS[key]} className={className} />;
}

/** A stat as a glyph and its name. */
export function StatName({ stat, icons }: { stat: number; icons: StatIconMap }) {
  return (
    <span className="inline-flex items-center gap-1 text-sm whitespace-nowrap">
      <Glyph stat={stat} icons={icons} />
      {STAT_LABELS[STAT_ORDER[stat]]}
    </span>
  );
}

/**
 * A directional tuning: the +5 stat by name, the −5 stat as a small glyph after it.
 * Without `minus`, just the tuned stat (Dream build's kept pieces: the user found the
 * −5 there confusing).
 */
export function TuningName({
  plus,
  minus,
  icons,
  title,
}: {
  plus: number;
  minus?: number;
  icons: StatIconMap;
  title?: string;
}) {
  const plusLabel = STAT_LABELS[STAT_ORDER[plus]];
  return (
    <span
      className="inline-flex items-center gap-1 text-sm whitespace-nowrap tabular-nums"
      title={
        title ??
        (minus === undefined
          ? `Tuned +5 ${plusLabel}`
          : `Tuned stat ${plusLabel}: +5 ${plusLabel}, −5 ${STAT_LABELS[STAT_ORDER[minus]]}`)
      }
    >
      <Glyph stat={plus} icons={icons} />
      {plusLabel}
      {minus !== undefined && (
        <span className="text-muted-foreground inline-flex items-center gap-0.5 text-xs">
          −5
          <Glyph stat={minus} icons={icons} className="size-3.5" />
        </span>
      )}
    </span>
  );
}

/** A muted word in the Tertiary / Tuned columns ("Any", "None"). */
export function MutedCell({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span className="text-muted-foreground text-sm whitespace-nowrap" title={title}>
      {children}
    </span>
  );
}

/** Vertical rule between header clusters (as on the build cards). */
export function HeaderRule() {
  return <span className="h-[15px] w-px shrink-0 bg-foreground/16" aria-hidden />;
}

/** The stat mods a build sockets per stat, [majors, minors]: "+10 [Weapons] ×2  +5 [Grenade]". */
export function ModList({ mods, icons }: { mods: [number, number][]; icons: StatIconMap }) {
  const parts: ReactNode[] = [];
  for (const { i } of STAT_COLS) {
    const [major, minor] = mods[i];
    for (const [size, n] of [
      [10, major],
      [5, minor],
    ] as const) {
      if (!n) continue;
      parts.push(
        <span key={`${i}:${size}`} className="text-foreground inline-flex items-center gap-1 tabular-nums">
          +{size}
          <Glyph stat={i} icons={icons} />
          {n > 1 && <span className="text-muted-foreground">×{n}</span>}
        </span>,
      );
    }
  }
  return (
    <span className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      {parts.length ? (
        <>
          <span>Mods</span>
          {parts}
        </>
      ) : (
        "No stat mods"
      )}
    </span>
  );
}

/**
 * A row's thumb: the owned item's icon, the exotic's (a roll to farm), or a frame holding
 * the roll's primary stat.
 */
export function RollThumb({
  owned,
  exotic,
  primary,
  icons,
}: {
  owned?: ArmorPiece;
  exotic?: { icon?: string; watermark?: string; name: string };
  primary?: number;
  icons: StatIconMap;
}) {
  if (owned?.icon) {
    return (
      <ArmorThumb
        icon={owned.icon}
        watermark={owned.watermark}
        alt={owned.name}
        size={32}
        masterworked={isFullyMasterworked(owned)}
        gearTier={armorPipTier(owned)}
      />
    );
  }
  if (exotic?.icon) {
    return <ArmorThumb icon={exotic.icon} watermark={exotic.watermark} alt={exotic.name} size={32} gearTier={5} />;
  }
  return (
    <span className="d2-brackets flex size-8 shrink-0 items-center justify-center bg-black/25">
      {primary !== undefined && <Glyph stat={primary} icons={icons} className="opacity-60" />}
    </span>
  );
}

/**
 * A row's Armor cell: the thumb, the archetype with its two stats (or a plain name for a
 * piece without one), and a detail line under it.
 */
export function RollIdentity({
  thumb,
  archetype,
  name,
  icons,
  children,
  rows = 1,
}: {
  thumb: ReactNode;
  archetype?: { name: string; primary: number; secondary: number };
  /** Shown instead of the archetype when there is none (legacy pieces). */
  name?: string;
  icons: StatIconMap;
  /** The detail line: owned item, exotic, slot, set… (none when empty). */
  children?: ReactNode;
  /** Rows the cell spans (a roll to farm can list several tertiaries). */
  rows?: number;
}) {
  return (
    <div
      className="flex min-w-0 items-center gap-2"
      style={rows > 1 ? { gridRow: `span ${rows}` } : undefined}
    >
      {thumb}
      <div className="flex min-w-0 flex-col justify-center">
        <span className="flex min-w-0 items-center gap-1.5 text-sm">
          <span className="truncate">{archetype?.name ?? name}</span>
          {archetype && (
            <>
              <Glyph stat={archetype.primary} icons={icons} className="size-3.5" />
              <Glyph stat={archetype.secondary} icons={icons} className="size-3.5" />
            </>
          )}
        </span>
        {children && <span className="flex min-w-0 items-center gap-1.5 text-xs">{children}</span>}
      </div>
    </div>
  );
}

/** The card: stats header, a meta line, the slot rows, and a footer (mods, notes). */
export function RollCard({
  stats,
  meta,
  footer,
  dimmed = false,
  children,
}: {
  stats: ReactNode;
  /** The line under the stats; null = none. */
  meta: ReactNode;
  footer: ReactNode;
  /** A newer search is running: the card stays up, faded. */
  dimmed?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn(BUILD_CARD_LIFT_CLASS, "@container/build transition-opacity", dimmed && "opacity-50")}>
      <div className="overflow-hidden rounded-none normal:rounded-[19px]">
        <div className="flex flex-col gap-2 p-2 normal:bg-popover normal:p-3">
          {stats}
          {meta && <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">{meta}</div>}
        </div>
        <div className="border-t border-foreground/8 px-4 max-md:px-3">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-6 gap-y-3 py-3 max-md:gap-x-3">
            <div className="d2-label">Armor</div>
            <div className="d2-label">Tertiary</div>
            <div className="d2-label">Tuned</div>
            {children}
          </div>
        </div>
        <div className="flex flex-col gap-2 border-t border-foreground/8 px-4 py-3 max-md:px-3">
          {footer}
        </div>
      </div>
    </div>
  );
}

/** The header's total and six stats; with `was`, each shows its change from that build. */
export function CardStats({
  total,
  stats,
  was,
  short,
  icons,
}: {
  total: number;
  stats: number[];
  was?: { total: number; stats: number[] };
  /** Points each stat is short of its target (a close build): those show in yellow. */
  short?: number[];
  icons: StatIconMap;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <span className="text-base font-medium tabular-nums">
        {total}
        {was && <Delta value={total - was.total} />}
      </span>
      <div className="flex flex-wrap items-center gap-x-8 gap-y-1 text-base font-medium tabular-nums">
        {STAT_COLS.map(({ key, i }) => (
          <span key={key} className={cn("flex items-center gap-1", short?.[i] && "text-warning")}>
            <StatGlyph src={icons[key]} label={STAT_LABELS[key]} className="size-5" plain />
            {stats[i]}
            {was && <Delta value={stats[i] - was.stats[i]} />}
          </span>
        ))}
      </div>
    </div>
  );
}

function Delta({ value }: { value: number }) {
  if (!value) return null;
  return (
    <span className={cn("ml-0.5 text-xs", value > 0 ? "text-positive" : "text-destructive")}>
      {value > 0 ? `+${value}` : value}
    </span>
  );
}
