"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useLeaveBuildsSurface } from "@/components/builder/leave-builds-surface";
import type { PoolGapFix, PoolSetting } from "@/lib/armory/optimizer-pool";
import { ARMOR_SLOTS, SLOT_LABELS } from "@/lib/armory/stats";
import { listAnd } from "@/lib/format-list";
import type { OptimizerOutput, RefinementState } from "@/lib/optimizer/types";

/** A pool gap (see fillablePoolGap) and how to show its settings. */
export interface PoolGap extends PoolGapFix {
  /** Scroll to the settings in `settings` and highlight them. */
  onShowSettings: () => void;
}

/** The Builds list with no builds in it: why, and what to do. */
export function EmptyBuilds({
  result,
  refinement,
  poolGap,
}: {
  result: OptimizerOutput;
  refinement: RefinementState;
  poolGap?: PoolGap;
}) {
  const gap = useGapForResult(result, poolGap);
  // A gap proves no build exists, whatever the search is still doing.
  if (gap) return <PoolGapNotice gap={gap} />;
  return <p className="text-muted-foreground text-sm">{emptyBuildsCopy(result, refinement)}</p>;
}

/**
 * The definitive "nothing meets those constraints" is only honest once no deeper
 * search is running, no better list is waiting behind the CTA above, AND the walk that
 * produced this empty list ran to exhaustion. A capped walk (time limit, or a background
 * pass that also timed out / was cancelled) has NOT proven anything: say "none found in
 * time", never "none exist".
 */
function emptyBuildsCopy(result: OptimizerOutput, refinement: RefinementState): string {
  if (refinement.phase === "running") {
    return "No builds found in the first pass yet — the deeper search is still running.";
  }
  if (refinement.phase === "done" && refinement.pending) {
    return "The first pass found none — use “Show them” above to load what the full search found.";
  }
  const exhaustive = !result.capped || (refinement.phase === "done" && refinement.verified);
  return exhaustive
    ? "No loadouts from your gear meet those constraints — even with mods. Try easing a target, a set bonus, or raising your mod budget."
    : "No builds found within the search time limit — some may still exist. Narrow your targets (or ease one) and search again.";
}

/**
 * The gap the empty `result` was searched under. Turning a setting on clears `poolGap`
 * at once, but the empty result stays until the new search lands; keep its explanation
 * until then rather than fall back to the generic copy.
 */
function useGapForResult(result: OptimizerOutput, poolGap?: PoolGap): PoolGap | undefined {
  const [held, setHeld] = useState({ result, gap: poolGap });
  const changed = held.result !== result || (poolGap !== undefined && held.gap !== poolGap);
  if (changed) setHeld({ result, gap: poolGap });
  return changed ? poolGap : (poolGap ?? held.gap);
}

const SETTING_NAMES: Record<PoolSetting, string> = {
  lowerTierArmor: "lower tier",
  legacyArmor: "legacy",
};

function PoolGapNotice({ gap }: { gap: PoolGap }) {
  const leave = useLeaveBuildsSurface();
  const used = ["Tier 5", ...gap.using.map((s) => SETTING_NAMES[s])];
  const settings = gap.settings.map((s) => SETTING_NAMES[s]).join(gap.together ? " and " : " or ");
  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        No builds: {gap.using.length ? "only" : "by default only"} {listAnd(used)} legendaries are
        used, and you{" "}
        {gap.slots.length === ARMOR_SLOTS.length
          ? "don't have any for this class"
          : `have none for ${listAnd(gap.slots.map((s) => SLOT_LABELS[s].toLowerCase()))}`}
        .
      </p>
      <Button size="sm" onClick={() => leave(gap.onShowSettings)}>
        Include {settings} armor
      </Button>
    </div>
  );
}
