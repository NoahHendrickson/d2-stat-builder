export interface SetFilters {
  hideLessThan2: boolean;
  hideZero: boolean;
}

export const DEFAULT_SET_FILTERS: SetFilters = {
  hideZero: true,
  hideLessThan2: true,
};

const SET_FILTER_KEYS = [
  "hideZero",
  "hideLessThan2",
] as const satisfies readonly (keyof SetFilters)[];

export function countActiveSetFilters(filters: SetFilters): number {
  return SET_FILTER_KEYS.reduce((count, key) => count + Number(filters[key]), 0);
}

export function hasActiveSetFilters(filters: SetFilters): boolean {
  return countActiveSetFilters(filters) > 0;
}

/** Returns whether a set with `ownedCount` pieces passes the active list settings. */
export function passesSetFilters(ownedCount: number, filters: SetFilters): boolean {
  if (filters.hideLessThan2 && ownedCount < 2) return false;
  if (filters.hideZero && ownedCount === 0) return false;
  return true;
}
