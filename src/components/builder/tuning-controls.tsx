"use client";

import { memo } from "react";
import { Switch } from "@/components/ui/switch";

/**
 * The Tier-5 tuning switches, plus the collections class-item pin and FotL mask
 * helmet pin. The Balanced switch shows the EFFECTIVE state (off while the master
 * is off) but the stored preference is preserved and restored when the master
 * comes back on.
 */
export const TuningControls = memo(function TuningControls({
  allowTuning,
  onAllowTuningChange,
  useBalancedTuning,
  onUseBalancedTuningChange,
  useDreamersBond,
  onUseDreamersBondChange,
  dreamersItemName,
  useFestivalMasks,
  onUseFestivalMasksChange,
}: {
  allowTuning: boolean;
  onAllowTuningChange: (checked: boolean) => void;
  useBalancedTuning: boolean;
  onUseBalancedTuningChange: (checked: boolean) => void;
  useDreamersBond: boolean;
  onUseDreamersBondChange: (checked: boolean) => void;
  /** Class-specific collections item: Dreamer's Bond / Cloak / Mark. */
  dreamersItemName: string;
  useFestivalMasks: boolean;
  onUseFestivalMasksChange: (checked: boolean) => void;
}) {
  const dreamersLabel = `Use ${dreamersItemName}`;
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
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <span className="text-sm">{dreamersLabel}</span>
          <p className="text-muted-foreground text-xs">
            Pin the collections 21-power class item (no stats). Builds search
            the other four pieces around it.
          </p>
        </div>
        <Switch
          checked={useDreamersBond}
          onCheckedChange={onUseDreamersBondChange}
          aria-label={dreamersLabel}
        />
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <span className="text-sm">Use Festival of the Lost masks</span>
          <p className="text-muted-foreground text-xs">
            Helmet slot is only the FotL masks in your inventory and vault.
            Their rolled stats are used as-is.
          </p>
        </div>
        <Switch
          checked={useFestivalMasks}
          onCheckedChange={onUseFestivalMasksChange}
          aria-label="Use Festival of the Lost masks"
        />
      </div>
    </div>
  );
});
