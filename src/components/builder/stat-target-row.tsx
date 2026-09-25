"use client";

import { memo } from "react";
import { Minus, Plus } from "@phosphor-icons/react";
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
import {
  createValueStore,
  useStoreValue,
  type ValueStore,
} from "@/lib/value-store";

/** Clickable preset markers under each stat slider. */
const STAT_TARGET_TICKS = [0, 50, 100, 150, 200] as const;
const STAT_SLIDER_MAX = STAT_TARGET_TICKS[STAT_TARGET_TICKS.length - 1];
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
      className="text-muted-foreground hover:text-foreground hover:bg-foreground/8 focus-visible:ring-outline-strong flex size-5 cursor-pointer items-center justify-center border border-foreground/12 outline-none focus-visible:ring-1 disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:size-3"
    >
      {children}
    </button>
  );
}

export const StatTargetRow = memo(function StatTargetRow({
  statKey,
  index,
  icon,
  value,
  ceilingsView,
  onChange,
  stepper = false,
}: {
  statKey: (typeof STAT_DISPLAY_ORDER)[number];
  index: number;
  icon?: string;
  value: number;
  /** Achievable max per stat, overlaid on the bar; without it the bar runs to 200. */
  ceilingsView?: ValueStore<CeilingsView>;
  onChange: (index: number, value: number) => void;
  /** − / + buttons (±1) beside the value. */
  stepper?: boolean;
}) {
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
  // is a lower bound ("81+" — achievable, but possibly more out there, e.g.
  // while a refinement is still probing or its budget expired). Both render
  // "/ n" inline; only the tick label and accessible wording mark the
  // difference.
  const ceilingValue = cap ?? undefined;
  const capText =
    cap === null
      ? null
      : ceilingsExact
        ? {
            srText: `${label} achievable max: ${cap}`,
            tickLabel: "Max",
            tickAria: `Set ${label} to its max (${cap})`,
          }
        : {
            srText: `${label} achievable: at least ${cap}`,
            tickLabel: `${cap}+`,
            tickAria: `Set ${label} to its highest proven value (${cap})`,
          };
  return (
    <div className="space-y-1">
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
              <Minus aria-hidden />
            </StepButton>
          )}
          <Input
            type="number"
            min={0}
            max={STAT_SLIDER_MAX}
            step={1}
            value={value}
            aria-label={`${label} target value`}
            onFocus={(e) => e.target.select()}
            onChange={(e) => {
              const n = Math.round(Number(e.target.value));
              onChange(
                index,
                Number.isFinite(n)
                  ? Math.max(0, Math.min(STAT_SLIDER_MAX, n))
                  : 0,
              );
            }}
            className="h-5 w-9 border-foreground/12 bg-foreground/8 px-1 text-center text-[11px] leading-5 font-medium tabular-nums [appearance:textfield] md:text-[11px] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          {stepper && (
            <StepButton
              label={`Raise ${label} by ${STAT_STEP}`}
              disabled={value >= STAT_SLIDER_MAX}
              onClick={() => onChange(index, clampTarget(value + STAT_STEP))}
            >
              <Plus aria-hidden />
            </StepButton>
          )}
          {capText && <span className="sr-only">{capText.srText}</span>}
          <span
            className="text-[11px] leading-5 font-medium text-foreground/50 tabular-nums whitespace-nowrap"
            aria-hidden
          >
            / {cap ?? STAT_SLIDER_MAX}
          </span>
        </div>
      </div>
      {/* 3px side padding makes room for the bar's frame, which sits 2px + 1px outside the well. */}
      <div className="min-w-0 px-[3px]">
        <Slider
          min={0}
          max={STAT_SLIDER_MAX}
          step={1}
          value={[value]}
          onValueChange={(v) => onChange(index, Array.isArray(v) ? v[0] : v)}
          ceiling={ceilingValue}
          aria-label={`${label} target`}
          className="cursor-pointer"
        />
        <div className="relative mt-0.5 h-4">
          {STAT_TARGET_TICKS.map((t) => {
            // Once a ceiling is known, the top tick jumps the target to
            // that achievable value instead of 200 (labels per capText).
            const isCeilingTick = t === STAT_SLIDER_MAX && cap !== null;
            const tickValue = isCeilingTick ? cap : t;
            const tickLabel = isCeilingTick
              ? capText!.tickLabel
              : t === STAT_SLIDER_MAX && ceilingsView
                ? "Max"
                : String(t);
            const tickAria = isCeilingTick
              ? capText!.tickAria
              : `Set ${label} to ${t}`;
            return (
              <TooltipLabel label={tickAria} key={t}>
                <button
                  type="button"
                  onClick={() => onChange(index, tickValue)}
                  aria-label={tickAria}
                  style={{
                    left: sliderValueLeft(t, 0, STAT_SLIDER_MAX),
                  }}
                  className={cn(
                    // Centered under the thumb (sliderValueLeft is the thumb's center).
                    "absolute top-0 -translate-x-1/2 cursor-pointer text-[10px] leading-4 font-medium tracking-wider uppercase tabular-nums transition-colors after:absolute after:-inset-x-2 after:-inset-y-1.5 after:content-[''] focus-visible:outline-1 focus-visible:outline-outline-strong",
                    value === tickValue
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tickLabel}
                </button>
              </TooltipLabel>
            );
          })}
        </div>
      </div>
    </div>
  );
});
