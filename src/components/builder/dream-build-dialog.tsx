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
import { createValueStore } from "@/lib/value-store";

export interface DreamBuildDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The build to dream on; kept while the modal animates closed. */
  build: OptimizerLoadout | null;
  /** The dream query for a build at a set of targets (other builder settings carried over). */
  makeInput: (build: OptimizerLoadout, targets: number[]) => DreamInput | null;
  pieceMap: Map<string, ArmorPiece>;
  statIcons: StatIconMap;
}

/**
 * Dream build for one build: its stats on the left to push around, its current pieces
 * and the pieces it could swap in on the right. The targets start at the build's own
 * stats each time the modal opens.
 */
export function DreamBuildDialog({
  open,
  onOpenChange,
  build,
  ...rest
}: DreamBuildDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
}: Omit<DreamBuildDialogProps, "open" | "onOpenChange" | "build"> & {
  build: OptimizerLoadout;
}) {
  const [targets, setTargets] = useState(build.stats);
  const input = useMemo(() => makeInput(build, targets), [makeInput, build, targets]);
  const state = useDreamBuild(input);

  // The sliders' max overlay: how far THIS build reaches on each stat given the others,
  // from the dream search's own pass over the build as it is.
  const [ceilingsView] = useState(() =>
    createValueStore<CeilingsView>({ values: null, exact: false }),
  );
  const result = state.result;
  useEffect(() => {
    if (result) {
      ceilingsView.set({ values: result.ownedCeilings, exact: result.ownedCeilingsExact });
    }
  }, [result, ceilingsView]);

  const setTarget = useCallback(
    (i: number, value: number) =>
      setTargets((prev) => prev.map((v, idx) => (idx === i ? value : v))),
    [],
  );
  const changed = targets.some((v, i) => v !== build.stats[i]);
  const exoticIcon = build.pieceIds
    .map((id) => pieceMap.get(id))
    .find((p) => p?.isExotic)?.icon;

  return (
    <>
      <DialogHeader className="pr-8">
        <DialogTitle>Dream build</DialogTitle>
        <DialogDescription>
          Raise the stats you want more of (lower others to make room) to see which
          piece of this build to replace, and with what.
        </DialogDescription>
      </DialogHeader>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-y-auto md:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] md:overflow-hidden">
        <section className="border-foreground/8 flex flex-col gap-4 md:overflow-y-auto md:border-r md:pr-6">
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
