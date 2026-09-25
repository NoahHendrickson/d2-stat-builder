export interface SetFilters {
  hideLessThan2: boolean;
}

export const DEFAULT_SET_FILTERS: SetFilters = {
  hideLessThan2: true,
};

/** Whether the list settings are currently hiding any sets. */
export function hasActiveSetFilters(filters: SetFilters): boolean {
  return filters.hideLessThan2;
}

/** Returns whether a set with `ownedCount` pieces passes the active list settings. */
export function passesSetFilters(ownedCount: number, filters: SetFilters): boolean {
  return !(filters.hideLessThan2 && ownedCount < 2);
}
