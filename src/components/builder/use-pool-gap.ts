import { useMemo, useRef, useState } from "react";
import type { PoolGap } from "@/components/builder/empty-builds";
import { scrollRowsIntoView } from "@/components/builder/highlight-setting-rows";
import {
  fillablePoolGap,
  type PoolOptions,
  type PoolPiece,
  type PoolSetting,
} from "@/lib/armory/optimizer-pool";
import type { ArmorSlot } from "@/lib/armory/stats";

/**
 * No legendary for some slots (most often: no Tier 5 armor yet). `poolGap` lets the
 * empty Builds list say so and point at the Advanced settings that fix it; its button
 * scrolls to those rows (the two refs) and pulses them (`attention`, for SettingRow).
 */
export function usePoolGap(
  slotPieces: readonly (readonly PoolPiece[])[],
  classPieces: readonly (PoolPiece & { slot: ArmorSlot })[],
  exoticSlot: ArmorSlot | null,
  poolOptions: PoolOptions,
) {
  const legacyArmor = useRef<HTMLDivElement>(null);
  const lowerTierArmor = useRef<HTMLDivElement>(null);
  const [pulse, setPulse] = useState({ key: 0, settings: [] as PoolSetting[] });
  const poolGap = useMemo((): PoolGap | undefined => {
    const fix = fillablePoolGap(slotPieces, classPieces, exoticSlot, poolOptions);
    if (!fix) return undefined;
    const rows = { legacyArmor, lowerTierArmor };
    const onShowSettings = async () => {
      // Page order: Legacy armor sits above Lower tier armor.
      const shown = (["legacyArmor", "lowerTierArmor"] as const)
        .filter((setting) => fix.settings.includes(setting))
        .map((setting) => rows[setting].current);
      if (!(await scrollRowsIntoView(shown))) return;
      setPulse((p) => ({ key: p.key + 1, settings: fix.settings }));
    };
    return { ...fix, onShowSettings };
  }, [slotPieces, classPieces, exoticSlot, poolOptions]);
  const attention = (setting: PoolSetting) =>
    pulse.settings.includes(setting) ? pulse.key : undefined;
  return { poolGap, legacyArmorRef: legacyArmor, lowerTierArmorRef: lowerTierArmor, attention };
}
