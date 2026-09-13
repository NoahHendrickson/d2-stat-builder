import type { ArmorSetInfo } from "./sets";

/** Orderings for the set-bonus list. `owned-desc` is the list's natural order. */
export const SET_SORT_OPTIONS = [
  { key: "owned-desc", label: "Most pieces owned" },
  { key: "owned-asc", label: "Fewest pieces owned" },
  { key: "name-asc", label: "Name A–Z" },
  { key: "name-desc", label: "Name Z–A" },
] as const;

export type SetSortKey = (typeof SET_SORT_OPTIONS)[number]["key"];

export const DEFAULT_SET_SORT: SetSortKey = "owned-desc";

export function setSortLabel(key: SetSortKey): string {
  return SET_SORT_OPTIONS.find((o) => o.key === key)?.label ?? key;
}

/** Stable sort of `sets` by `key`; ties fall back to name, then owned count. */
export function sortSets<T extends Pick<ArmorSetInfo, "name" | "ownedCount">>(
  sets: readonly T[],
  key: SetSortKey,
): T[] {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name);
  const byOwned = (a: T, b: T) => b.ownedCount - a.ownedCount;
  const cmp: (a: T, b: T) => number = (() => {
    switch (key) {
      case "owned-desc":
        return (a, b) => byOwned(a, b) || byName(a, b);
      case "owned-asc":
        return (a, b) => -byOwned(a, b) || byName(a, b);
      case "name-asc":
        return (a, b) => byName(a, b) || byOwned(a, b);
      case "name-desc":
        return (a, b) => -byName(a, b) || byOwned(a, b);
      default: {
        const _exhaustive: never = key;
        return _exhaustive;
      }
    }
  })();
  return [...sets].sort(cmp);
}
