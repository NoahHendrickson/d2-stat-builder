"use client";

import { Fragment, type ReactNode } from "react";
import {
  CardStats,
  Glyph,
  ModList,
  MutedCell,
  RollCard,
  RollIdentity,
  RollThumb,
  StatName,
  TuningName,
} from "@/components/builder/roll-card";
import type { ArmorPiece } from "@/lib/armory/normalize";
import {
  ARMOR_SLOTS,
  SLOT_LABELS,
  STAT_LABELS,
  STAT_ORDER,
  tertiaryStatIndex,
  type StatIconMap,
} from "@/lib/armory/stats";
import {
  farmOdds,
  type DreamOption,
  type FarmPiece,
  type FarmRoll,
} from "@/lib/optimizer/dream";
import type { DreamBuildState } from "@/lib/optimizer/use-dream-build";
import type { AppliedTuning, OptimizerLoadout } from "@/lib/optimizer/types";
import { cn } from "@/lib/utils";

function pieces(n: number): string {
  return `${n} new piece${n === 1 ? "" : "s"}`;
}

/** What the running search is doing, from the phase the worker last reported. */
function workingLabel(phase: number | null): string {
  if (phase === null || phase === 0) return "Checking this build…";
  return `Trying ${pieces(phase)}…`;
}

function statusLabel({ running, phase, result, failed }: DreamBuildState): string {
  if (running) return workingLabel(phase);
  if (failed) return "Search failed";
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
        <div className="bg-foreground absolute inset-y-0 left-0 w-2/5 animate-[dream-sweep_1.1s_ease-in-out_infinite] motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-40" />
      )}
    </div>
  );
}

/**
 * A build's stat mods per stat as [majors, minors], from the points each stat got and
 * how many of each size were used: majors go to stats with 10+ points first, which
 * always accounts for every mod (a major is 10 points on one stat).
 */
function modCounts(loadout: OptimizerLoadout): [number, number][] {
  let majors = loadout.modsUsed.major;
  return loadout.modBonus.map((points) => {
    const major = Math.min(Math.floor(points / 10), majors);
    majors -= major;
    return [major, (points - 10 * major) / 5];
  });
}

/** An Armor 3.0 piece's archetype with its two stats (the top two of its base roll). */
function archetypeOf(piece: ArmorPiece): { name: string; primary: number; secondary: number } | undefined {
  if (!piece.archetype) return undefined;
  const order = piece.baseStats.map((_, i) => i).sort((a, b) => piece.baseStats[b] - piece.baseStats[a]);
  return { name: piece.archetype, primary: order[0], secondary: order[1] };
}

/**
 * The Tuned cell for a tuning the build sockets on a piece it keeps: the tuned stat only,
 * never the −5 (the user found a −5 on a kept piece confusing).
 */
function SocketedTuning({
  tune,
  artifice,
  icons,
}: {
  tune: AppliedTuning | null;
  artifice: number | null;
  icons: StatIconMap;
}) {
  if (tune?.kind === "directional") return <TuningName plus={tune.plus} icons={icons} />;
  if (tune?.kind === "balanced") return <span className="text-sm">Balanced</span>;
  if (artifice !== null) {
    return (
      <span className="inline-flex items-center gap-1 text-sm" title={`Artifice +3 ${STAT_LABELS[STAT_ORDER[artifice]]}`}>
        +3
        <Glyph stat={artifice} icons={icons} />
      </span>
    );
  }
  return <MutedCell>None</MutedCell>;
}

/**
 * The Tuned cell for one roll to farm: which tuned stats a drop can have. When the build
 * sockets a directional tune there, it's shown on the stat it uses, like a theoretical
 * build; other tuned stats that also work follow.
 */
