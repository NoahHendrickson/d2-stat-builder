"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useLeaveBuildsSurface } from "@/components/builder/leave-builds-surface";
import type { PoolGapFix, PoolSetting } from "@/lib/armory/optimizer-pool";
import {
  ARMOR_SLOTS,
  SLOT_LABELS,
  STAT_DISPLAY_ORDER,
  STAT_LABELS,
  STAT_ORDER,
} from "@/lib/armory/stats";
import { listAnd } from "@/lib/format-list";
import { isSettledEmpty, type OverMaxCulprit } from "@/lib/optimizer/over-max";
import type { BuildList, RefinementState } from "@/lib/optimizer/types";

/** A pool gap (see fillablePoolGap) and how to show its settings. */
export interface PoolGap extends PoolGapFix {
  /** Scroll to the settings in `settings` and highlight them. */
  onShowSettings: () => void;
}

/**
 * Targets past their maximums on a settled empty result (see overMaxState), and how to
 * set one.
 */
export interface OverMaxFix {
  culprits: OverMaxCulprit[];
  onSet: (stat: number, value: number) => void;
}

/** The Builds list with no builds in it: why, and what to do. */
export function EmptyBuilds({
  result,
  refinement,
  poolGap,
  overMax,
}: {
  result: BuildList;
  refinement: RefinementState;
  poolGap?: PoolGap;
  overMax?: OverMaxFix;
}) {
  const gap = useGapForResult(result, poolGap);
  // A gap proves no build exists, whatever the search is still doing.
  if (gap) return <PoolGapNotice gap={gap} />;
  if (overMax && overMax.culprits.length > 0) return <OverMaxNotice fix={overMax} />;
  return <p className="text-muted-foreground text-sm">{emptyBuildsCopy(result, refinement)}</p>;
}

const statLabel = (stat: number) => STAT_LABELS[STAT_ORDER[stat]];

/**
 * "Super can reach 122 with your other targets." With several culprits each one alone is
 * enough, so the sentence lists them all and every one gets its own button. An unproven
 * max is achievable but may be higher: "at least".
 */
function OverMaxNotice({ fix }: { fix: OverMaxFix }) {
  const culprits = [...fix.culprits].sort(
    (a, b) =>
      STAT_DISPLAY_ORDER.indexOf(STAT_ORDER[a.stat]) -
      STAT_DISPLAY_ORDER.indexOf(STAT_ORDER[b.stat]),
  );
  const reach = (c: OverMaxCulprit) => `${c.proven ? "" : "at least "}${c.max}`;
  const parts = culprits.map((c, i) =>
    i === 0 ? `${statLabel(c.stat)} can reach ${reach(c)}` : `${statLabel(c.stat)} ${reach(c)}`,
  );
  const list =
    parts.length > 1 ? `${parts.slice(0, -1).join(", ")} or ${parts[parts.length - 1]}` : parts[0];
  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        {list} with your other targets.{culprits.length > 1 && " Lowering any one is enough."}
      </p>
      <div className="flex flex-wrap gap-2">
        {culprits.map((c) => (
          // Stays in the phone's builds sheet: the builds this brings back land right here.
          <Button key={c.stat} size="sm" onClick={() => fix.onSet(c.stat, c.max)}>
            Set {statLabel(c.stat)} to {c.max}
          </Button>
        ))}
      </div>
    </div>
  );
}

/**
 * The definitive "nothing meets those constraints" is only honest once no deeper
 * search is running, no better list is waiting behind the CTA above, AND the walk that
 * produced this empty list ran to exhaustion. A capped walk (time limit, or a background
 * pass that also timed out / was cancelled) has NOT proven anything: say "none found in
 * time", never "none exist".
 */
function emptyBuildsCopy(result: BuildList, refinement: RefinementState): string {
  if (refinement.phase === "running") {
    return "No builds found in the first pass yet — the deeper search is still running.";
  }
  if (refinement.phase === "done" && refinement.pending) {
    return "The first pass found none — use “Show them” above to load what the full search found.";
  }
  return isSettledEmpty(result, refinement)
    ? "No loadouts from your gear meet those constraints — even with mods. Try easing a target, a set bonus, or raising your mod budget."
    : "No builds found within the search time limit — some may still exist. Narrow your targets (or ease one) and search again.";
}

/**
 * The gap the empty `result` was searched under. Turning a setting on clears `poolGap`
 * at once, but the empty result stays until the new search lands; keep its explanation
 * until then rather than fall back to the generic copy.
 */
function useGapForResult(result: BuildList, poolGap?: PoolGap): PoolGap | undefined {
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
