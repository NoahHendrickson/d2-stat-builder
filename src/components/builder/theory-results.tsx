"use client";

import { Fragment, memo, useMemo, type ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { BUILD_LIST_WELL_CLASS, MAX_SHOWN } from "@/components/builder/build-results";
import {
  CardStats,
  Glyph,
  HeaderRule,
  ModList,
  MutedCell,
  RollCard,
  RollIdentity,
  RollThumb,
  StatName,
  TuningName,
} from "@/components/builder/roll-card";
import type { ArmorPiece } from "@/lib/armory/normalize";
import type { ArmorSetInfo } from "@/lib/armory/sets";
import {
  ARMOR_SLOTS,
  SLOT_LABELS,
  STAT_DISPLAY_ORDER,
  STAT_LABELS,
  STAT_ORDER,
  type StatIconMap,
} from "@/lib/armory/stats";
import { sortTheoryRecipes, type TheorySortState } from "@/lib/builder/sort-theory";
import { summarizeTheory } from "@/lib/builder/theory-summary";
import type { TheoryPiece, TheoryRecipe } from "@/lib/optimizer/theory";
import type { TheoryBuildState } from "@/lib/optimizer/use-theory-build";
import { useEntrance } from "@/lib/use-entrance";
import { cn } from "@/lib/utils";

/** What the cards show for the build's exotic when it isn't owned. */
export interface TheoryExoticDisplay {
  name: string;
  icon?: string;
  watermark?: string;
  /** False when no Tier 5 copy is owned to read its stat bonus from. */
  bonusKnown: boolean;
}

/**
 * One piece (one slot): archetype, with the owned item or the exotic, the slot and the
 * required set it's from beneath; then tertiary and tuned stat.
 */
function PieceLine({
  piece,
  owned,
  exotic,
  setName,
  plain,
  icons,
}: {
  piece: TheoryPiece;
  owned?: ArmorPiece;
  exotic: TheoryExoticDisplay | null;
  setName?: string;
  /** Just the roll: no detail line (no exotic or set picked, nothing owned seated). */
  plain: boolean;
  icons: StatIconMap;
}) {
  const exoticName = piece.exotic && !piece.owned ? exotic?.name : undefined;
  return (
    <>
      <RollIdentity
        thumb={
          <RollThumb
            owned={owned}
            exotic={piece.exotic && exotic ? exotic : undefined}
            primary={piece.primary}
            icons={icons}
          />
        }
        archetype={{ name: piece.archetype, primary: piece.primary, secondary: piece.secondary }}
        icons={icons}
      >
        {!plain && (
          <>
            {piece.owned && <span className="text-positive truncate">{owned?.name ?? "Owned"}</span>}
            {exoticName && <span className="text-exotic truncate">{exoticName}</span>}
            <span className="text-muted-foreground shrink-0">{SLOT_LABELS[ARMOR_SLOTS[piece.slot]]}</span>
            {setName && <span className="text-muted-foreground truncate">{setName}</span>}
          </>
        )}
      </RollIdentity>
      <StatName stat={piece.tertiary} icons={icons} />
      {piece.tuning ? (
        <TuningName
          plus={piece.tuning.plus}
          minus={piece.tuning.minus}
          icons={icons}
          title={piece.exotic ? "An exotic's tuning is flexible: socket this +5 / −5" : undefined}
        />
      ) : (
        <MutedCell title="Any tuned stat works">Any</MutedCell>
      )}
    </>
  );
}

/** "A", "A or B", "A, B or C". */
function orList(items: ReactNode[]): ReactNode {
  return items.map((item, i) => (
    <Fragment key={i}>
      {i > 0 && (i === items.length - 1 ? " or " : ", ")}
      {item}
    </Fragment>
  ));
}

/** A stat named inline in a sentence: glyph and name. */
function InlineStat({ stat, icons }: { stat: number; icons: StatIconMap }) {
  return (
    <span className="text-foreground inline-flex items-baseline gap-1 font-medium whitespace-nowrap">
      <Glyph stat={stat} icons={icons} className="self-center" />
      {STAT_LABELS[STAT_ORDER[stat]]}
    </span>
  );
}

/**
 * The gist of the list above the cards: the archetypes, tertiary and tuning most of its
 * pieces to farm have ("Farm for Gunner or Powerhouse pieces with a Melee tertiary").
 * Drawn from the exact builds, or the close ones when none make it.
 */
function TheorySummaryCard({
  recipes,
  closeOnly,
  setMap,
  icons,
}: {
  recipes: TheoryRecipe[];
  closeOnly: boolean;
  setMap: Map<number, ArmorSetInfo>;
  icons: StatIconMap;
}) {
  const summary = useMemo(() => summarizeTheory(recipes), [recipes]);
  if (!summary) return null;
  const sets = summary.setHashes.flatMap((h) => setMap.get(h)?.name ?? []);
  // "40% are Gunner, 40% Powerhouse and 20% Specialist".
  const shares = summary.archetypes.map(
    (a, i) => `${Math.round(a.share * 100)}%${i === 0 ? " are" : ""} ${a.name}`,
  );
  const shareText =
    shares.length > 1 ? `${shares.slice(0, -1).join(", ")} and ${shares[shares.length - 1]}` : shares[0];
  const where =
    summary.builds === 1
      ? `the ${closeOnly ? "close " : ""}build below`
      : `the ${summary.builds} ${closeOnly ? "close " : ""}builds below`;
  return (
    // The set-badge blue (build cards' 2pc pills), framed like the alert above it.
    <div className="flex flex-col gap-1.5 rounded-md border border-[#41a6ff]/60 bg-[#41a6ff]/12 p-3">
      <h3 className="d2-label text-[#1f7ad1] dark:text-[#7cc2ff]">What to farm</h3>
      <p className="text-muted-foreground text-sm leading-relaxed">
        {closeOnly ? "The closest builds farm for " : "Farm for "}
        {orList(
          summary.archetypes.map((a) => (
            <span key={a.name} className="text-foreground font-medium">
              {a.name}
            </span>
          )),
        )}{" "}
        pieces
        {summary.tertiaries.length ? (
          <>
            {" "}with a {orList(summary.tertiaries.map((t) => <InlineStat key={t.stat} stat={t.stat} icons={icons} />))} tertiary
          </>
        ) : (
          " with any tertiary"
        )}
        {summary.tuned && (
          <>
            , tuned to {orList(summary.tuned.map((t) => <InlineStat key={t.stat} stat={t.stat} icons={icons} />))}
          </>
        )}
        {sets.length > 0 && (
          <>
            {" "}from <span className="text-foreground font-medium">{sets.join(" and ")}</span>
          </>
        )}
        .
      </p>
      <p className="text-muted-foreground text-xs">
        Of the pieces to farm in {where}, {shareText}.
      </p>
    </div>
  );
}

/** What a close build misses: "Short of Melee by 5". */
function ShortList({ short, icons }: { short: number[]; icons: StatIconMap }) {
  const missed = STAT_DISPLAY_ORDER.map((key) => STAT_ORDER.indexOf(key)).filter((s) => short[s] > 0);
  return (
    <span className="text-warning inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      <span>Short of</span>
      {missed.map((s) => (
        <span key={s} className="inline-flex items-center gap-1 tabular-nums">
          <Glyph stat={s} icons={icons} />
          {STAT_LABELS[STAT_ORDER[s]]} by {short[s]}
        </span>
      ))}
    </span>
  );
}

const TheoryRow = memo(function TheoryRow({
  recipe,
  exotic,
  setMap,
  pieceMap,
  statIcons,
}: {
  recipe: TheoryRecipe;
  exotic: TheoryExoticDisplay | null;
  setMap: Map<number, ArmorSetInfo>;
  pieceMap: Map<string, ArmorPiece>;
  statIcons: StatIconMap;
}) {
  const farm = recipe.pieces.length - recipe.owned;
  // No exotic, set or owned piece: the card is just five rolls, in no particular slots.
  const plain = !recipe.pieces.some((p) => p.exotic || p.setHash !== undefined || p.owned);
  const misses = recipe.short ? <ShortList short={recipe.short} icons={statIcons} /> : null;
  return (
    <RollCard
      stats={<CardStats total={recipe.total} stats={recipe.stats} short={recipe.short} icons={statIcons} />}
      meta={
        plain ? misses : (
          <>
            {misses && (
              <>
                {misses}
                <HeaderRule />
              </>
            )}
            {recipe.owned > 0 && (
              <>
                <span className="text-positive inline-flex items-center gap-1">
                  <HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-3.5 shrink-0" aria-hidden />
                  {recipe.owned} owned
                </span>
                <HeaderRule />
              </>
            )}
            <span className="text-muted-foreground">
              {farm === 0
                ? "Nothing to farm"
                : farm === recipe.pieces.length
                  ? `Farm all ${farm}`
                  : `Farm ${farm}: ${recipe.openSlots.map((s) => SLOT_LABELS[ARMOR_SLOTS[s]]).join(", ")}`}
            </span>
          </>
        )
      }
      footer={<ModList mods={recipe.mods} icons={statIcons} />}
    >
      {recipe.pieces.map((piece) => (
        <PieceLine
          key={piece.slot}
          piece={piece}
          owned={piece.owned ? pieceMap.get(piece.owned.instanceId) : undefined}
          exotic={exotic}
          setName={piece.setHash !== undefined ? setMap.get(piece.setHash)?.name : undefined}
          plain={plain}
          icons={statIcons}
        />
      ))}
    </RollCard>
  );
});

export function TheoryResults({
  state,
  exotic,
  setMap,
  pieceMap,
  statIcons,
  sort,
}: {
  state: TheoryBuildState;
  exotic: TheoryExoticDisplay | null;
  setMap: Map<number, ArmorSetInfo>;
  pieceMap: Map<string, ArmorPiece>;
  statIcons: StatIconMap;
  sort: TheorySortState;
}) {
  const recipes = state.result?.recipes;
  const sorted = useMemo(
    () => (recipes ? sortTheoryRecipes(recipes, sort).slice(0, MAX_SHOWN) : []),
    [recipes, sort],
  );
  const close = state.result?.close ?? [];
  // New results cascade in; a re-sort only reorders (see useEntrance).
  const entering = useEntrance(recipes);
  const row = (recipe: TheoryRecipe) => (
    <TheoryRow
      key={recipe.key}
      recipe={recipe}
      exotic={exotic}
      setMap={setMap}
      pieceMap={pieceMap}
      statIcons={statIcons}
    />
  );
  // Builds that just miss, listed under the ones that make it (or in their place).
  const closeSection = close.length > 0 && (
    <div className="space-y-3 pt-2">
      <div className="space-y-1">
        <h3 className="d2-label">Close builds</h3>
        <p className="text-muted-foreground text-xs">
          These miss your targets by a few points. Ease the stat they&apos;re short of to make
          them work.
        </p>
      </div>
      <div className={BUILD_LIST_WELL_CLASS}>{close.map(row)}</div>
    </div>
  );

  if (state.failed) {
    return (
      <p className="text-muted-foreground text-sm">
        Theoretical Builds hit an error. Change a target to try again.
      </p>
    );
  }
  if (!state.result) {
    return state.running ? null : (
      <p className="text-muted-foreground text-sm">
        Set stat targets, major mods and fragments to see which Tier 5 rolls reach them.
      </p>
    );
  }
  if (state.result.setsDontFit) {
    return (
      <p className="text-muted-foreground text-sm">
        Those set bonuses need more pieces than a build has{exotic ? " (the exotic takes a slot)" : ""}.
        Drop one to see builds.
      </p>
    );
  }
  if (sorted.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-muted-foreground text-sm">
          No five Tier 5 pieces reach these targets, even with perfect rolls. Ease a target
          or add major mods.
        </p>
        <TheorySummaryCard recipes={close} closeOnly setMap={setMap} icons={statIcons} />
        {closeSection}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {exotic && !exotic.bonusKnown && (
        <p className="text-muted-foreground text-xs">
          {`You don't own a Tier 5 ${exotic.name}, so its exotic stat bonus isn't counted.`}
        </p>
      )}
      <TheorySummaryCard recipes={recipes!} closeOnly={false} setMap={setMap} icons={statIcons} />
      <div className={cn(BUILD_LIST_WELL_CLASS, entering && "d2-stagger")}>
        {sorted.map(row)}
      </div>
      {closeSection}
    </div>
  );
}
