"use client";

import Image from "next/image";
import type { CSSProperties, ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { InformationCircleIcon } from "@hugeicons/core-free-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DetailCard, DetailSection } from "@/components/detail-card";
import type { Roll } from "@/lib/weapons/pick-slots";
import type { PerkRef, WeaponSummary } from "@/lib/weapons/types";
import { MIN_MASTERWORK_COPIES, type WeaponPopularityView } from "@/lib/weapons/popularity-view";
import { traitColumns } from "@/lib/weapons/perk-popularity";
import { percent, sampledAt } from "@/lib/popularity-format";
import { cn } from "@/lib/utils";

/** Combos shown. */
const COMBOS_SHOWN = 5;

/** Below this many copies the shares swing on a handful of players. */
const SMALL_SAMPLE = 30;

/** Below this part of the weapon's copies, the Masterworks section says how many its shares come from. */
const MOST_COPIES = 0.9;

/** Each share marker's glow, a soft halo in its `--grade`: the dot's tighter, so it stays close to the dot. */
const MARKER_GLOW = {
  bar: "shadow-[0_0_8px_color-mix(in_oklch,var(--grade)_70%,transparent)]",
  dot: "shadow-[0_0_4px_color-mix(in_oklch,var(--grade)_60%,transparent)]",
};

/**
 * Grades shares against their peers (a column's perks, or all of a weapon's
 * combos): green for the most run, red for the least, and the ones between
 * graded by share. Mixed in OKLCH, so the middle runs through orange and
 * yellow rather than a muddy brown. All equal → all green, with no glow.
 */
function gradeShares(shares: readonly number[]) {
  const high = Math.max(...shares);
  const low = Math.min(...shares);
  const glow = high > low;
  return {
    glow,
    color: (share: number) =>
      `color-mix(in oklch, var(--emphatic-bright) ${glow ? Math.round(((share - low) / (high - low)) * 100) : 100}%, var(--destructive))`,
  };
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
 * How many copies of this weapon carry each perk, beside the perk grid: the
 * most run left + right combos as pairs of icons, then each column's perks in
 * columns like the grid's, every one with its share under it, then the
 * masterworks the same way. Each picks its perks in the grid (a combo picks
 * both), so the stats show that roll; names are in the tooltips.
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
  // Graded against every combo, not just those shown, so the last shown isn't always red.
  const comboGrades = gradeShares(view.combos.map((c) => c.share));
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
                  grade={comboGrades.color(combo.share)}
                  marker="dot"
                  glow={comboGrades.glow}
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
            const grades = gradeShares(shares.map((p) => p.share));
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
                    grade={grades.color(share)}
                    marker="bar"
                    glow={grades.glow}
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
      {view.masterworks && <MasterworkShares view={view} perks={perks} isPicked={isPicked} onPick={onPick} />}
    </DetailCard>
  );
}

/**
 * The Masterworks section: each masterwork the weapon takes, with its share of
 * the copies whose masterwork is known. Those are only the copies read since
 * masterworks were first counted, so until there are MIN_MASTERWORK_COPIES of
 * them it says so instead of showing shares (no masterwork reading 0% for
 * want of data), and while they're well short of the weapon's copies it says
 * how many there are.
 */
function MasterworkShares({
  view,
  perks,
  isPicked,
  onPick,
}: {
  view: WeaponPopularityView;
  perks: readonly PerkRef[];
  isPicked: (roll: Roll) => boolean;
  onPick: (roll: Roll) => void;
}) {
  const { slot, counted, perks: shares } = view.masterworks!;
  const grades = gradeShares(shares.map((p) => p.share));
  const copies = (n: number) => (n === 1 ? "one copy" : `${n.toLocaleString("en-US")} copies`);
  return (
    // Named apart from the Perks card's own Masterworks section.
    <DetailSection title="Popular masterworks" heading="Masterworks">
      {counted === 0 ? (
        <p className="text-xs text-muted-foreground">No masterworks counted for this weapon yet.</p>
      ) : counted < MIN_MASTERWORK_COPIES ? (
        <p className="text-xs text-muted-foreground">
          Counted on only {copies(counted)} so far, too few to show.
        </p>
      ) : (
        <div className="grid gap-1.5">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(3.25rem,1fr))] gap-1.5">
            {shares.map(({ perkIndex, share }) => (
              <ShareCell
                key={perkIndex}
                label={perks[perkIndex]?.name ?? ""}
                share={share}
                grade={grades.color(share)}
                marker="bar"
                glow={grades.glow}
                selected={isPicked({ [slot]: perkIndex })}
                onClick={() => onPick({ [slot]: perkIndex })}
              >
                <PerkIcon perk={perks[perkIndex]} />
              </ShareCell>
            ))}
          </div>
          {counted < view.copies * MOST_COPIES && (
            <p className="text-xs text-muted-foreground">
              Counted on {counted.toLocaleString("en-US")} of {copies(view.copies)} so far.
            </p>
          )}
        </div>
      )}
    </DetailSection>
  );
}

/**
 * The info icon at the right of the Popularity heading: how the numbers are
 * worked out, and how many copies of this weapon they come from.
 */
function HowPopularityWorks({ view }: { view: WeaponPopularityView }) {
  const sampled = view.generatedAt ? sampledAt(view.generatedAt) : undefined;
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
          We find players through PvE matches and read the perks on the legendary weapons they
          have equipped, plus the ones in their vault when it&apos;s public. Players signed in here
          count with their whole vault. Each copy counts once, while its owner keeps playing and still
          has it.
        </p>
        <p>
          Each percentage is the share of those copies with that perk, or with that left and right
          perk together. Masterworks are shares of the copies whose masterwork we know, at any tier.
        </p>
        <p className="text-muted-foreground">
          {view.copies === 1 ? "One copy" : `${view.copies.toLocaleString("en-US")} copies`}
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
 * One perk or combo in the card: its icon(s) and the share under them, all
 * inside a light hairline. The share is marked in `grade`: a
 * bar as wide as the share under it (perks), or a dot before it (combos). With
 * `glow`, an unpicked cell's marker also glows faintly, so the best reads green
 * at a glance. Picked ones take the grid's picked blue; the name is in the tooltip.
 */
function ShareCell({
  label,
  share,
  grade,
  marker,
  glow,
  selected,
  onClick,
  children,
}: {
  label: string;
  share: number;
  /** The share's colour. */
  grade: string;
  /** How the share is marked in `grade`: a bar under it, or a dot before it. */
  marker: keyof typeof MARKER_GLOW;
  /** Glow in `grade`; off when every share among its peers is the same. */
  glow: boolean;
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const markerGlow = glow && !selected && MARKER_GLOW[marker];
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
            style={{ "--grade": grade } as CSSProperties}
          />
        }
      >
        {children}
        {/* The dot hangs off the left of the number, so the number stays centred under the icons. */}
        <span className="relative text-[11px] leading-none tabular-nums">
          {marker === "dot" && (
            <span
              aria-hidden
              className={cn("absolute top-1/2 right-full mr-1 size-1.5 -translate-y-1/2 rounded-full bg-(--grade)", markerGlow)}
            />
          )}
          {percent(share)}
        </span>
        {marker === "bar" && (
          <span aria-hidden className="block h-1 w-full bg-foreground/15">
            <span
              className={cn("block h-full bg-(--grade)", markerGlow)}
              style={{ width: `${Math.max(share * 100, 2)}%` }}
            />
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
