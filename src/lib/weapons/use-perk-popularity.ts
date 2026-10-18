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
import { mostPopularRoll, type WeaponPopularityView } from "./popularity-view";
import type { WeaponSummary } from "./types";

/**
 * The popularity snapshot. In development it's the local crawler output
 * (public/dev-data, git-ignored) when there is a usable one, else the published
 * copy on GitHub Pages, which is all production reads, so Vercel never serves
 * it. Optional: if it can't load, the weapon page just goes without popularity.
 */
export function usePerkPopularityIndex() {
  return useStaticJson({
    key: "perk-popularity",
    urls:
      process.env.NODE_ENV === "development"
        ? ["/dev-data/perk-popularity.json", PERK_POPULARITY_URL]
        : [PERK_POPULARITY_URL],
    what: "Perk popularity",
    retry: false,
    // The data repo rebuilds it several times a day.
    staleTime: 60 * 60_000,
    parse: (json) => {
      const data = json as PerkPopularityIndex;
      if (data?.schema !== 2 || typeof data.weapons !== "object")
        throw new Error("The perk popularity snapshot is incomplete.");
      return data;
    },
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
    return {
      available: true,
      copies: data.copies,
      generatedAt: index?.generatedAt,
      columns,
      combos,
      topRoll: mostPopularRoll(columns, combos),
    };
  }, [index, weapon, catalog]);
}
