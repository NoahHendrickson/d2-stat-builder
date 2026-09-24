"use client";

import { Fragment, useState } from "react";
import { ArrowRight } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { ArmorThumb } from "@/components/armor-thumb";
import { StatGlyph } from "@/components/stat-glyph";
import { armorPipTier, type ArmorPiece } from "@/lib/armory/normalize";
import { isFullyMasterworked } from "@/lib/armory/masterwork";
import {
  SLOT_LABELS,
  ARMOR_SLOTS,
  STAT_DISPLAY_ORDER,
  STAT_LABELS,
  STAT_ORDER,
  tertiaryStatIndex,
  type StatIconMap,
} from "@/lib/armory/stats";
import {
  farmOdds,
  type DreamOption,
  type DreamResult,
  type FarmPiece,
} from "@/lib/optimizer/dream";
import type { DreamBuildState } from "@/lib/optimizer/use-dream-build";
import type { AppliedTuning, OptimizerLoadout } from "@/lib/optimizer/types";
import { cn } from "@/lib/utils";

/** Every (tertiary, tuned) drop of one archetype: 4 tertiaries × 6 tuned stats. */
const ROLLS_PER_ARCHETYPE = 24;

function pieces(n: number): string {
  return `${n} new piece${n === 1 ? "" : "s"}`;
}

/** What the running search is doing, from the phase the worker last reported. */
function workingLabel(phase: number | null): string {
  if (phase === null || phase === 0) return "Checking this build…";
  return `Trying ${pieces(phase)}…`;
}

function statusLabel({ running, phase, result }: DreamBuildState): string {
  if (running) return workingLabel(phase);
  if (!result) return "";
  if (result.newPieces === null) return "Out of reach";
  if (result.newPieces === 0) return "No farming needed";
  return pieces(result.newPieces);
}

/** A thin track with a sweeping segment while a search runs; empty track when idle. */
function WorkingBar({ running }: { running: boolean }) {
  return (
    <div
      role="progressbar"
      aria-label="Dream build search"
      aria-busy={running}
      className="relative h-1 w-full overflow-hidden bg-foreground/8"
    >
      {running && (
        <div className="bg-foreground absolute inset-y-0 left-0 w-2/5 animate-[dream-sweep_1.1s_ease-in-out_infinite]" />
      )}
    </div>
  );
}

function Glyph({ stat, icons }: { stat: number; icons: StatIconMap }) {
  const key = STAT_ORDER[stat];
  return <StatGlyph src={icons[key]} label={STAT_LABELS[key]} />;
}

/** The tertiary / tuned requirements of one farm piece, as compactly as they allow. */
function FarmRolls({ farm, icons }: { farm: FarmPiece; icons: StatIconMap }) {
  if (farmOdds(farm) === ROLLS_PER_ARCHETYPE) {
    return <span>Any tertiary, any tuning</span>;
  }
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {farm.rolls.map((roll) => (
        <span key={roll.tertiary} className="inline-flex items-center gap-1">
          <Glyph stat={roll.tertiary} icons={icons} />
          {STAT_LABELS[STAT_ORDER[roll.tertiary]]} tertiary
          {roll.tuned === null ? (
            <span className="text-muted-foreground">· any tuning</span>
          ) : (
            <span className="text-muted-foreground inline-flex items-center gap-1">
              · tuned
              {roll.tuned.map((t) => (
                <Glyph key={t} stat={t} icons={icons} />
              ))}
            </span>
          )}
        </span>
      ))}
    </span>
  );
}

