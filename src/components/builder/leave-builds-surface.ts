import { createContext, useContext } from "react";

/**
 * Run `then` once the builds are out of the way: on desktop straight away; on phones,
 * after the builds sheet has closed (BuildsSurface provides that). For anything in the
 * builds list that points at the page behind it.
 */
const LeaveBuildsSurface = createContext<(then: () => void) => void>((then) => then());

export const LeaveBuildsSurfaceProvider = LeaveBuildsSurface.Provider;

export function useLeaveBuildsSurface(): (then: () => void) => void {
  return useContext(LeaveBuildsSurface);
}
