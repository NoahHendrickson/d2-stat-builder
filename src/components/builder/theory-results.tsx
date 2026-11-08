"use client";

import { Fragment, memo, useMemo } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import {
  BUILD_LIST_WELL_CLASS,
  HeaderRule,
  StatsHeader,
} from "@/components/builder/build-results";
import {
  Glyph,
  ModList,
  MutedCell,
  RollCard,
  RollIdentity,
  RollThumb,
  StatName,
  TuningName,
} from "@/components/builder/roll-card";
import type { TheoryExoticDisplay } from "@/components/builder/use-theory-builds";
import { DetailCard, DetailSection } from "@/components/weapons/weapon-detail-card";
import type { ArmorPiece } from "@/lib/armory/normalize";
import type { ArmorSetInfo, SetSlotIcon } from "@/lib/armory/sets";
import {
  ARMOR_SLOTS,
  SLOT_LABELS,
  STAT_DISPLAY_ORDER,
  STAT_LABELS,
  STAT_ORDER,
  type ArmorSlot,
  type StatIconMap,
} from "@/lib/armory/stats";
import { sortTheoryRecipes, type TheorySortState } from "@/lib/builder/sort-theory";
import { summarizeTheory } from "@/lib/builder/theory-summary";
import type { TheoryPiece, TheoryRecipe } from "@/lib/optimizer/theory";
import type { TheoryBuildState } from "@/lib/optimizer/use-theory-build";
import { useEntrance } from "@/lib/use-entrance";
import { cn } from "@/lib/utils";

const NO_RECIPES: TheoryRecipe[] = [];

type TheorySlotIcons = (setHash: number) => Partial<Record<ArmorSlot, SetSlotIcon>>;

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
            item={piece.exotic && exotic ? exotic : undefined}
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

/** The stats in one cell of the summary card, or "Any" when none is common enough to name. */
function StatCell({ stats, icons }: { stats: number[] | null; icons: StatIconMap }) {
  if (!stats?.length) return <MutedCell>Any</MutedCell>;
  return (
    // Stacks in a narrow card, where two names side by side would crowd out the archetype.
    <div className="flex gap-x-3 gap-y-1 @max-md:flex-col">
      {stats.map((stat) => (
        <StatName key={stat} stat={stat} icons={icons} />
      ))}
    </div>
  );
}

/** A slot to farm: the set's own item when it comes from one (Bungie has no art for a slot alone). */
function SlotPieceThumb({
  slot,
  setHash,
  primary,
  getSlotIcons,
  icons,
}: {
  slot: ArmorSlot;
  setHash?: number;
  primary: number;
  getSlotIcons: TheorySlotIcons;
  icons: StatIconMap;
}) {
  const look = setHash !== undefined ? getSlotIcons(setHash)[slot] : undefined;
  return (
    <RollThumb
      item={look && { ...look, name: SLOT_LABELS[slot] }}
      primary={primary}
      icons={icons}
    />
  );
}

/**
 * The gist of the list above the cards: the archetypes most of its pieces to farm are,
 * each with its own tertiary and tuning (and slots, when owned pieces leave particular
 * ones open), in the build cards' columns. Drawn from the exact builds, or the close ones
 * when none make it.
 */
