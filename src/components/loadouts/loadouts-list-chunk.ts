import type { LoadoutsPage } from "./loadouts-page";

let loaded: typeof LoadoutsPage | undefined;

/**
 * Fetch the loadouts page's chunk (rows, editor drawer, apply flow). The bundler
 * fetches it once however often this is called, and importing has no side effects.
 */
export function loadLoadoutsList(): Promise<typeof LoadoutsPage> {
  return import("./loadouts-page").then((m) => (loaded = m.LoadoutsPage));
}

/** The page component, if its chunk is already in. */
export function loadedLoadoutsList(): typeof LoadoutsPage | undefined {
  return loaded;
}
