"use client";

import { useMemo } from "react";
import type { ArmorPiece } from "@/lib/armory/normalize";
import type { DreamSettings } from "@/lib/optimizer/dream-input";
import { armorToOptimizerPiece } from "@/lib/optimizer/from-armory";
import type { ExoticConstraint, OptimizerInput } from "@/lib/optimizer/types";
import { useWeaponPlan } from "@/lib/optimizer/use-weapon-plan";
import {
  toOptimizerPowerRange,
  type PowerRangeSelection,
} from "@/lib/builder/selection-storage";

const MAX_MODS = 5;

/**
 * The builder's optimizer queries from its selections: the search settings (shared by
 * the regular search and the dream search), the regular search input over owned
 * pieces, and the weapon-mix scan behind Power matters' suggested weapons.
 */
export function useBuilderSearchInputs({
  classType,
  slotPieces,
  targets,
  major,
  setRequirements,
  useBalancedTuning,
  fragmentBonus,
  powerRange,
  selectedExotic,
  exotics,
}: {
  classType: number | null;
  slotPieces: readonly (readonly ArmorPiece[])[];
  targets: number[];
  major: number;
  setRequirements: DreamSettings["setRequirements"];
  useBalancedTuning: boolean;
  fragmentBonus: DreamSettings["fragmentBonus"];
  powerRange: PowerRangeSelection;
  selectedExotic: number | null;
  exotics: readonly { hashes: number[] }[];
}) {
  // The builder's search settings (everything but pieces, targets and the exotic) —
  // shared by the regular search and the dream search.
  // The power range is layered on separately so the weapon-mix scan (which supplies its
  // own weapons) doesn't re-run when only the entered weapons change.
  const baseSearchSettings = useMemo(
    (): DreamSettings => ({
      mods: { major, minor: MAX_MODS - major },
      setRequirements,
      allowTuning: true,
      allowBalancedTuning: useBalancedTuning,
      fragmentBonus,
    }),
    [major, setRequirements, useBalancedTuning, fragmentBonus],
  );
  const searchSettings = useMemo(
    (): DreamSettings => ({
      ...baseSearchSettings,
      powerRange: toOptimizerPowerRange(powerRange),
    }),
    [baseSearchSettings, powerRange],
  );

  const optimizerSlots = useMemo(
    () => slotPieces.map((pieces) => pieces.map(armorToOptimizerPiece)),
    [slotPieces],
  );
  const exoticConstraint = useMemo(
    (): ExoticConstraint =>
      selectedExotic === null
        ? { mode: "any" }
        : { mode: "specific", hashes: exotics[selectedExotic]?.hashes ?? [] },
    [selectedExotic, exotics],
  );

  // The regular search input over owned pieces.
  const optimizerInput = useMemo((): OptimizerInput | null => {
    if (classType === null) return null;
    return {
      ...searchSettings,
      slots: optimizerSlots,
      minimums: targets,
      exotic: exoticConstraint,
      maxResults: 200,
    };
  }, [optimizerSlots, classType, targets, exoticConstraint, searchSettings]);

  // The weapon-mix scan: the same query, once per mix of common weapon powers.
  const powerBounds = powerRange.enabled ? powerRange.bounds : null;
  const weaponPlanInput = useMemo((): OptimizerInput | null => {
    if (classType === null || powerBounds === null) return null;
    return {
      ...baseSearchSettings,
      slots: optimizerSlots,
      minimums: targets,
      exotic: exoticConstraint,
      powerRange: { min: powerBounds.min, max: powerBounds.max },
    };
  }, [classType, powerBounds, baseSearchSettings, optimizerSlots, targets, exoticConstraint]);
  const weaponPlan = useWeaponPlan(weaponPlanInput);

  return { searchSettings, optimizerInput, weaponPlan };
}
