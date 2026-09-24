"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { StatTargetRow } from "@/components/builder/stat-target-row";
import { DreamComparison } from "@/components/builder/dream-results";
import type { ArmorPiece } from "@/lib/armory/normalize";
import {
  STAT_DISPLAY_ORDER,
  STAT_ORDER,
  type StatIconMap,
} from "@/lib/armory/stats";
import type { DreamInput } from "@/lib/optimizer/dream";
import type { CeilingsView } from "@/lib/optimizer/optimizer-store";
import type { OptimizerLoadout } from "@/lib/optimizer/types";
import { useDreamBuild } from "@/lib/optimizer/use-dream-build";
import { createValueStore, useStoreValue } from "@/lib/value-store";
import { cn } from "@/lib/utils";
import { Check } from "@phosphor-icons/react";

export interface DreamBuildDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called once the open/close animation finishes. */
  onOpenChangeComplete?: (open: boolean) => void;
  /** The build to dream on; kept while the modal animates closed. */
  build: OptimizerLoadout | null;
  /** The dream query for a build at a set of targets (other builder settings carried over). */
  makeInput: (build: OptimizerLoadout, targets: number[]) => DreamInput | null;
  pieceMap: Map<string, ArmorPiece>;
  statIcons: StatIconMap;
  /** Set names by hash, for replacements that must come from a required set. */
  setNames: ReadonlyMap<number, string>;
}

/**
 * Dream build for one build: its stats on the left to push around, its current pieces
 * and the pieces it could swap in on the right. The targets start at the build's own
 * stats each time the modal opens.
 */
export function DreamBuildDialog({
  open,
  onOpenChange,
  onOpenChangeComplete,
  build,
  ...rest
}: DreamBuildDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} onOpenChangeComplete={onOpenChangeComplete}>
      <DialogContent className="flex h-[min(88vh,54rem)] flex-col gap-4 p-5 sm:max-w-7xl">
        {/* Mounted only while the popup is, so each open starts from the build's stats. */}
        {build && <DreamBuildBody key={build.pieceIds.join("|")} build={build} {...rest} />}
      </DialogContent>
    </Dialog>
  );
}

