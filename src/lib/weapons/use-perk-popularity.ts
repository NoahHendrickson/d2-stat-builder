"use client";

import { useMemo } from "react";
import { useDataRepoSnapshot } from "@/lib/use-data-repo-snapshot";
import {
  PERK_POPULARITY_FILE,
  columnShares,
  comboShares,
  masterworkShares,
  traitColumns,
  type PerkPopularityIndex,
} from "./perk-popularity";
import type { WeaponCatalog } from "./catalog";
import { mostPopularRoll, type WeaponPopularityView } from "./popularity-view";
import { masterworkSlotKey } from "./pick-slots";
import type { WeaponSummary } from "./types";

/** The popularity snapshot (see useDataRepoSnapshot); the weapon page goes without when it can't load. */
export function usePerkPopularityIndex() {
  return useDataRepoSnapshot<PerkPopularityIndex>({
    file: PERK_POPULARITY_FILE,
    what: "Perk popularity",
    isValid: (data) => data.schema === 2 && typeof data.weapons === "object",
  });
}

const NO_POPULARITY: WeaponPopularityView = {
  available: false,
  copies: 0,
  columns: [],
  combos: [],
  topRoll: {},
};

/**
 * Popularity for one weapon, mapped onto its own catalog perks: the shares the
 * crawl counted by perk hash, as the perk indices the grid picks by. Only
 * changes with the snapshot or the weapon, not with every hover.
 */
export function useWeaponPopularity(
  weapon: WeaponSummary,
  catalog: WeaponCatalog,
): WeaponPopularityView {
  const index = usePerkPopularityIndex().data;
  return useMemo(() => {
    const data = index?.weapons[weapon.hash];
    if (!data || data.copies === 0) return NO_POPULARITY;
    // A perk hash → its index in one of this weapon's columns.
    const indexIn = (column: number, hash: number) =>
      weapon.columns[column]?.perkIndices.find((i) => catalog.perks[i]?.hash === hash);
    const columns = weapon.columns.flatMap(({ perkIndices }, column) => {
      const byHash = new Map(columnShares(data, column).map(({ hash, share }) => [hash, share]));
      // Nothing counted here, or (a catalog that has since changed) no perks to show it on.
      if (byHash.size === 0 || perkIndices.length === 0) return [];
      const perks = perkIndices.map((perkIndex) => ({
        perkIndex,
        share: byHash.get(catalog.perks[perkIndex]?.hash ?? -1) ?? 0,
      }));
      return [{ column, perks }];
    });
    const traits = traitColumns(weapon.columns);
    const combos = traits
      ? comboShares(data).flatMap(({ left, right, count, share }) => {
          const l = indexIn(traits[0], left);
          const r = indexIn(traits[1], right);
          return l === undefined || r === undefined
            ? []
            : [{ leftColumn: traits[0], left: l, rightColumn: traits[1], right: r, count, share }];
        })
      : [];
    // Every masterwork the weapon can take, in its section's order; 0 for one no counted copy has.
    const counted = masterworkShares(data);
    const masterworkShare = new Map(counted.shares.map(({ hash, share }) => [hash, share]));
    const masterworks = weapon.masterworks?.length
      ? {
          slot: masterworkSlotKey(weapon),
          counted: counted.counted,
          perks: weapon.masterworks.map((perkIndex) => ({
            perkIndex,
            share: masterworkShare.get(catalog.perks[perkIndex]?.hash ?? -1) ?? 0,
          })),
        }
      : undefined;
    return {
      available: true,
      copies: data.copies,
      generatedAt: index?.generatedAt,
      columns,
      combos,
      masterworks,
      topRoll: mostPopularRoll(columns, combos, masterworks),
    };
  }, [index, weapon, catalog]);
}
