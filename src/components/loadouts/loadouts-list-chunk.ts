import type { LoadoutsList } from "./loadouts-list";

let loaded: typeof LoadoutsList | undefined;

/**
 * Fetch the loadouts list's chunk (rows, editor drawer, apply flow). The bundler
 * fetches it once however often this is called, and importing has no side effects.
 */
export function loadLoadoutsList(): Promise<typeof LoadoutsList> {
  return import("./loadouts-list").then((m) => (loaded = m.LoadoutsList));
}

/** The list component, if its chunk is already in. */
export function loadedLoadoutsList(): typeof LoadoutsList | undefined {
  return loaded;
}