function DreamBuildBody({
  build,
  makeInput,
  pieceMap,
  statIcons,
  setNames,
}: Omit<DreamBuildDialogProps, "open" | "onOpenChange" | "onOpenChangeComplete" | "build"> & {
  build: OptimizerLoadout;
}) {
  const [targets, setTargets] = useState(build.stats);
  // The builder's settings as of opening: the modal blocks editing them, so the only
  // thing that could change `makeInput` meanwhile is a background refetch — which must
  // not restart a long search over the same build.
  const [makeInputAtOpen] = useState(() => makeInput);
  const input = useMemo(
    () => makeInputAtOpen(build, targets),
    [makeInputAtOpen, build, targets],
  );
  const state = useDreamBuild(input);

  // The sliders' max overlay: how far THIS build reaches on each stat given the others,
  // from the dream search's own pass over the build as it is.
  const [ceilingsView] = useState(() =>
    createValueStore<CeilingsView>({ values: null, exact: false }),
  );
  // …and past it, striped: how far farming a replacement could take each stat.
  const [possibleView] = useState(() =>
    createValueStore<CeilingsView>({ values: null, exact: false }),
  );
  const result = state.result;
  useEffect(() => {
    if (result) {
      // Keep the last FEASIBLE values. Each stat's ceiling holds the other five targets,
      // so once one target is past what the build reaches (step 2), the owned search is
      // infeasible for every other stat and reports 0 — which would wipe the max and the
      // striped band off every other slider. Same for the possible reach past it.
      if (result.newPieces === 0) {
        ceilingsView.set({ values: result.ownedCeilings, exact: result.ownedCeilingsExact });
      }
      if (result.newPieces !== null) {
        possibleView.set({ values: result.possibleCeilings, exact: result.possibleCeilingsExact });
      }
    }
  }, [result, ceilingsView, possibleView]);

  const setTarget = useCallback(
    (i: number, value: number) =>
      setTargets((prev) => prev.map((v, idx) => (idx === i ? value : v))),
    [],
  );
  const changed = targets.some((v, i) => v !== build.stats[i]);
  // The two steps: make room, then ask for more than the build reaches. "Past its max" is
  // against the latest search's reach for these targets (the build's stats before one).
  const lowered = targets.some((v, i) => v < build.stats[i]);
  const reach = useStoreValue(ceilingsView).values ?? build.stats;
  const pushedPast = targets.some((v, i) => v > reach[i]);
  const idleNote = !lowered
    ? "Start on the left: lower the stats you don't need. That frees up room for the ones you want."
    : !pushedPast
      ? "Now push the stats you want into the striped part of their bar (what farming could reach): drag them, or press +."
      : undefined;
  const exoticIcon = build.pieceIds
    .map((id) => pieceMap.get(id))
    .find((p) => p?.isExotic)?.icon;

  return (
    <>
      <DialogHeader className="pr-8">
        <DialogTitle>Dream build</DialogTitle>
        <DialogDescription>
          Find out which piece of this build to replace, and with what, to get more of
          the stats you want.
        </DialogDescription>
      </DialogHeader>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-y-auto md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] md:overflow-hidden">
        <section className="border-foreground/8 flex flex-col gap-4 md:overflow-y-auto md:border-r md:pr-6">
          <ol className="flex flex-col gap-2">
            <Step
              n={1}
              done={lowered}
              active={!lowered}
              title="Lower the stats you don't need"
              detail="That frees up room for the ones you want."
            />
            <Step
              n={2}
              done={pushedPast}
              active={lowered && !pushedPast}
              title="Raise the stats you want"
              detail="Push them into the striped part of the bar: what farming a new piece could reach. The amber tick marks where each started."
            />
          </ol>
          <div className="flex min-h-5 items-center justify-between">
            <span className="d2-label">Stat targets</span>
            {changed && (
              <Button
                variant="link"
                onClick={() => setTargets(build.stats)}
                className="text-muted-foreground hover:text-foreground h-auto p-0 text-xs font-normal"
              >
                Reset
              </Button>
            )}
          </div>
          <div className="space-y-7">
            {STAT_DISPLAY_ORDER.map((key) => {
              const i = STAT_ORDER.indexOf(key);
              return (
                <StatTargetRow
                  key={key}
                  statKey={key}
                  index={i}
                  icon={statIcons[key]}
                  value={targets[i]}
                  ceilingsView={ceilingsView}
                  onChange={setTarget}
                  baseline={build.stats[i]}
                  stepper
                  possibleView={possibleView}
                />
              );
            })}
          </div>
        </section>
        <section className="d2-scroll flex min-h-0 flex-col gap-6 md:overflow-y-auto md:pr-2">
          {input ? (
            <DreamComparison
              build={build}
              state={state}
              pieceMap={pieceMap}
              statIcons={statIcons}
              exoticIcon={exoticIcon}
              idleNote={idleNote}
              setNames={setNames}
            />
          ) : (
            <p className="text-muted-foreground text-sm">
              Some of this build&apos;s pieces are no longer in the search (a setting
              changed or your gear refreshed). Close this and pick a build from the
              current list.
            </p>
          )}
        </section>
      </div>
    </>
  );
}

/** One instruction step: numbered, highlighted while it's the next thing to do, checked once done. */
function Step({
  n,
  done,
  active,
  title,
  detail,
}: {
  n: number;
  done: boolean;
  active: boolean;
  title: string;
  detail: string;
}) {
  return (
    <li
      className={cn(
        "flex gap-3 border p-2.5 transition-colors",
        active ? "border-foreground/25 bg-foreground/6" : "border-foreground/8",
      )}
      aria-current={active ? "step" : undefined}
    >
      <span
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-medium",
          done
            ? "bg-positive/80 text-background"
            : active
              ? "bg-foreground text-background"
              : "bg-foreground/12 text-muted-foreground",
        )}
      >
        {done ? <Check weight="bold" className="size-3" aria-label="Done" /> : n}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span
          className={cn("truncate text-sm", !active && !done && "text-muted-foreground")}
          title={title}
        >
          {title}
        </span>
        <span className="text-muted-foreground text-xs">{detail}</span>
      </span>
    </li>
  );
}
