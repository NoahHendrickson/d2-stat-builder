"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  BUILD_CARD_LIFT_CLASS,
  BUILD_LIST_WELL_CLASS,
  BuildResults,
  MAX_SHOWN,
  type GetBuilderState,
} from "@/components/builder/build-results";
import { LoadoutSortControls } from "@/components/builder/loadout-sort-controls";
import { TheoryIntroAlert } from "@/components/builder/theory-intro-alert";
import { TheoryResults, type TheoryExoticDisplay } from "@/components/builder/theory-results";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ArmorPiece } from "@/lib/armory/normalize";
import type { ArmorSetInfo } from "@/lib/armory/sets";
import type { ArmoryCharacter } from "@/lib/armory/fetch";
import type { StatIconMap } from "@/lib/armory/stats";
import {
  DEFAULT_LOADOUT_SORT,
  type LoadoutSortState,
} from "@/lib/builder/sort-loadouts";
import type { StatModHashes } from "@/lib/dim/mod-hashes";
import type { Manifest } from "@/lib/manifest/load";
import type {
  OptimizerLoadout,
  OptimizerOutput,
  RefinementState,
} from "@/lib/optimizer/types";
import {
  DEFAULT_THEORY_SORT,
  THEORY_SORT_OPTIONS,
  type TheorySortState,
} from "@/lib/builder/sort-theory";
import type { TheoryBuildState } from "@/lib/optimizer/use-theory-build";
import { useStoreValue, type ValueStore } from "@/lib/value-store";

const LOADING_ROWS = 5;

export type BuildsViewState =
  | "not-ready"
  | "idle"
  | "searching"
  | "results"
  | "no-matches";

export function getBuildsViewState({
  ready,
  showLoading,
  result,
}: {
  ready: boolean;
  showLoading: boolean;
  result: OptimizerOutput | null;
}): BuildsViewState {
  if (!ready) return "not-ready";
  if (showLoading) return "searching";
  if (!result) return "idle";
  if (result.loadouts.length === 0) return "no-matches";
  return "results";
}

