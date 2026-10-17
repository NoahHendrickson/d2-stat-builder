"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Roll } from "@/lib/weapons/pick-slots";
import type {
  PopularityView,
  WeaponPopularityView,
} from "@/lib/weapons/use-perk-popularity";

const MODES: { value: PopularityView; label: string }[] = [
  { value: "pve", label: "PvE" },
  { value: "pvp", label: "PvP" },
  { value: "all", label: "All" },
];

/** Below this many copies the shares swing on a handful of players. */
const SMALL_SAMPLE = 30;

const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

/** Small pill buttons, the same as Find a roll's match modes. */
const PILL =
  "d2-hover-ring h-7 px-2.5 text-xs font-normal outline-none focus-visible:d2-tile-selected";

/** The Perks header's switch for showing popularity. */
export function PopularityToggle({ view }: { view: WeaponPopularityView }) {
  return (
    <button
      type="button"
      aria-pressed={view.shown}
      onClick={() => view.setShown(!view.shown)}
      className={cn(PILL, view.shown ? "bg-foreground text-background" : "bg-foreground/10")}
    >
      Popularity
    </button>
  );
}

/**
 * Under the Perks title while popularity shows: which matches to count, how
 * many copies that is and when they were sampled, and a button that picks the
 * most run perk in every column.
 */
export function PopularityBar({
  view,
  onTryTop,
}: {
  view: WeaponPopularityView;
  onTryTop: (roll: Roll) => void;
}) {
  const sampled = view.generatedAt ? shortDate.format(new Date(view.generatedAt)) : undefined;
  return (
    <div className="mt-1 grid gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="flex gap-1" role="radiogroup" aria-label="Count copies from">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={view.mode === m.value}
              onClick={() => view.setMode(m.value)}
              className={cn(
                PILL,
                view.mode === m.value ? "bg-foreground text-background" : "bg-foreground/10",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={view.copies === 0}
          onClick={() => onTryTop(view.topRoll())}
          className={cn(PILL, "bg-foreground/10 disabled:opacity-40")}
        >
          Try most popular roll
        </button>
      </div>
      <span>
        {view.copies === 0
          ? "No equipped copies seen in these matches yet."
          : `How often each perk is on the ${view.copies.toLocaleString("en-US")} equipped ${
              view.copies === 1 ? "copy" : "copies"
            } we've seen${sampled ? `, sampled ${sampled}` : ""}.`}
        {view.copies > 0 && view.copies < SMALL_SAMPLE && " A small sample, so treat these as rough."}
      </span>
    </div>
  );
}

/**
 * A perk tile with its share under it while popularity shows. The most run perk
 * in the column reads brighter; perks no one ran dim.
 */
export function PopularityShare({
  view,
  column,
  perkIndex,
  selected,
  children,
}: {
  view: WeaponPopularityView;
  column: number;
  perkIndex: number;
  selected: boolean;
  children: ReactNode;
}) {
  const share = view.shown ? view.share(column, perkIndex) : undefined;
  if (share === undefined) return children;
  const top = view.isTop(column, perkIndex);
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-1 transition-opacity",
        share === 0 && !selected && "opacity-40",
      )}
    >
      {children}
      <span
        className={cn(
          "text-[11px] leading-none tabular-nums",
          top ? "font-medium text-foreground" : "text-muted-foreground",
        )}
      >
        {share === 0 ? "0%" : share < 0.01 ? "<1%" : `${Math.round(share * 100)}%`}
      </span>
    </div>
  );
}
