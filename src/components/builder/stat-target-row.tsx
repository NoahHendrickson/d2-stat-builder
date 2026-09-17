"use client";

import { memo } from "react";
import Image from "next/image";
import { TooltipLabel } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import {
  Slider,
  sliderValueLeft,
  useSliderThumbPx,
} from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import {
  STAT_DISPLAY_ORDER,
  STAT_LABELS,
} from "@/lib/armory/stats";
import type { CeilingsView } from "@/lib/optimizer/optimizer-store";
import { useStoreValue, type ValueStore } from "@/lib/value-store";

/** Clickable preset markers under each stat slider. */
const STAT_TARGET_TICKS = [0, 50, 100, 150, 200] as const;
const STAT_SLIDER_MAX = STAT_TARGET_TICKS[STAT_TARGET_TICKS.length - 1];

/**
 * One stat row per Figma 73:1636: a 16px glyph and the stat name (Geist
 * Medium 12px) on the left, the typed value in a small chip with "/ max"
 * beside it on the right, the bar 4px beneath, and the preset numbers under
 * the bar (added on top of the Figma).
 */
export const StatTargetRow = memo(function StatTargetRow({
  statKey,
  index,
  icon,
  value,
  ceilingsView,
  onChange,
}: {
  statKey: (typeof STAT_DISPLAY_ORDER)[number];
  index: number;
  icon?: string;
  value: number;
  ceilingsView: ValueStore<CeilingsView>;
  onChange: (index: number, value: number) => void;
}) {
  const { values: ceilings, exact: ceilingsExact } = useStoreValue(ceilingsView);
  const thumbPx = useSliderThumbPx();
  const cap = ceilings ? ceilings[index] : null;
  const label = STAT_LABELS[statKey];
  // Achievable ceiling for this stat given the others. Overlay it as a
  // lighter fill up to that max (full-width at 200); omit only while
  // unknown (before the first search). Every wording derived from the
  // proven/unproven distinction lives in this ONE object so the visible
  // text, tick label, and accessible names can't drift apart: an exact
  // ceiling is a hard "/ max"; an unproven one is a lower bound ("81+"
  // — achievable, but possibly more out there, e.g. while a refinement
  // is still probing or its budget expired). Both render "/ n" inline;
  // only the tick label and accessible wording mark the difference.
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
        <div className="flex shrink-0 items-center gap-0.5 d2:gap-2">
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
            className="h-7 w-10 px-2 text-center text-xs tabular-nums [appearance:textfield] md:text-xs [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none d2:h-5 d2:w-9 d2:border-foreground/12 d2:bg-foreground/8 d2:px-1 d2:text-[11px] d2:leading-5 d2:font-medium d2:md:text-[11px]"
          />
          {capText && <span className="sr-only">{capText.srText}</span>}
          <span
            className="text-muted-foreground w-9 shrink-0 text-xs tabular-nums whitespace-nowrap d2:w-auto d2:text-[11px] d2:leading-5 d2:font-medium d2:text-foreground/50"
            aria-hidden
          >
            / {cap ?? STAT_SLIDER_MAX}
          </span>
        </div>
      </div>
      {/* 3px side padding makes room for the bar's frame, which sits 2px + 1px outside the well. */}
      <div className="min-w-0 d2:px-[3px]">
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
              : t === STAT_SLIDER_MAX
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
                    left: sliderValueLeft(t, 0, STAT_SLIDER_MAX, thumbPx),
                  }}
                  className={cn(
                    // Centered under the thumb (sliderValueLeft is the thumb's center).
                    "absolute top-0 -translate-x-1/2 cursor-pointer text-xs leading-4 tabular-nums transition-colors after:absolute after:-inset-x-2 after:-inset-y-1.5 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-hidden d2:text-[10px] d2:font-medium d2:tracking-wider d2:uppercase d2:focus-visible:ring-0 d2:focus-visible:outline-1 d2:focus-visible:outline-offset-0 d2:focus-visible:outline-outline-strong",
                    value === tickValue
                      ? "text-foreground"
                      : "text-foreground/75 hover:text-foreground d2:text-muted-foreground d2:hover:text-foreground",
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
