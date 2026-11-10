"use client";

import { memo } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, MinusSignIcon } from "@hugeicons/core-free-icons";
import Image from "next/image";
import { TooltipLabel } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Slider, sliderValueLeft } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import {
  STAT_DISPLAY_ORDER,
  STAT_LABELS,
} from "@/lib/armory/stats";
import type { CeilingsView } from "@/lib/optimizer/optimizer-store";
import type { EmptyStatState } from "@/lib/optimizer/over-max";
import {
  createValueStore,
  useStoreValue,
  type ValueStore,
} from "@/lib/value-store";

const STAT_SLIDER_MAX = 200;
/**
 * Clickable preset markers under each stat slider, centred under the thumb.
 * The two ends (0 and the max) aren't in here: they sit flush with the row's
 * edges instead.
 */
const STAT_PRESET_TICKS = [50, 100, 150] as const;
/** Stand-in store for rows without a ceiling overlay (hooks can't be conditional). */
const NO_CEILINGS = createValueStore<CeilingsView>({ values: null, exact: false });

/** What the − / + buttons move a target by. */
const STAT_STEP = 1;

const clampTarget = (n: number) => Math.max(0, Math.min(STAT_SLIDER_MAX, n));

/**
 * One stat row per Figma 73:1636: a 16px glyph and the stat name (Geist
 * Medium 12px) on the left, the typed value in a small chip with "/ max"
 * beside it on the right, the bar 4px beneath, and the preset numbers under
 * the bar (added on top of the Figma).
 */
/** A small square − / + button beside a stat's value. */
function StepButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="text-muted-foreground hover:text-foreground hover:bg-foreground/8 focus-visible:ring-outline-strong d2-hover-ring flex size-5 cursor-pointer items-center justify-center border border-foreground/12 outline-none transition-[color,background-color,outline-offset] normal:rounded-[6px] focus-visible:ring-1 disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:size-3"
    >
      {children}
    </button>
  );
}

/**
 * One clickable marker under the bar. The caller places it (`style` /
 * `className`) and sets its hit area's sides (`after:` insets), so the end
 * ticks can grow theirs outwards only.
 */
function Tick({
  label,
  aria,
  active,
  onClick,
  className,
  style,
}: {
  label: string;
  aria: string;
  active: boolean;
  onClick: () => void;
  className: string;
  style?: React.CSSProperties;
}) {
  return (
    <TooltipLabel label={aria}>
      <button
        type="button"
        onClick={onClick}
        aria-label={aria}
        style={style}
        className={cn(
          "absolute cursor-pointer text-[10px] leading-4 font-medium tracking-wider uppercase tabular-nums normal:text-xs normal:font-normal normal:tracking-normal normal:normal-case transition-colors after:absolute after:-inset-y-1.5 after:content-[''] focus-visible:outline-1 focus-visible:outline-outline-strong",
          active
            ? "text-foreground"
            : "text-muted-foreground hover:text-foreground",
          className,
        )}
      >
        {label}
      </button>
    </TooltipLabel>
  );
}

