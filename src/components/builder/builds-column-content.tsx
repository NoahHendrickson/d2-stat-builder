"use client";

import { Button } from "@/components/ui/button";
import {
  BuildResults,
  MAX_SHOWN,
  type DimSubclassInput,
} from "@/components/builder/build-results";
import type { ArmorPiece } from "@/lib/armory/normalize";
import type { ArmorSetInfo } from "@/lib/armory/sets";
import type { ArmoryCharacter } from "@/lib/armory/fetch";
import type { StatIconMap } from "@/lib/armory/stats";
import type { StatModHashes } from "@/lib/dim/mod-hashes";
import type { OptimizerOutput } from "@/lib/optimizer/types";
import type { RefineOutcome } from "@/lib/optimizer/use-optimizer";

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
      return `${Math.min(MAX_SHOWN, result!.loadouts.length).toLocaleString()} / ${result!.combosValid.toLocaleString()}`;
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

export interface BuildsColumnContentProps {
  ready: boolean;
  showLoading: boolean;
  running: boolean;
  result: OptimizerOutput | null;
  displayedProgress: number;
  /** A capped search is still refining in the background (interim results shown). */
  refining: boolean;
  /** 0–1 progress of the background refinement pass. */
  refineProgress: number;
  /** How the last background refinement resolved (null = none ran / still running). */
  refineOutcome: RefineOutcome;
  /** A strictly-better background list is waiting behind the "show them" action. */
  hasPending: boolean;
  /** Apply the waiting better list (the explicit user action that changes the list). */
  onShowPending: () => void;
  onCancel: () => void;
  pieceMap: Map<string, ArmorPiece>;
  targets: number[];
  setMap: Map<number, ArmorSetInfo>;
  statIcons: StatIconMap;
  balancedTuningIcon?: string;
  characters: ArmoryCharacter[];
  statModHashes: StatModHashes[] | null;
  tuningPlugHashes: Map<string, number> | null;
  artificeModHashes: (number | undefined)[] | null;
  subclass?: DimSubclassInput;
  onEquipped: () => void;
}

export function BuildsColumnContent({
  ready,
  showLoading,
  running,
  result,
  displayedProgress,
  refining,
  refineProgress,
  refineOutcome,
  hasPending,
  onShowPending,
  onCancel,
  pieceMap,
  targets,
  setMap,
  statIcons,
  balancedTuningIcon,
  characters,
  statModHashes,
  tuningPlugHashes,
  artificeModHashes,
  subclass,
  onEquipped,
}: BuildsColumnContentProps) {
  const statusLabel = getBuildsStatusLabel({ ready, showLoading, result });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-medium">Builds</h2>
        <div className="flex items-center gap-3">
          {running && (
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
        </div>
      </div>
      {!ready ? (
        <p className="text-muted-foreground text-sm">
          Sign in and load your gear to generate builds.
        </p>
      ) : showLoading ? (
        <BuildsLoading progress={displayedProgress} />
      ) : result ? (
        <BuildResults
          result={result}
          refining={refining}
          refineProgress={refineProgress}
          refineOutcome={refineOutcome}
          hasPending={hasPending}
          onShowPending={onShowPending}
          pieceMap={pieceMap}
          targets={targets}
          setMap={setMap}
          statIcons={statIcons}
          balancedTuningIcon={balancedTuningIcon}
          characters={characters}
          statModHashes={statModHashes}
          tuningPlugHashes={tuningPlugHashes}
          artificeModHashes={artificeModHashes}
          subclass={subclass}
          onEquipped={onEquipped}
        />
      ) : (
        <p className="text-muted-foreground text-sm">
          Pick an exotic, set bonuses, and stat targets — builds update as you go.
        </p>
      )}
    </div>
  );
}

/** In-place loading state for the results column: a progress bar over pulsing skeleton rows. */
export function BuildsLoading({ progress }: { progress: number }) {
  return (
    <div className="space-y-3">
      <div
        role="progressbar"
        aria-label="Search progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        className="bg-muted h-1 w-full overflow-hidden rounded-full"
      >
        <div
          className="bg-primary h-full rounded-full"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
      <div className="space-y-1.5">
        {Array.from({ length: LOADING_ROWS }, (_, i) => (
          <div
            key={i}
            className="border-border/60 flex animate-pulse items-center gap-3 rounded-lg border p-2.5"
            style={{ animationDelay: `${i * 120}ms` }}
            aria-hidden
          >
            <span className="bg-muted size-7 shrink-0 rounded" />
            <div className="flex flex-1 items-center gap-3">
              {Array.from({ length: 6 }, (_, j) => (
                <span key={j} className="bg-muted h-3.5 w-10 rounded" />
              ))}
            </div>
            <span className="bg-muted h-3.5 w-8 shrink-0 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