function FarmTuning({
  farm,
  roll,
  tune,
  icons,
}: {
  farm: FarmPiece;
  roll: FarmRoll;
  tune: AppliedTuning | null;
  icons: StatIconMap;
}) {
  const directional = tune?.kind === "directional" ? tune : null;
  // An exotic's tuning is flexible: any +5 goes, so only the one socketed matters.
  if (farm.exotic) {
    return directional ? (
      <TuningName
        plus={directional.plus}
        minus={directional.minus}
        icons={icons}
        title="An exotic's tuning is flexible: socket this +5 / −5"
      />
    ) : (
      <MutedCell title="Any tuned stat works">Any</MutedCell>
    );
  }
  if (roll.tuned === null) {
    return (
      <MutedCell title="Any tuned stat works">
        Any{tune?.kind === "balanced" && ", Balanced"}
      </MutedCell>
    );
  }
  const shown = directional && roll.tuned.includes(directional.plus) ? directional : null;
  const others = roll.tuned.filter((t) => t !== shown?.plus);
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      {shown && <TuningName plus={shown.plus} minus={shown.minus} icons={icons} />}
      {others.length > 0 && (
        <span className="text-muted-foreground inline-flex items-center gap-1 text-sm">
          {shown ? "or" : null}
          {others.map((t) =>
            shown || others.length > 1 ? (
              <Glyph key={t} stat={t} icons={icons} />
            ) : (
              <StatName key={t} stat={t} icons={icons} />
            ),
          )}
        </span>
      )}
    </span>
  );
}

/** One slot the option replaces: the archetype to farm, then each tertiary that works. */
function FarmRows({
  farm,
  tune,
  icons,
  exotic,
  setName,
}: {
  farm: FarmPiece;
  tune: AppliedTuning | null;
  icons: StatIconMap;
  exotic?: { icon?: string; name: string };
  setName?: string;
}) {
  const odds = farmOdds(farm);
  // A truncated roll list is a lower bound: say so on the piece.
  const atLeast = farm.complete ? "" : "≥ ";
  const anyRoll = odds.n === odds.of;
  return (
    <>
      <RollIdentity
        thumb={
          <RollThumb
            exotic={farm.exotic && exotic ? exotic : undefined}
            primary={farm.primary}
            icons={icons}
          />
        }
        archetype={{ name: farm.archetype, primary: farm.primary, secondary: farm.secondary }}
        icons={icons}
        rows={anyRoll ? 1 : farm.rolls.length}
      >
        {farm.exotic && <span className="text-exotic truncate">{farm.exoticName ?? exotic?.name}</span>}
        <span className="text-muted-foreground shrink-0">{SLOT_LABELS[ARMOR_SLOTS[farm.slot]]}</span>
        {setName && <span className="text-muted-foreground truncate">{setName}</span>}
        <span
          className="text-muted-foreground shrink-0 tabular-nums"
          title={
            farm.exotic
              ? `${atLeast}${odds.n} of the ${odds.of} possible tertiaries work (an exotic's tuning is flexible)`
              : `${atLeast}${odds.n} of the ${odds.of} possible ${farm.archetype} rolls (tertiary × tuned stat) work`
          }
        >
          {atLeast}
          {odds.n}/{odds.of} rolls
        </span>
      </RollIdentity>
      {anyRoll ? (
        <>
          <MutedCell title="Any tertiary works">Any</MutedCell>
          <FarmTuning farm={farm} roll={{ tertiary: farm.rolls[0].tertiary, tuned: null }} tune={tune} icons={icons} />
        </>
      ) : (
        farm.rolls.map((roll) => (
          <Fragment key={roll.tertiary}>
            <StatName stat={roll.tertiary} icons={icons} />
            <FarmTuning farm={farm} roll={roll} tune={tune} icons={icons} />
          </Fragment>
        ))
      )}
    </>
  );
}

