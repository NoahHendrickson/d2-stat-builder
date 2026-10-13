"use client";

import { useMemo, useState } from "react";
import type { TheoryExoticDisplay } from "@/components/builder/theory-results";
import type { ArmorArchetype } from "@/lib/armory/archetypes";
import type { SpiritPerkInfo } from "@/lib/armory/exotic-class-perks";
import type { ArmorPiece } from "@/lib/armory/normalize";
import { classSets, type ArmorSetInfo } from "@/lib/armory/sets";
import type { ArmorSlot } from "@/lib/armory/stats";
import type { Manifest } from "@/lib/manifest/load";
import type { CeilingsView } from "@/lib/optimizer/optimizer-store";
import type { TheoryInput } from "@/lib/optimizer/theory";
import { theoryExotic, theoryOwnedRolls } from "@/lib/optimizer/theory-input";
import type { StatArray } from "@/lib/optimizer/types";
import { useTheoryBuild, type TheoryBuildState } from "@/lib/optimizer/use-theory-build";
import { createValueStore, type ValueStore } from "@/lib/value-store";

const NO_SETS: ArmorSetInfo[] = [];

export interface TheoryBuilds {
  state: TheoryBuildState;
  /** Every set the class can wear, owned or not (empty while the tab is closed). */
  sets: ArmorSetInfo[];
  setMap: Map<number, ArmorSetInfo>;
  /** The theoretical maxima for the stat sliders. */
  ceilings: ValueStore<CeilingsView>;
  /** What the cards show for an exotic they'd have you farm (null = none picked). */
  exoticDisplay: TheoryExoticDisplay | null;
}

/**
 * Everything the Theoretical Builds tab adds to the builder: the class's full set list,
 * the owned pieces and exotic it can seat, the search, and its slider maxima. Nothing
 * here is computed while the tab is closed (`active` false); the worker stays idle then,
 * keeping its roll space for the way back.
 */
export function useTheoryBuilds({
  active,
  searchReady,
  manifest,
  classType,
  pool,
  classPieces,
  archetypes,
  setReqs,
  targets,
  major,
  fragmentBonus,
  exotic,
}: {
  /** The tab is open. */
  active: boolean;
  /** The live profile is in, so a search may run. */
  searchReady: boolean;
  manifest?: Manifest;
  classType: number | null;
  /** The optimizer pool (for the sets' owned counts). */
  pool: ArmorPiece[];
  classPieces: ArmorPiece[];
  archetypes: ArmorArchetype[];
  /** The builder's raw set requirements, kept even for sets with no owned pieces. */
  setReqs: Record<number, 2 | 4>;
  targets: StatArray;
  major: number;
  fragmentBonus: StatArray;
  exotic: {
    option: { name: string; slot: ArmorSlot; icon?: string; watermark?: string } | null;
    classItemHash?: number;
    spiritPerks: { left: SpiritPerkInfo[]; right: SpiritPerkInfo[] } | null;
    exoticPerks: [number | null, number | null];
  };
}): TheoryBuilds {
  // Planning what to farm: every set the class can wear, owned or not.
  const sets = useMemo(
    () =>
      active && manifest && classType !== null ? classSets(manifest, classType, pool) : NO_SETS,
    [active, manifest, classType, pool],
  );
  const setMap = useMemo(() => new Map(sets.map((s) => [s.setHash, s])), [sets]);
  const setRequirements = useMemo(
    () =>
      Object.entries(setReqs)
        .filter(([h]) => setMap.has(Number(h)))
        .map(([setHash, count]) => ({ setHash: Number(setHash), count })),
    [setReqs, setMap],
  );

  const owned = useMemo(
    () => (active ? theoryOwnedRolls(classPieces, archetypes) : []),
    [active, classPieces, archetypes],
  );
  const { option, classItemHash, spiritPerks, exoticPerks } = exotic;
  const exoticChoice = useMemo(
    () =>
      active && manifest
        ? theoryExotic({
            option,
            classItemHash,
            spiritPerks,
            exoticPerks,
            pieces: classPieces,
            archetypes,
            manifest,
          })
        : { exotic: null, bonusKnown: true },
    [active, manifest, option, classItemHash, spiritPerks, exoticPerks, classPieces, archetypes],
  );

  const input = useMemo(
    (): TheoryInput | null =>
      active && searchReady && archetypes.length
        ? {
            archetypes,
            // With no exotic or set picked the cards are a plain list of rolls to farm,
            // so owned pieces aren't seated.
            owned: exoticChoice.exotic || setRequirements.length ? owned : [],
            minimums: targets,
            mods: { major, minor: 5 - major },
            fragmentBonus,
            exotic: exoticChoice.exotic,
            sets: setRequirements,
          }
        : null,
    [active, searchReady, archetypes, owned, targets, major, fragmentBonus, exoticChoice, setRequirements],
  );

  // The slider maxima follow the worker: exact once a result lands (none when the set
  // bonuses can't fit, since no build exists), unproven while a newer search runs.
  const [ceilings] = useState(() => createValueStore<CeilingsView>({ values: null, exact: false }));
  const state = useTheoryBuild(input, {
    onStart: () => ceilings.set({ values: ceilings.get().values, exact: false }),
    onResult: (result) =>
      ceilings.set({ values: result.setsDontFit ? null : result.ceilings, exact: true }),
  });

  const exoticDisplay = useMemo(
    () =>
      exoticChoice.exotic && option
        ? {
            name: option.name,
            icon: option.icon,
            watermark: option.watermark,
            bonusKnown: exoticChoice.bonusKnown,
          }
        : null,
    [exoticChoice, option],
  );

  return useMemo(
    () => ({ state, sets, setMap, ceilings, exoticDisplay }),
    [state, sets, setMap, ceilings, exoticDisplay],
  );
}
