"use client";

import { useQuery } from "@tanstack/react-query";
import { CLARITY_URL, type ClarityMap } from "./clarity";

/** Clarity's perk insights; the tooltips fall back to Bungie's text until (or if never) loaded. */
export function useClarity() {
  return useQuery({
    queryKey: ["clarity"],
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
    queryFn: async ({ signal }) => {
      const response = await fetch(CLARITY_URL, { signal });
      if (!response.ok)
        throw new Error(
          `Clarity insights could not be loaded (${response.status}).`,
        );
      return (await response.json()) as ClarityMap;
    },
  }).data;
}