export const StatTargetRow = memo(function StatTargetRow({
  statKey,
  index,
  icon,
  value,
  ceilingsView,
  onChange,
  onBurstChange,
  onCommit,
  emptyState,
  stepper = false,
}: {
  statKey: (typeof STAT_DISPLAY_ORDER)[number];
  index: number;
  icon?: string;
  value: number;
  /** Achievable max per stat, overlaid on the bar; without it the bar runs to 200. */
  ceilingsView?: ValueStore<CeilingsView>;
  /** One-shot edits: the ticks and the − / + buttons. */
  onChange: (index: number, value: number) => void;
  /**
   * Edits that come in bursts: dragging the slider or its arrow keys, typing in the
   * number box. The builder debounces their search. Called only when the value really
   * changes (the same contract as PowerRangeControls). Defaults to `onChange`.
   */
  onBurstChange?: (index: number, value: number) => void;
  /** A burst ended: the slider was released, or Enter / blur in the number box. */
  onCommit?: () => void;
  /**
   * Set only while nothing matches the current targets (see overMaxState): "over"
   * marks this target as past its max (lowering it to that max brings builds back);
   * "none" means the other targets leave this stat no max at all, and the row reads
   * as sitting at its own target.
   */
  emptyState?: EmptyStatState;
  /** − / + buttons (±1) beside the value. */
  stepper?: boolean;
}) {
  // A burst edit that changes nothing is dropped here, so the builder's burst mark is
  // only ever left by an edit that starts a search.
  const burstChange = (i: number, next: number) => {
    if (next !== value) (onBurstChange ?? onChange)(i, next);
  };
  const { values: ceilings, exact: ceilingsExact } = useStoreValue(
    ceilingsView ?? NO_CEILINGS,
  );
  const cap = ceilings ? ceilings[index] : null;
  const label = STAT_LABELS[statKey];
  // Achievable ceiling for this stat given the others. Overlay it as a
  // lighter fill up to that max (full-width at 200); omit while unknown
  // (before the first search) and when no `ceilingsView` is passed (Dream).
  // Every wording derived from the proven/unproven distinction lives in
  // this ONE object so the visible text, tick label, and accessible names
  // can't drift apart: an exact ceiling is a hard "/ max"; an unproven one
  // is a lower bound ("/ 81+" inline and "81+" on the tick — achievable, but
  // possibly more out there, e.g. while a refinement is still probing or its
  // budget expired). Without a ceiling the top tick and "/ n" fall back to
  // 200. While nothing matches, a stat the other targets leave no max reads
  // as sitting at its own target ("50 / 50", the owner's pick over a dash or
  // "/ 0"): the Max tick is that target, so clicking it changes nothing.
  const ceilingValue = cap ?? undefined;
  const noMax = emptyState?.kind === "none";
  const overMax = emptyState?.kind === "over";
  const maxTick =
    cap === null
      ? {
          value: STAT_SLIDER_MAX,
          srText: null,
          inline: `/ ${STAT_SLIDER_MAX}`,
          label: ceilingsView ? "Max" : String(STAT_SLIDER_MAX),
          aria: `Set ${label} to ${STAT_SLIDER_MAX}`,
        }
      : noMax
        ? {
            value,
            srText: null,
            inline: `/ ${value}`,
            label: "Max",
            aria: `Set ${label} to ${value}`,
          }
        : ceilingsExact
          ? {
              value: cap,
              srText: `${label} achievable max: ${cap}`,
              inline: `/ ${cap}`,
              label: "Max",
              aria: `Set ${label} to its max (${cap})`,
            }
          : {
              value: cap,
              srText: `${label} achievable: at least ${cap}`,
              inline: `/ ${cap}+`,
              label: `${cap}+`,
              aria: `Set ${label} to its highest proven value (${cap})`,
            };
  return (
    <div
      data-over-max={overMax || undefined}
      className="space-y-1"
    >
      {/* Header: glyph + name left; value chip + "/ max" right. */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1">
          {icon ? (
            <TooltipLabel label={label}>
              <Image
                src={`${BUNGIE_IMAGE_BASE}${icon}`}
                alt={label}
                tabIndex={0}
                width={16}
                height={16}
                className="size-4 shrink-0 opacity-65 invert dark:invert-0"
                unoptimized
              />
            </TooltipLabel>
          ) : (
            <span className="size-4 shrink-0" aria-hidden />
          )}
          <span className="truncate text-xs leading-5 font-medium text-foreground">
            {label}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {stepper && (
            <StepButton
              label={`Lower ${label} by ${STAT_STEP}`}
              disabled={value <= 0}
              onClick={() => onChange(index, clampTarget(value - STAT_STEP))}
            >
              <HugeiconsIcon icon={MinusSignIcon} aria-hidden />
            </StepButton>
          )}
          <Input
            type="number"
            min={0}
            max={STAT_SLIDER_MAX}
            step={1}
            value={value}
            aria-label={`${label} target value`}
            aria-invalid={overMax || undefined}
            onFocus={(e) => e.target.select()}
            onChange={(e) => {
              const n = Math.round(Number(e.target.value));
              burstChange(
                index,
                Number.isFinite(n)
                  ? Math.max(0, Math.min(STAT_SLIDER_MAX, n))
                  : 0,
              );
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") onCommit?.();
            }}
            onBlur={() => onCommit?.()}
            // Phones type at 16px (see globals.css), so the chip grows to hold it.
            className="h-5 w-9 max-md:h-7 max-md:w-12 max-md:normal:h-7 max-md:normal:w-12 border-foreground/12 bg-foreground/8 px-1 text-center text-[11px] leading-5 font-medium tabular-nums normal:h-6 normal:w-10 normal:rounded-[6px] normal:bg-foreground/4 normal:text-xs normal:font-normal md:normal:text-xs [appearance:textfield] md:text-[11px] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          {stepper && (
            <StepButton
              label={`Raise ${label} by ${STAT_STEP}`}
              disabled={value >= STAT_SLIDER_MAX}
              onClick={() => onChange(index, clampTarget(value + STAT_STEP))}
            >
              <HugeiconsIcon icon={Add01Icon} aria-hidden />
            </StepButton>
          )}
          {maxTick.srText && (
            <span className="sr-only">{maxTick.srText}</span>
          )}
          {overMax && (
            <span className="sr-only">
              {`${label} target is above its max. Lower it to ${emptyState.max} for builds.`}
            </span>
          )}
          <span
            className="text-[11px] leading-5 font-medium text-foreground/50 tabular-nums whitespace-nowrap"
            aria-hidden
          >
            {maxTick.inline}
          </span>
        </div>
      </div>
      {/* The end ticks sit on this unpadded box, flush with the header's
          edges: 0 under the glyph, the max under "/ max". */}
      <div className="relative min-w-0">
        {/* 3px side padding makes room for the bar's frame, which sits 2px + 1px outside the well. */}
        <div className="px-[3px]">
          <Slider
            min={0}
            max={STAT_SLIDER_MAX}
            step={1}
            value={[value]}
            onValueChange={(v) => burstChange(index, Array.isArray(v) ? v[0] : v)}
            // A pointer release ends the drag (search now); arrow keys commit on every
            // press and stay a debounced burst.
            onValueCommitted={(_, details) => {
              if (details.reason !== "keyboard") onCommit?.();
            }}
            ceiling={ceilingValue}
            // The target that keeps every build out: the bar's frame turns red (an
            // error state the owner asked for, not a selection mark).
            invalid={overMax}
            aria-label={`${label} target`}
            className="cursor-pointer"
          />
          <div className="relative mt-0.5 h-4">
            {STAT_PRESET_TICKS.map((t) => (
              <Tick
                key={t}
                label={String(t)}
                aria={`Set ${label} to ${t}`}
                active={value === t}
                onClick={() => onChange(index, t)}
                // Centred under the thumb (sliderValueLeft is the thumb's centre).
                style={{ left: sliderValueLeft(t, 0, STAT_SLIDER_MAX) }}
                className="top-0 -translate-x-1/2 after:-inset-x-2"
              />
            ))}
          </div>
        </div>
        <Tick
          label="0"
          aria={`Set ${label} to 0`}
          active={value === 0}
          onClick={() => onChange(index, 0)}
          className="bottom-0 left-0 after:-left-2 after:right-0"
        />
        {/* Uppercase tracking leaves 0.05em after the last glyph; the
            negative margin pulls that past the edge so "MAX" ends flush. */}
        <Tick
          label={maxTick.label}
          aria={maxTick.aria}
          active={value === maxTick.value}
          onClick={() => onChange(index, maxTick.value)}
          className="right-0 bottom-0 -mr-[0.05em] normal:mr-0 after:-right-2 after:left-0"
        />
      </div>
    </div>
  );
});