export function getBuildsStatusLabel({
  ready,
  showLoading,
  result,
}: {
  ready: boolean;
  showLoading: boolean;
  result: OptimizerOutput | null;
}): string {
  const state = getBuildsViewState({ ready, showLoading, result });
  switch (state) {
    case "not-ready":
      return "";
    case "idle":
      return "Adjust targets to search";
    case "searching":
      return "Searching…";
    case "no-matches":
      return "No builds match";
    case "results":
      // combosValid is exact until the heap fills; after that the walk skips subtrees it
      // can prove can't enter the list without counting them, so it's a lower bound.
      return `${Math.min(MAX_SHOWN, result!.loadouts.length).toLocaleString()} / ${result!.combosValid.toLocaleString()}${result!.combosValidExact ? "" : "+"}`;
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

/** Builds from owned armor, or the Tier-5 rolls that would reach the targets. */
export type BuildsMode = "actual" | "theoretical";

/** The theoretical list's state and header label (the mobile bar shows the same). */
export function getTheoryStatus(
  ready: boolean,
  theory: TheoryBuildState,
): { state: BuildsViewState; label: string } {
  if (!ready) return { state: "not-ready", label: "" };
  if (theory.running) return { state: "searching", label: "Searching…" };
  const n = theory.result?.recipes.length;
  if (n === undefined) return { state: "idle", label: "" };
  const close = theory.result!.close.length;
  const closeLabel = close ? `${close} close` : "";
  if (n === 0) {
    return close
      ? { state: "results", label: `No exact builds, ${closeLabel}` }
      : { state: "no-matches", label: "No builds reach these" };
  }
  const shown = Math.min(MAX_SHOWN, n);
  const label = `${shown} ${shown === 1 ? "build" : "builds"}`;
  return { state: "results", label: close ? `${label}, ${closeLabel}` : label };
}

export interface BuildsColumnContentProps {
  mode: BuildsMode;
  onModeChange: (mode: BuildsMode) => void;
  theory: TheoryBuildState;
  /** The exotic theoretical builds wear (null = none picked). */
  theoryExotic: TheoryExoticDisplay | null;
  /** Every set the class can wear (theoretical builds can require unowned ones). */
  theorySetMap: Map<number, ArmorSetInfo>;
  ready: boolean;
  /** The gear on screen is last visit's copy; builds wait for the live profile. */
  provisional?: boolean;
  showLoading: boolean;
  running: boolean;
  result: OptimizerOutput | null;
  /** Eased 0–1 progress; only the progress bar subscribes to it. */
  displayedProgress: ValueStore<number>;
  /** Background-refinement lifecycle (idle / running / done, with any pending list). */
  refinement: RefinementState;
  /** Live 0–1 refinement %; only SearchStatus subscribes. */
  refinementProgress: ValueStore<number>;
  /** Apply the waiting better list (the explicit user action that changes the list). */
  onShowPending: () => void;
  onCancel: () => void;
  pieceMap: Map<string, ArmorPiece>;
  setMap: Map<number, ArmorSetInfo>;
  statIcons: StatIconMap;
  balancedTuningIcon?: string;
  characters: ArmoryCharacter[];
  statModHashes: StatModHashes[] | null;
  tuningPlugHashes: Map<string, number> | null;
  artificeModHashes: (number | undefined)[] | null;
  getBuilderState: GetBuilderState;
  manifest?: Manifest;
  insertablePlugs?: ReadonlySet<number>;
  onEquipped: () => void;
  /** Open the Dream build modal on a build. */
  onDream?: (loadout: OptimizerLoadout) => void;
}

export function BuildsColumnContent({
  ready,
  showLoading,
  running,
  result,
  displayedProgress,
  refinement,
  refinementProgress,
  onShowPending,
  onCancel,
  pieceMap,
  setMap,
  statIcons,
  balancedTuningIcon,
  characters,
  statModHashes,
  tuningPlugHashes,
  artificeModHashes,
  getBuilderState,
  manifest,
  insertablePlugs,
  onEquipped,
  onDream,
  provisional = false,
  mode,
  onModeChange,
  theory,
  theoryExotic,
  theorySetMap,
}: BuildsColumnContentProps) {
  const [sort, setSort] = useState<LoadoutSortState>(DEFAULT_LOADOUT_SORT);
  const [theorySort, setTheorySort] = useState<TheorySortState>(DEFAULT_THEORY_SORT);
  const theoretical = mode === "theoretical";
  const theoryStatus = getTheoryStatus(ready, theory);
  const viewState = theoretical
    ? theoryStatus.state
    : getBuildsViewState({ ready, showLoading, result });
  const statusLabel = theoretical
    ? theoryStatus.label
    : getBuildsStatusLabel({ ready, showLoading, result });
  // A theoretical list stays sortable while a newer one is on its way.
  const showSort = theoretical
    ? (theory.result?.recipes.length ?? 0) > 1
    : viewState === "results";

  return (
    <div className="space-y-5">
      <div className="flex min-h-8 flex-wrap items-center gap-3">
        <h2 className="sr-only">Builds</h2>
        <Tabs value={mode} onValueChange={(v) => onModeChange(v as BuildsMode)}>
          <TabsList aria-label="Which builds to show">
            <TabsTrigger value="actual">Builds</TabsTrigger>
            <TabsTrigger value="theoretical">Theoretical Builds</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="ml-auto flex min-w-0 items-center gap-3">
          {/* Initial search only — `running` is false once refinement starts
              (see use-optimizer); refinement Cancel lives in the status alert. */}
          {!theoretical && running && (
            <Button
              variant="link"
              onClick={onCancel}
              className="text-muted-foreground hover:text-foreground h-auto p-0 text-xs font-normal"
            >
              Cancel
            </Button>
          )}
          <span
            className="text-muted-foreground text-sm tabular-nums"
            aria-live="polite"
          >
            {statusLabel}
          </span>
          {showSort &&
            (theoretical ? (
              <LoadoutSortControls
                sort={theorySort}
                onChange={setTheorySort}
                options={THEORY_SORT_OPTIONS}
              />
            ) : (
              <LoadoutSortControls sort={sort} onChange={setSort} />
            ))}
        </div>
      </div>
      {!ready ? (
        <p className="text-muted-foreground text-sm">
          {provisional
            ? "Refreshing your gear from Bungie — builds will appear in a moment."
            : "Sign in and load your gear to generate builds."}
        </p>
      ) : theoretical ? (
        <div className="space-y-3">
          <TheoryIntroAlert />
          <TheoryResults
            state={theory}
            exotic={theoryExotic}
            setMap={theorySetMap}
            pieceMap={pieceMap}
            statIcons={statIcons}
            sort={theorySort}
          />
        </div>
      ) : (
        <>
          {showLoading &&
            (result ? (
              <BuildsProgressBar progress={displayedProgress} />
            ) : (
              <BuildsLoading progress={displayedProgress} />
            ))}
          {result ? (
            <BuildResults
              result={result}
              refinement={refinement}
              refinementProgress={refinementProgress}
              onShowPending={onShowPending}
              onCancel={onCancel}
              pieceMap={pieceMap}
              setMap={setMap}
              statIcons={statIcons}
              balancedTuningIcon={balancedTuningIcon}
              characters={characters}
              statModHashes={statModHashes}
              tuningPlugHashes={tuningPlugHashes}
              artificeModHashes={artificeModHashes}
              getBuilderState={getBuilderState}
              manifest={manifest}
              insertablePlugs={insertablePlugs}
              onEquipped={onEquipped}
              onDream={onDream}
              sort={sort}
            />
          ) : !showLoading ? (
            <p className="text-muted-foreground text-sm">
              Pick an exotic, set bonuses, and stat targets — builds update as
              you go.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function BuildsProgressBar({
  progress: store,
}: {
  progress: ValueStore<number>;
}) {
  const progress = useStoreValue(store);
  return (
    <div
      role="progressbar"
      aria-label="Search progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      className="h-1.5 w-full overflow-hidden rounded-[3px] border border-input bg-black/30"
    >
      <div
        className="bg-foreground h-full"
        style={{ width: `${progress * 100}%` }}
      />
    </div>
  );
}

/** In-place loading state for the results column: a progress bar over pulsing skeleton rows. */
export function BuildsLoading({ progress: store }: { progress: ValueStore<number> }) {
  return (
    <div className="space-y-3">
      <BuildsProgressBar progress={store} />
      <div className={BUILD_LIST_WELL_CLASS}>
        {Array.from({ length: LOADING_ROWS }, (_, i) => (
          <div
            key={i}
            className={`${BUILD_CARD_LIFT_CLASS} flex animate-pulse items-center gap-4 p-2`}
            style={{ animationDelay: `${i * 120}ms` }}
            aria-hidden
          >
            <span className="d2-brackets size-14 shrink-0 bg-black/25" />
            <div className="flex min-w-0 flex-1 flex-col justify-center gap-2">
              <div className="flex items-center gap-4">
                <span className="bg-foreground/10 h-5 w-8 shrink-0" />
                <div className="flex flex-1 items-center gap-8">
                  {Array.from({ length: 6 }, (_, j) => (
                    <span key={j} className="bg-foreground/10 h-5 w-11" />
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className="bg-foreground/10 h-5 w-9 rounded-full" />
                <span className="bg-foreground/10 h-4 w-10" />
                <span className="bg-foreground/10 h-4 w-24" />
              </div>
            </div>
            <span className="size-8 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}