function TheorySummaryCard({
  recipes,
  closeOnly,
  setMap,
  getSlotIcons,
  icons,
}: {
  recipes: TheoryRecipe[];
  closeOnly: boolean;
  setMap: Map<number, ArmorSetInfo>;
  getSlotIcons: TheorySlotIcons;
  icons: StatIconMap;
}) {
  const summary = useMemo(() => summarizeTheory(recipes), [recipes]);
  if (!summary) return null;
  const sets = summary.setHashes.flatMap((h) => setMap.get(h)?.name ?? []);
  const where =
    summary.builds === 1
      ? `the ${closeOnly ? "close " : ""}build below`
      : `the ${summary.builds} ${closeOnly ? "close " : ""}builds below`;
  return (
    <DetailCard>
      <DetailSection
        title="What to farm"
        description={`Most common among the pieces to farm in ${where}.`}
      >
        <div className="@container">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-6 gap-y-3 max-md:gap-x-3">
            <div className="d2-label">Armor</div>
            <div className="d2-label">Tertiary</div>
            <div className="d2-label">Tuned</div>
            {summary.archetypes.map((a) => (
              <Fragment key={a.name}>
                <RollIdentity
                  thumb={
                    a.slots.length > 0 ? (
                      <div className="flex shrink-0 gap-1 @max-md:flex-col">
                        {a.slots.map(({ slot, setHash }) => (
                          <SlotPieceThumb
                            key={slot}
                            slot={ARMOR_SLOTS[slot]}
                            setHash={setHash}
                            primary={a.primary}
                            getSlotIcons={getSlotIcons}
                            icons={icons}
                          />
                        ))}
                      </div>
                    ) : (
                      <RollThumb primary={a.primary} icons={icons} />
                    )
                  }
                  archetype={a}
                  icons={icons}
                >
                  <span className="text-muted-foreground shrink-0 tabular-nums">
                    {Math.round(a.share * 100)}%
                  </span>
                  {a.slots.length > 0 && (
                    <span className="text-muted-foreground truncate">
                      {a.slots.map(({ slot }) => SLOT_LABELS[ARMOR_SLOTS[slot]]).join(", ")}
                    </span>
                  )}
                </RollIdentity>
                <StatCell stats={a.tertiaries} icons={icons} />
                <StatCell stats={a.tuned} icons={icons} />
              </Fragment>
            ))}
            {sets.length > 0 && (
              <div className="col-span-full flex flex-wrap items-baseline gap-x-4 gap-y-1 pt-1">
                <span className="d2-label">{sets.length === 1 ? "Set" : "Sets"}</span>
                {sets.map((name) => (
                  <span key={name}>{name}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      </DetailSection>
    </DetailCard>
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
          <Glyph stat={s} icons={icons} decorative />
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
      stats={<StatsHeader total={recipe.total} stats={recipe.stats} icons={statIcons} tint short={recipe.short} />}
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
  empty,
  exotic,
  setMap,
  getSlotIcons,
  pieceMap,
  statIcons,
  sort,
}: {
  state: TheoryBuildState;
  /** No target, exotic or set bonus picked yet: prompt for one instead of listing rolls. */
  empty: boolean;
  exotic: TheoryExoticDisplay | null;
  setMap: Map<number, ArmorSetInfo>;
  getSlotIcons: TheorySlotIcons;
  pieceMap: Map<string, ArmorPiece>;
  statIcons: StatIconMap;
  sort: TheorySortState;
}) {
  const recipes = state.result?.recipes ?? NO_RECIPES;
  const close = state.result?.close ?? NO_RECIPES;
  const sorted = useMemo(() => sortTheoryRecipes(recipes, sort), [recipes, sort]);
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

  const prompt = (
    <p className="text-muted-foreground text-sm">
      Set a stat target, an exotic or a set bonus to see which Tier 5 rolls to farm.
    </p>
  );
  if (empty) return prompt;
  if (state.failed) {
    return (
      <p className="text-muted-foreground text-sm">
        Theoretical Builds hit an error. Change a target to try again.
      </p>
    );
  }
  if (!state.result) {
    return state.running ? null : prompt;
  }
  if (state.result.setsDontFit) {
    return (
      <p className="text-muted-foreground text-sm">
        Those set bonuses need more pieces than a build has{exotic ? " (the exotic takes a slot)" : ""}.
        Drop one to see builds.
      </p>
    );
  }
  // A missing exotic bonus can be why nothing (or little) makes it: say so either way.
  const bonusNote = exotic && !exotic.bonusKnown && (
    <p className="text-muted-foreground text-xs">
      {`You don't own a Tier 5 ${exotic.name}, so its exotic stat bonus isn't counted.`}
    </p>
  );
  if (recipes.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-muted-foreground text-sm">
          No five Tier 5 pieces reach these targets, even with perfect rolls. Ease a target
          or add major mods.
        </p>
        {bonusNote}
        <TheorySummaryCard recipes={close} closeOnly setMap={setMap} getSlotIcons={getSlotIcons} icons={statIcons} />
        {closeSection}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {bonusNote}
      <TheorySummaryCard recipes={recipes} closeOnly={false} setMap={setMap} getSlotIcons={getSlotIcons} icons={statIcons} />
      <div className={cn(BUILD_LIST_WELL_CLASS, entering && "d2-stagger")}>
        {sorted.map(row)}
      </div>
      {closeSection}
    </div>
  );
}