/** One way to reach the targets, as a card: each slot kept or farmed, in slot order. */
function DreamOptionCard({
  build,
  option,
  pieceMap,
  icons,
  exoticIcon,
  setNames,
  dimmed,
}: {
  build: OptimizerLoadout;
  option: DreamOption;
  pieceMap: Map<string, ArmorPiece>;
  icons: StatIconMap;
  exoticIcon?: string;
  setNames: ReadonlyMap<number, string>;
  dimmed: boolean;
}) {
  const { loadout, farm } = option;
  const farmSlots = farm.map((f) => f.slot).sort((a, b) => a - b);
  const exoticName = build.pieceIds.map((id) => pieceMap.get(id)).find((p) => p?.isExotic)?.name;
  // With two or more replacements, only the first lists alternatives (dream.ts FarmPiece).
  const pinnedNote =
    farm.length > 1 && farm[0].rolls.length > 1
      ? `The ${SLOT_LABELS[ARMOR_SLOTS[farm[0].slot]].toLowerCase()} lists every roll that works with the other ${farm.length === 2 ? "replacement" : "replacements"} exactly as shown.`
      : null;

  const rows: ReactNode[] = [];
  for (let slot = 0; slot < ARMOR_SLOTS.length; slot++) {
    const f = farm.find((x) => x.slot === slot);
    if (f) {
      rows.push(
        <FarmRows
          key={slot}
          farm={f}
          tune={loadout.tuning[slot]}
          icons={icons}
          exotic={exoticIcon ? { icon: exoticIcon, name: exoticName ?? "Exotic" } : undefined}
          setName={f.setHash !== undefined ? setNames.get(f.setHash) : undefined}
        />,
      );
      continue;
    }
    const piece = pieceMap.get(loadout.pieceIds[slot]);
    rows.push(
      <Fragment key={slot}>
        <RollIdentity
          thumb={<RollThumb owned={piece} icons={icons} />}
          archetype={piece ? archetypeOf(piece) : undefined}
          name={piece?.name ?? "Unknown piece"}
          icons={icons}
        >
          {piece?.archetype && <span className="text-positive truncate">{piece.name}</span>}
          <span className="text-muted-foreground shrink-0">{SLOT_LABELS[ARMOR_SLOTS[slot]]}</span>
        </RollIdentity>
        {piece?.archetype ? (
          <StatName stat={tertiaryStatIndex(piece.baseStats)} icons={icons} />
        ) : (
          <MutedCell>—</MutedCell>
        )}
        <SocketedTuning tune={loadout.tuning[slot]} artifice={loadout.artifice[slot]} icons={icons} />
      </Fragment>,
    );
  }

  return (
    <RollCard
      dimmed={dimmed}
      stats={<CardStats total={loadout.total} stats={loadout.stats} was={build} icons={icons} />}
      meta={
        <span className="text-muted-foreground">
          {farm.length === 0
            ? "Nothing to replace"
            : `Replace ${farm.length}: ${farmSlots.map((s) => SLOT_LABELS[ARMOR_SLOTS[s]]).join(", ")}`}
        </span>
      }
      footer={
        <>
          <ModList mods={modCounts(loadout)} icons={icons} />
          {pinnedNote && <span className="text-muted-foreground text-xs">{pinnedNote}</span>}
        </>
      }
    >
      {rows}
    </RollCard>
  );
}

/**
 * The dream build's ways to reach the targets, one card each (the easiest drop first):
 * every slot in order, kept as it is or with the roll to farm. A status line with a
 * sweeping bar shows while a search runs; a stale result stays up, dimmed.
 */
export function DreamComparison({
  build,
  state,
  pieceMap,
  statIcons,
  exoticIcon,
  setNames,
}: {
  build: OptimizerLoadout;
  state: DreamBuildState;
  pieceMap: Map<string, ArmorPiece>;
  statIcons: StatIconMap;
  /** Set names by hash, for replacements that must come from a required set. */
  setNames: ReadonlyMap<number, string>;
  /** Icon of the build's exotic, for its re-roll suggestions. */
  exoticIcon?: string;
}) {
  const { running, result } = state;
  const options = result && result.newPieces !== null ? result.options : [];

  let note: string | null = null;
  if (state.failed && !running) {
    note = "The search hit an error. Change a stat to try again.";
  } else if (!result || result.newPieces === 0) {
    note = result
      ? "This build already reaches these targets. Raise the stats you want (lowering the ones you don't need makes room) to see what to replace."
      : null;
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

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="flex flex-col gap-2">
        {/* Phones: the status goes above the note, so the note keeps the full width. */}
        <div className="flex min-h-5 items-center justify-between gap-3 max-md:flex-col-reverse max-md:items-start max-md:gap-1">
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

      {!result && running && (
        <span className="bg-foreground/10 h-40 w-full animate-pulse motion-reduce:animate-none" aria-hidden />
      )}
      <div className={cn("flex flex-col gap-3", running && "pointer-events-none")}>
        {options.map((option) => (
          <DreamOptionCard
            key={option.loadout.pieceIds.join("|")}
            build={build}
            option={option}
            pieceMap={pieceMap}
            icons={statIcons}
            exoticIcon={exoticIcon}
            setNames={setNames}
            dimmed={running}
          />
        ))}
      </div>
    </div>
  );
}
