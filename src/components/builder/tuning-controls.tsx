"use client";

import { Switch } from "@/components/ui/switch";

/**
 * The Tier-5 tuning switches: the master auto-tune toggle and, dependent on it, the
 * Balanced Tuning opt-out. The Balanced switch shows the EFFECTIVE state (off while
 * the master is off) but the stored preference is preserved and restored when the
 * master comes back on.
 */
export function TuningControls({
  allowTuning,
  onAllowTuningChange,
  useBalancedTuning,
  onUseBalancedTuningChange,
}: {
  allowTuning: boolean;
  onAllowTuningChange: (checked: boolean) => void;
  useBalancedTuning: boolean;
  onUseBalancedTuningChange: (checked: boolean) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <p className="text-muted-foreground text-xs">
          Auto-apply tuning on tunable pieces to hit your targets: directional
          (+5/−5) tunes, plus Balanced (+1 to off-stats) when enabled below.
        </p>
        <Switch
          checked={allowTuning}
          onCheckedChange={onAllowTuningChange}
          aria-label="Toggle Tier-5 tuning"
        />
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <span className="text-sm">Use balanced tuning mods</span>
          <p className="text-muted-foreground text-xs">
            When off, builds are searched without the Balanced (+1 to off-stats)
            tune — directional tuning stays available.
          </p>
        </div>
        <Switch
          checked={allowTuning && useBalancedTuning}
          disabled={!allowTuning}
          onCheckedChange={onUseBalancedTuningChange}
          aria-label="Use balanced tuning mods"
        />
      </div>
    </div>
  );
}
