"use client";

import { useStaticJson } from "@/lib/use-static-json";
import { CLARITY_URL, type ClarityMap } from "./clarity";

/** Clarity's perk insights; the tooltips fall back to Bungie's text until (or if never) loaded. */
export function useClarity() {
  return useStaticJson({
    key: "clarity",
    url: CLARITY_URL,
    what: "Clarity insights",
    retry: 1,
    parse: (json) => json as ClarityMap,
  });
}