function FarmLine({
  farm,
  icons,
  exoticIcon,
}: {
  farm: FarmPiece;
  icons: StatIconMap;
  exoticIcon?: string;
}) {
  const slot = SLOT_LABELS[ARMOR_SLOTS[farm.slot]];
  const title = farm.exotic
    ? `${farm.exoticName ?? `Any exotic ${slot.toLowerCase()}`} · ${farm.archetype}`
    : `${farm.archetype} ${slot.toLowerCase()}`;
  const odds = farmOdds(farm);
  return (
    <div className="flex items-start gap-3">
      {farm.exotic && exoticIcon ? (
        <ArmorThumb icon={exoticIcon} alt={farm.exoticName} size={48} gearTier={5} />
      ) : (
        <span className="d2-brackets text-muted-foreground flex size-12 shrink-0 items-center justify-center bg-black/25 text-[10px] font-medium tracking-wider uppercase">
          {slot === "Class Item" ? "Class" : slot}
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1 text-xs">
        <div className="flex items-baseline justify-between gap-3">
          <span className="truncate text-sm font-medium">{title}</span>
          <span
            className="text-muted-foreground shrink-0 tabular-nums"
            title={`${odds} of the ${ROLLS_PER_ARCHETYPE} possible ${farm.archetype} rolls (tertiary × tuned stat) work`}
          >
            {odds}/{ROLLS_PER_ARCHETYPE} rolls
          </span>
        </div>
        <span className="text-muted-foreground inline-flex items-center gap-1">
          <Glyph stat={farm.primary} icons={icons} />
          {STAT_LABELS[STAT_ORDER[farm.primary]]} 30 ·
          <Glyph stat={farm.secondary} icons={icons} />
          {STAT_LABELS[STAT_ORDER[farm.secondary]]} 25
        </span>
        <FarmRolls farm={farm} icons={icons} />
      </div>
    </div>
  );
}

function PieceThumb({ piece, size }: { piece?: ArmorPiece; size: 32 | 40 }) {
  if (!piece?.icon) {
    return (
      <span
        className={cn("d2-brackets shrink-0 bg-black/25", size === 32 ? "size-8" : "size-10")}
        aria-hidden
      />
    );
  }
  return (
    <ArmorThumb
      icon={piece.icon}
      watermark={piece.watermark}
      alt={piece.name}
      size={size}
      masterworked={isFullyMasterworked(piece)}
      gearTier={armorPipTier(piece)}
    />
  );
}

/** A stat total with its change from the build as it is. */
function StatWithDelta({ value, delta }: { value: number; delta: number }) {
  return (
    <span className="tabular-nums">
      {value}
      {delta !== 0 && (
        <span className={cn("ml-0.5 text-xs", delta > 0 ? "text-positive" : "text-destructive")}>
          {delta > 0 ? `+${delta}` : delta}
        </span>
      )}
    </span>
  );
}

/** The tuning a build puts on a piece: "tuned +5 Weapons", "Balanced tuning", or none. */
function TuningText({ tune, icons }: { tune: AppliedTuning | null; icons: StatIconMap }) {
  if (!tune) return <span>no tuning mod</span>;
  if (tune.kind === "balanced") return <span>Balanced tuning</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      tuned +5
      <Glyph stat={tune.plus} icons={icons} />
      {STAT_LABELS[STAT_ORDER[tune.plus]]}
    </span>
  );
}

/** One labelled part of a roll line: "Tertiary [icon] Class". */
function RollPart({ label, stat, icons }: { label: string; stat: number; icons: StatIconMap }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span className="text-muted-foreground">{label}</span>
      <Glyph stat={stat} icons={icons} />
      {STAT_LABELS[STAT_ORDER[stat]]}
    </span>
  );
}

/**
 * A piece's roll on one line: archetype · tertiary · tuned stat. An exotic's tuning is
 * flexible, so for it the stat the build tunes (+5) is shown; Tier 1–4 pieces have no
 * tuning socket, so no tuned part. Legacy pieces have no archetype roll: just the slot.
 */
