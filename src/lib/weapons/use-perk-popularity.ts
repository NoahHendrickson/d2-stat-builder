"use client";

import { useMemo } from "react";
import { useStaticJson } from "@/lib/use-static-json";
import {
  PERK_POPULARITY_URL,
  columnShares,
  comboShares,
  traitColumns,
  type PerkPopularityIndex,
} from "./perk-popularity";
import type { WeaponCatalog } from "./catalog";
import type { Roll } from "./pick-slots";
import type { WeaponSummary } from "./types";

/**
 * The popularity snapshot. In development it's the local crawler output
 * (public/dev-data, git-ignored); otherwise the published copy on GitHub Pages,
 * so Vercel never serves it. Optional: if it can't load, the weapon page just
 * goes without popularity.
 */
export function usePerkPopularityIndex() {
  return useStaticJson({
    key: "perk-popularity",
    url:
      process.env.NODE_ENV === "development"
        ? "/dev-data/perk-popularity.json"
        : PERK_POPULARITY_URL,
    what: "Perk popularity",
    retry: false,
    parse: (json) => {
      const data = json as PerkPopularityIndex;
      if (data?.schema !== 2 || typeof data.weapons !== "object")
        throw new Error("The perk popularity snapshot is incomplete.");
      return data;
    },
  });
}

/** One perk's share of its column, as the Popularity card lists it. */
export interface PerkPopularity {
  perkIndex: number;
  share: number;
}

/** One left + right combo, as the Popularity card lists it. */
export interface ComboPopularity {
  /** The trait columns and the catalog perk index in each. */
  leftColumn: number;
  left: number;
  rightColumn: number;
  right: number;
  share: number;
}

export interface WeaponPopularityView {
  /** The snapshot has this weapon. */
  available: boolean;
  /** Copies seen used in PvE. */
  copies: number;
  /** When the snapshot was built. */
  generatedAt?: string;
  /** Each perk column with data, its perks most run first (perks no one ran left out). */
  columns: { column: number; perks: PerkPopularity[] }[];
  /** The most run left + right combos, most run first. */
  combos: ComboPopularity[];
  /** The most run perk in each column with data, keyed like picks (by column). */
  topRoll: Roll;
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
    const columns = weapon.columns.flatMap((_, column) => {
      const perks = columnShares(data, column).flatMap(({ hash, share }) => {
        const perkIndex = indexIn(column, hash);
        return perkIndex === undefined ? [] : [{ perkIndex, share }];
      });
      return perks.length > 0 ? [{ column, perks }] : [];
    });
    const traits = traitColumns(weapon.columns);
    const combos = traits
      ? comboShares(data).flatMap(({ left, right, share }) => {
          const l = indexIn(traits[0], left);
          const r = indexIn(traits[1], right);
          return l === undefined || r === undefined
            ? []
            : [{ leftColumn: traits[0], left: l, rightColumn: traits[1], right: r, share }];
        })
      : [];
    const topRoll: Roll = {};
    for (const { column, perks } of columns) topRoll[column] = perks[0]!.perkIndex;
    return {
      available: true,
      copies: data.copies,
      generatedAt: index?.generatedAt,
      columns,
      combos,
      topRoll,
    };
  }, [index, weapon, catalog]);
}
