/**
 * The fewest owned pieces a set needs to stay in the list. The hide-below-N options
 * nest (hiding under 4 also hides under 2), so they're one threshold, not a flag each.
 */
export type SetMinOwned = 0 | 2 | 4;

export interface SetFilters {
  minOwned: SetMinOwned;
}

export const DEFAULT_SET_FILTERS: SetFilters = {
  minOwned: 2,
};

export function isSetMinOwned(v: unknown): v is SetMinOwned {
  return v === 0 || v === 2 || v === 4;
}

/** Whether the list settings are currently hiding any sets. */
export function hasActiveSetFilters(filters: SetFilters): boolean {
  return filters.minOwned > 0;
}

/** Returns whether a set with `ownedCount` pieces passes the active list settings. */
export function passesSetFilters(ownedCount: number, filters: SetFilters): boolean {
  return ownedCount >= filters.minOwned;
}
