"use client";

import Image from "next/image";
import type { ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { InformationCircleIcon } from "@hugeicons/core-free-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DetailCard, DetailSection } from "@/components/weapons/weapon-detail-card";
import type { Roll } from "@/lib/weapons/pick-slots";
import type { PerkRef, WeaponSummary } from "@/lib/weapons/types";
import type { WeaponPopularityView } from "@/lib/weapons/popularity-view";
import { traitColumns } from "@/lib/weapons/perk-popularity";
import { cn } from "@/lib/utils";

/** Combos shown. */
const COMBOS_SHOWN = 5;

/** Below this many copies the shares swing on a handful of players. */
const SMALL_SAMPLE = 30;

// With the hour: the snapshot is rebuilt several times a day.
const sampledAt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric" });

/** A share as a whole percent; nobody at all is "0%", a few people "<1%". */
const percent = (share: number) =>
  share === 0 ? "0%" : share < 0.01 ? "<1%" : `${Math.round(share * 100)}%`;

/**
 * A share bar's colour within its column: green for the most run perk, red for
 * the least, and the ones between graded by share. Mixed in OKLCH, so the
 * middle runs through orange and yellow rather than a muddy brown.
 */
function gradeColor(share: number, low: number, high: number) {
  const t = high > low ? (share - low) / (high - low) : 1;
  return `color-mix(in oklch, var(--emphatic-bright) ${Math.round(t * 100)}%, var(--destructive))`;
}

/** A column's name (for its label and tooltips): the game's left and right perk for the traits. */
function columnLabel(weapon: WeaponSummary, column: number) {
  const traits = traitColumns(weapon.columns);
  if (traits?.[0] === column) return "Left perk";
  if (traits?.[1] === column) return "Right perk";
  const kind = weapon.columns[column]?.kind ?? "";
  if (kind === "Intrinsic") return "Frame";
  if (kind === "Origin Trait") return "Origin trait";
  return kind;
}

/**
 * How often players run this weapon's perks in PvE, beside the perk grid: the
 * most run left + right combos as pairs of icons, then each column's perks in
 * columns like the grid's, every one with its share under it. Each picks its
 * perks in the grid (a combo picks both), so the stats show that roll; names
 * are in the tooltips.
 */
export function WeaponPopularityCard({
  weapon,
  view,
  perks,
  picked,
  onPick,
  className,
}: {
  weapon: WeaponSummary;
  view: WeaponPopularityView;
  perks: readonly PerkRef[];
  picked: Roll;
  /** Picks the roll's perks; picking one that's already picked un-picks it. */
  onPick: (roll: Roll) => void;
  className?: string;
}) {
  const combos = view.combos.slice(0, COMBOS_SHOWN);
  const isPicked = (roll: Roll) => Object.entries(roll).every(([key, perk]) => picked[Number(key)] === perk);
  return (
    <DetailCard className={className}>
      <DetailSection title="Popularity" action={<HowPopularityWorks view={view} />} />
      <DetailSection title="Perk combos">
        {combos.length === 0 ? (
          <p className="text-xs text-muted-foreground">No combos counted for this weapon yet.</p>
        ) : (
          // As many to a row as fit, stretched across the card.
          <div className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-2">
            {combos.map((combo) => {
              const left = perks[combo.left];
              const right = perks[combo.right];
              return (
                <ShareCell
                  key={`${combo.left},${combo.right}`}
                  label={`${left?.name} + ${right?.name}`}
                  share={combo.share}
                  selected={isPicked({ [combo.leftColumn]: combo.left, [combo.rightColumn]: combo.right })}
                  onClick={() => onPick({ [combo.leftColumn]: combo.left, [combo.rightColumn]: combo.right })}
                >
                  <span className="flex gap-1">
                    <PerkIcon perk={left} />
                    <PerkIcon perk={right} />
                  </span>
                </ShareCell>
              );
            })}
          </div>
        )}
      </DetailSection>
      <DetailSection
        title="Individual perks"
        action={
          <button
            type="button"
            onClick={() => onPick(view.topRoll)}
            className="d2-hover-ring h-7 bg-foreground/10 px-2.5 text-xs font-normal outline-none focus-visible:d2-tile-selected"
          >
            Try most popular roll
          </button>
        }
      >
        {/* The grid's columns and perks in its own order, so each lines up with it;
            the columns share the card's width, scrolling only if they can't fit. */}
        <div
          className="grid gap-1.5 overflow-x-auto pb-1"
          style={{ gridTemplateColumns: `repeat(${view.columns.length}, minmax(3.25rem, 1fr))` }}
        >
          {view.columns.map(({ column, perks: shares }) => {
            const high = Math.max(...shares.map((p) => p.share));
            const low = Math.min(...shares.map((p) => p.share));
            return (
              <section
                key={column}
                aria-label={columnLabel(weapon, column)}
                className="flex min-w-0 flex-col gap-1.5"
              >
                {shares.map(({ perkIndex, share }) => (
                  <ShareCell
                    key={perkIndex}
                    label={`${columnLabel(weapon, column)}: ${perks[perkIndex]?.name ?? ""}`}
                    share={share}
                    bar={gradeColor(share, low, high)}
                    selected={isPicked({ [column]: perkIndex })}
                    onClick={() => onPick({ [column]: perkIndex })}
                  >
                    <PerkIcon perk={perks[perkIndex]} />
                  </ShareCell>
                ))}
              </section>
            );
          })}
        </div>
      </DetailSection>
    </DetailCard>
  );
}

/**
 * The info icon at the right of the Popularity heading: how the numbers are
 * worked out, and how many sightings of this weapon they come from.
 */
function HowPopularityWorks({ view }: { view: WeaponPopularityView }) {
  const sampled = view.generatedAt ? sampledAt.format(new Date(view.generatedAt)) : undefined;
  return (
    <Tooltip>
      <TooltipTrigger
        delay={0}
        render={
          <button
            type="button"
            aria-label="How popularity is worked out"
            className="flex size-7 items-center justify-center text-muted-foreground outline-none hover:text-foreground focus-visible:d2-tile-selected"
          />
        }
      >
        <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={2} className="size-4" aria-hidden />
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end" className="grid max-w-72 gap-1.5 text-xs">
        <p>
          We sample players from PvE matches as they end and read the perks on the legendary
          weapons they actually used in that match, over about the last week. Someone who plays a
          lot can be seen more than once.
        </p>
        <p>
          Each percentage is the share of those sightings running that perk, or that left and right
          perk together.
        </p>
        <p className="text-muted-foreground">
          Seen {view.copies === 1 ? "once" : `${view.copies.toLocaleString("en-US")} times`}
          {sampled ? `, as of ${sampled}` : ""}.
          {view.copies < SMALL_SAMPLE && " A small sample, so treat these as rough."}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

function PerkIcon({ perk }: { perk: PerkRef | undefined }) {
  return perk?.icon ? (
    <Image src={`https://www.bungie.net${perk.icon}`} alt="" width={32} height={32} className="size-8" unoptimized />
  ) : (
    <span className="size-8 bg-foreground/10" />
  );
}

/**
 * One perk or combo in the card: its icon(s), the share under them, and for a
 * perk a bar as wide as the share, in `bar`'s colour, all inside a light
 * hairline. Picked ones take the grid's picked blue; the name is in the tooltip.
 */
function ShareCell({
  label,
  share,
  bar,
  selected,
  onClick,
  children,
}: {
  label: string;
  share: number;
  /** The share bar's colour; no bar without one. */
  bar?: string;
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        delay={0}
        render={
          <button
            type="button"
            aria-pressed={selected}
            aria-label={`${label}, ${percent(share)}`}
            onClick={onClick}
            className={cn(
              "d2-hover-ring flex w-full min-w-13 flex-col items-center gap-1 border border-foreground/15 px-1.5 pt-1.5 pb-1 outline-none focus-visible:d2-tile-selected",
              selected ? "bg-[#305f8e] text-white" : "bg-foreground/4 hover:bg-foreground/8",
            )}
          />
        }
      >
        {children}
        <span className="text-[11px] leading-none tabular-nums">{percent(share)}</span>
        {bar && (
          <span aria-hidden className="block h-1 w-full bg-foreground/15">
            <span
              className="block h-full"
              style={{ width: `${Math.max(share * 100, 2)}%`, backgroundColor: bar }}
            />
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