function PieceRoll({
  piece,
  slot,
  applied,
  icons,
}: {
  piece: ArmorPiece;
  slot: number;
  /** The tuning the build applies to this piece. */
  applied: AppliedTuning | null;
  icons: StatIconMap;
}) {
  if (piece.archetype === undefined) {
    return (
      <span className="text-muted-foreground text-xs">{SLOT_LABELS[ARMOR_SLOTS[slot]]}</span>
    );
  }
  const tertiary = tertiaryStatIndex(piece.baseStats);
  let tuned: number | "balanced" | null = null;
  if (piece.tunedStat !== undefined) {
    if (!piece.isExotic) tuned = piece.tunedStat;
    else if (applied?.kind === "directional") tuned = applied.plus;
    else if (applied?.kind === "balanced") tuned = "balanced";
  }
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
      <span>{piece.archetype}</span>
      <span className="text-muted-foreground" aria-hidden>·</span>
      <RollPart label="Tertiary" stat={tertiary} icons={icons} />
      {tuned !== null && (
        <>
          <span className="text-muted-foreground" aria-hidden>·</span>
          {tuned === "balanced" ? (
            <span className="whitespace-nowrap">
              <span className="text-muted-foreground">Tuned</span> Balanced
            </span>
          ) : (
            <RollPart label="Tuned" stat={tuned} icons={icons} />
          )}
        </>
      )}
    </span>
  );
}

/** One piece as it is: icon, name, then its roll (archetype · tertiary · tuned). */
function PieceCell({
  piece,
  slot,
  applied,
  icons,
}: {
  piece?: ArmorPiece;
  slot: number;
  applied: AppliedTuning | null;
  icons: StatIconMap;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <PieceThumb piece={piece} size={40} />
      <div className="flex min-w-0 flex-col gap-1">
        <span className="truncate text-sm">{piece?.name ?? "Unknown piece"}</span>
        {piece && <PieceRoll piece={piece} slot={slot} applied={applied} icons={icons} />}
      </div>
    </div>
  );
}

/** Short label for an option switcher button: "Helmet → Skirmisher". */
function optionLabel(option: DreamOption): string {
  return option.farm
    .map((f) => `${SLOT_LABELS[ARMOR_SLOTS[f.slot]]} → ${f.exotic ? (f.exoticName ?? "Exotic") : f.archetype}`)
    .join(", ");
}

type RowVerdict =
  | { kind: "keep" }
  | { kind: "replace"; farm: FarmPiece; tune: AppliedTuning | null }
  | { kind: "pending" }
  | { kind: "none" };

/**
 * The dream build as a side-by-side: each slot's current piece on the left and, on the
 * right, "Keep" or the roll to farm in its place — for the option picked above the
 * table (several ways to get there are usually found; the best is shown first). A status
 * line with a sweeping bar shows while a search runs; a stale result stays up, dimmed.
 */
