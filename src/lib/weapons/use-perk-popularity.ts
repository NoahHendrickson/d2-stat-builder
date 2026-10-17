"use client";

import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  PERK_POPULARITY_URL,
  columnShares,
  copiesSeen,
  type PerkPopularityIndex,
  type PopularityMode,
  type WeaponPopularity,
} from "./perk-popularity";
import type { WeaponCatalog } from "./catalog";
import type { WeaponSummary } from "./types";

/**
 * The popularity snapshot. In development it's the local crawler output
 * (public/dev-data, git-ignored); otherwise the published copy on GitHub Pages,
 * so Vercel never serves it. Optional: if it can't load, the weapon page just
 * goes without popularity.
 */
export function usePerkPopularityIndex() {
  return useQuery({
    queryKey: ["perk-popularity"],
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    queryFn: async ({ signal }) => {
      const url =
        process.env.NODE_ENV === "development"
          ? "/dev-data/perk-popularity.json"
          : PERK_POPULARITY_URL;
      const response = await fetch(url, { signal });
      if (!response.ok)
        throw new Error(`Perk popularity could not be loaded (${response.status}).`);
      const data = (await response.json()) as PerkPopularityIndex;
      if (data.schema !== 1 || typeof data.weapons !== "object")
        throw new Error("The perk popularity snapshot is incomplete.");
      return data;
    },
  });
}

export type PopularityView = PopularityMode | "all";

/**
 * Whether popularity is showing, and for which mode: one choice for the whole
 * page, so it stays as the user moves from weapon to weapon (and between the
 * pane and the dialog). Not saved across visits.
 */
let shown = false;
let mode: PopularityView = "pve";
const listeners = new Set<() => void>();
const snapshot = () => `${shown}:${mode}`;
function set(next: { shown?: boolean; mode?: PopularityView }) {
  shown = next.shown ?? shown;
  mode = next.mode ?? mode;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export interface WeaponPopularityView {
  /** The snapshot has this weapon. */
  available: boolean;
  shown: boolean;
  mode: PopularityView;
  setShown: (shown: boolean) => void;
  setMode: (mode: PopularityView) => void;
  /** Copies seen in the current mode. */
  copies: number;
  /** When the snapshot was taken, and the span of matches it sampled. */
  generatedAt?: string;
  /** A perk's share of its column (0–1), or undefined when the column has no data. */
  share: (column: number, perkIndex: number) => number | undefined;
  /** The most run perk in the column (ties: every one of them). */
  isTop: (column: number, perkIndex: number) => boolean;
  /** The most run perk in each column with data: column → catalog perk index. */
  topRoll: () => Record<number, number>;
}

/** Popularity for one weapon, as the perk grid reads it. */
export function useWeaponPopularity(
  weapon: WeaponSummary,
  catalog: WeaponCatalog,
): WeaponPopularityView {
  useSyncExternalStore(subscribe, snapshot, () => "false:pve");
  const index = usePerkPopularityIndex().data;
  const data: WeaponPopularity | undefined = index?.weapons[weapon.hash];

  // Per column: catalog perk index → share, and the top share.
  const columns = weapon.columns.map((column, i) => {
    const shares = new Map<number, number>();
    if (!data) return { shares, top: 0 };
    const byHash = new Map(columnShares(data, i, mode).map((s) => [s.hash, s.share]));
    if (byHash.size === 0) return { shares, top: 0 };
    for (const perkIndex of column.perkIndices) {
      const hash = catalog.perks[perkIndex]?.hash;
      if (hash !== undefined) shares.set(perkIndex, byHash.get(hash) ?? 0);
    }
    return { shares, top: Math.max(0, ...shares.values()) };
  });

  return {
    available: !!data && copiesSeen(data, "all") > 0,
    shown,
    mode,
    setShown: (next) => set({ shown: next }),
    setMode: (next) => set({ mode: next }),
    copies: data ? copiesSeen(data, mode) : 0,
    generatedAt: index?.generatedAt,
    share: (column, perkIndex) => columns[column]?.shares.get(perkIndex),
    isTop: (column, perkIndex) => {
      const c = columns[column];
      return !!c && c.top > 0 && c.shares.get(perkIndex) === c.top;
    },
    topRoll: () => {
      const roll: Record<number, number> = {};
      columns.forEach((c, column) => {
        for (const [perkIndex, share] of c.shares)
          if (c.top > 0 && share === c.top && roll[column] === undefined) roll[column] = perkIndex;
      });
      return roll;
    },
  };
}
