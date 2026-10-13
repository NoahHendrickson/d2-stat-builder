"use client";

import { useState, type ReactNode } from "react";
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
import { TheoryResults } from "@/components/builder/theory-results";
import type { TheoryBuilds } from "@/components/builder/use-theory-builds";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ArmorPiece } from "@/lib/armory/normalize";
import type { ArmorSetInfo } from "@/lib/armory/sets";
import type { ArmoryCharacter } from "@/lib/armory/fetch";
import type { StatIconMap } from "@/lib/armory/stats";
import {
  DEFAULT_LOADOUT_SORT,
  LOADOUT_SORT_OPTIONS,
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

/** What the builds header (and the mobile bar) shows for the tab that's open. */
export interface BuildsHeader {
  title: string;
  state: BuildsViewState;
  label: string;
  /** The search reports progress (actual builds only): show its bar. */
  progress: boolean;
  /** The initial search is running (actual builds only): it can be cancelled. */
  busy: boolean;
}

/** The theoretical list's header: a count of exact and close builds. */
function theoryHeader(ready: boolean, theory: TheoryBuildState): BuildsHeader {
  const header = (state: BuildsViewState, label: string): BuildsHeader => ({
    title: "Theoretical Builds",
    state,
    label,
    progress: false,
    busy: false,
  });
  if (!ready) return header("not-ready", "");
  if (theory.running) return header("searching", "Searching…");
  if (theory.failed) return header("idle", "Search failed");
  const n = theory.result?.recipes.length;
  if (n === undefined) return header("idle", "");
  const close = theory.result!.close.length;
  const closeLabel = close ? `${close} close` : "";
  if (n === 0) {
    return close
      ? header("results", `No exact builds, ${closeLabel}`)
      : header("no-matches", "No builds reach these");
  }
  const shown = Math.min(MAX_SHOWN, n);
  const label = `${shown} ${shown === 1 ? "build" : "builds"}`;
  return header("results", close ? `${label}, ${closeLabel}` : label);
}

/** The header for the open tab, shared by the builds column and the mobile bar. */
export function buildsHeader({
  mode,
  ready,
  showLoading,
  running,
  result,
  theory,
}: Pick<
  BuildsColumnContentProps,
  "mode" | "ready" | "showLoading" | "running" | "result" | "theory"
>): BuildsHeader {
  if (mode === "theoretical") return theoryHeader(ready, theory.state);
  const state = getBuildsViewState({ ready, showLoading, result });
  return {
    title: "Builds",
    state,
    label: getBuildsStatusLabel({ ready, showLoading, result }),
    progress: state === "searching",
    // Initial search only — `running` is false once refinement starts (see use-optimizer).
    busy: running,
  };
}

export interface BuildsColumnContentProps {
  mode: BuildsMode;
  onModeChange: (mode: BuildsMode) => void;
  /** The Theoretical Builds tab's state (see useTheoryBuilds). */
  theory: TheoryBuilds;
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

/** The tabs, then the open tab's builds (each with its own header extras and sort). */
export function BuildsColumnContent(props: BuildsColumnContentProps) {
  const { mode, onModeChange, ready, provisional = false } = props;
  const header = buildsHeader(props);
  // Each tab's sort lives here, not in its body, so switching tabs keeps both.
  const [actualSort, setActualSort] = useState<LoadoutSortState>(DEFAULT_LOADOUT_SORT);
  const [theorySort, setTheorySort] = useState<TheorySortState>(DEFAULT_THEORY_SORT);
  const tabs = (
    <Tabs value={mode} onValueChange={(v) => onModeChange(v as BuildsMode)}>
      <TabsList aria-label="Which builds to show">
        <TabsTrigger value="actual">Builds</TabsTrigger>
        <TabsTrigger value="theoretical">Theoretical Builds</TabsTrigger>
      </TabsList>
    </Tabs>
  );
  if (!ready) {
    return (
      <div className="space-y-5">
        <HeaderRow tabs={tabs} header={header} />
        <p className="text-muted-foreground text-sm">
          {provisional
            ? "Refreshing your gear from Bungie — builds will appear in a moment."
            : "Sign in and load your gear to generate builds."}
        </p>
      </div>
    );
  }
  return mode === "theoretical" ? (
    <TheoryBuildsBody {...props} tabs={tabs} header={header} sort={theorySort} onSortChange={setTheorySort} />
  ) : (
    <ActualBuildsBody {...props} tabs={tabs} header={header} sort={actualSort} onSortChange={setActualSort} />
  );
}

/** The tabs on the left; Cancel, the status label and any sort control on the right. */
function HeaderRow({
  tabs,
  header,
  onCancel,
  sort,
}: {
  tabs: ReactNode;
  header: BuildsHeader;
  onCancel?: () => void;
  sort?: ReactNode;
}) {
  return (
    <div className="flex min-h-8 flex-wrap items-center gap-3">
      <h2 className="sr-only">{header.title}</h2>
      {tabs}
      <div className="ml-auto flex min-w-0 items-center gap-3">
        {/* Refinement Cancel lives in the status alert. */}
        {header.busy && onCancel && (
          <Button
            variant="link"
            onClick={onCancel}
            className="text-muted-foreground hover:text-foreground h-auto p-0 text-xs font-normal"
          >
            Cancel
          </Button>
        )}
        <span className="text-muted-foreground text-sm tabular-nums" aria-live="polite">
          {header.label}
        </span>
        {sort}
      </div>
    </div>
  );
}

type BodyProps<S> = BuildsColumnContentProps & {
  tabs: ReactNode;
  header: BuildsHeader;
  sort: S;
  onSortChange: (sort: S) => void;
};

function TheoryBuildsBody({
  tabs,
  header,
  theory,
  pieceMap,
  statIcons,
  sort,
  onSortChange,
}: BodyProps<TheorySortState>) {
  // A theoretical list stays sortable while a newer one is on its way.
  const sortable = (theory.state.result?.recipes.length ?? 0) > 1;
  return (
    <div className="space-y-5">
      <HeaderRow
        tabs={tabs}
        header={header}
        sort={
          sortable && (
            <LoadoutSortControls sort={sort} onChange={onSortChange} options={THEORY_SORT_OPTIONS} />
          )
        }
      />
      <div className="space-y-3">
        <TheoryIntroAlert />
        <TheoryResults
          state={theory.state}
          exotic={theory.exoticDisplay}
          setMap={theory.setMap}
          pieceMap={pieceMap}
          statIcons={statIcons}
          sort={sort}
        />
      </div>
    </div>
  );
}

function ActualBuildsBody({
  tabs,
  header,
  showLoading,
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
  sort,
  onSortChange,
}: BodyProps<LoadoutSortState>) {
  return (
    <div className="space-y-5">
      <HeaderRow
        tabs={tabs}
        header={header}
        onCancel={onCancel}
        sort={
          header.state === "results" && (
            <LoadoutSortControls sort={sort} onChange={onSortChange} options={LOADOUT_SORT_OPTIONS} />
          )
        }
      />
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
          Pick an exotic, set bonuses, and stat targets — builds update as you go.
        </p>
      ) : null}
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