export function DreamComparison({
  build,
  state,
  pieceMap,
  statIcons,
  exoticIcon,
  idleNote,
}: {
  build: OptimizerLoadout;
  state: DreamBuildState;
  pieceMap: Map<string, ArmorPiece>;
  statIcons: StatIconMap;
  /** Icon of the build's exotic, for its re-roll suggestions. */
  exoticIcon?: string;
  /** What to say while the build still reaches the targets — the next step to take. */
  idleNote?: string;
}) {
  const { running, result } = state;
  // The picked option belongs to the result it was picked from; a new result starts at
  // its best option.
  const [picked, setPicked] = useState<{ result: DreamResult | null; index: number }>({
    result: null,
    index: 0,
  });
  const options = result?.options ?? [];
  const index = picked.result === result && picked.index < options.length ? picked.index : 0;
  const option: DreamOption | undefined = options[index];

  const verdict = (slot: number): RowVerdict => {
    if (!result) return running ? { kind: "pending" } : { kind: "none" };
    if (result.newPieces === null) return { kind: "none" };
    const farm = option?.farm.find((f) => f.slot === slot);
    return farm
      ? { kind: "replace", farm, tune: option!.loadout.tuning[slot] }
      : { kind: "keep" };
  };

  let note: string | null = null;
  if (!result || result.newPieces === 0) {
    note =
      idleNote ??
      (result
        ? "This build already reaches these targets. Push a stat past its max (or lower others to make room) to see what to replace."
        : null);
  } else if (result?.newPieces === null) {
    note = result.capped
      ? "The search ran out of time before finding a way there. Try lowering a stat."
      : "Out of reach: not even replacing every piece with new Tier 5 armor hits these targets with your mods and fragments. Try lowering a stat.";
  } else if (result && result.newPieces > 0) {
    note =
      (options.length > 1
        ? `${options.length} ways to get there — each replaces ${pieces(result.newPieces)}.`
        : `Replace ${pieces(result.newPieces)} to get there.`) +
      (result.capped ? " (The search ran out of time, so there may be more.)" : "");
  }

  const shown = option?.loadout;
  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex min-h-5 items-center justify-between gap-3">
          <span className="text-muted-foreground text-sm">{note}</span>
          <span
            className="text-muted-foreground shrink-0 text-xs tabular-nums"
            aria-live="polite"
          >
            {statusLabel(state)}
          </span>
        </div>
        <WorkingBar running={running} />
      </div>

      {options.length > 1 && (
        <div
          className={cn("flex flex-wrap gap-2", running && "pointer-events-none opacity-50")}
          role="group"
          aria-label="Ways to get there"
        >
          {options.map((o, i) => (
            <Button
              key={o.loadout.pieceIds.join("|")}
              variant="outline"
              size="sm"
              aria-pressed={i === index}
              onClick={() => setPicked({ result, index: i })}
              className="aria-pressed:bg-foreground/10 aria-pressed:[--line-alpha:1.8]"
            >
              <span className="text-muted-foreground tabular-nums">{i + 1}</span>
              {optionLabel(o)}
            </Button>
          ))}
        </div>
      )}

      <div
        className={cn(
          "grid grid-cols-[minmax(0,1fr)_1.25rem_minmax(0,1.4fr)] items-center gap-x-3 gap-y-3 transition-opacity",
          running && result && "pointer-events-none opacity-50",
        )}
      >
        <span className="d2-label">Current</span>
        <span aria-hidden />
        <span className="d2-label">Should be</span>
        {build.pieceIds.map((id, slot) => {
          const piece = pieceMap.get(id);
          const v = verdict(slot);
          return (
            <Fragment key={slot}>
              <PieceCell
                piece={piece}
                slot={slot}
                applied={build.tuning[slot]}
                icons={statIcons}
              />
              <span className="text-muted-foreground flex justify-center" aria-hidden>
                {v.kind === "replace" && <ArrowRight className="text-foreground size-4" />}
              </span>
              {v.kind === "keep" && (
                <div className="flex items-center gap-3">
                  <span className="opacity-40">
                    <PieceThumb piece={piece} size={40} />
                  </span>
                  <span className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                    Keep
                  </span>
                </div>
              )}
              {v.kind === "replace" && (
                <div className="border-positive/40 bg-positive/8 flex flex-col gap-2 border p-2">
                  <span className="text-positive text-xs font-medium tracking-wider uppercase">
                    Replace
                  </span>
                  <FarmLine farm={v.farm} icons={statIcons} exoticIcon={exoticIcon} />
                  <span className="border-foreground/8 flex flex-wrap items-center gap-1 border-t pt-2 text-xs">
                    Socket:
                    <TuningText tune={v.tune} icons={statIcons} />
                  </span>
                </div>
              )}
              {v.kind === "pending" && (
                <span className="bg-foreground/10 h-10 w-full animate-pulse" aria-hidden />
              )}
              {v.kind === "none" && <span className="text-muted-foreground text-xs">—</span>}
            </Fragment>
          );
        })}
      </div>

      {shown && (
        <div
          className={cn(
            "border-foreground/8 flex flex-wrap items-center gap-x-5 gap-y-1 border-t pt-3 text-sm font-medium",
            running && "opacity-50",
          )}
        >
          <span className="d2-label mr-1">Result</span>
          <StatWithDelta value={shown.total} delta={shown.total - build.total} />
          {STAT_DISPLAY_ORDER.map((key) => {
            const i = STAT_ORDER.indexOf(key);
            return (
              <span key={key} className="flex items-center gap-1">
                <StatGlyph src={statIcons[key]} label={STAT_LABELS[key]} className="size-4" plain />
                <StatWithDelta value={shown.stats[i]} delta={shown.stats[i] - build.stats[i]} />
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
