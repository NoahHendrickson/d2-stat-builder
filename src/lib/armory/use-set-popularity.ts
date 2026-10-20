"use client";

import { useStaticJson } from "@/lib/use-static-json";
import { ARMOR_SET_POPULARITY_URL, type ArmorSetPopularity } from "./set-popularity";

/**
 * The armor set popularity snapshot. In development it's the local merge's
 * output (public/dev-data, git-ignored) when there is one, else the published
 * copy on GitHub Pages, which is all production reads, so Vercel never serves
 * it. Fetched when the dialog first opens.
 */
export function useSetPopularity() {
  return useStaticJson({
    key: "armor-set-popularity",
    urls:
      process.env.NODE_ENV === "development"
        ? ["/dev-data/armor-set-popularity.json", ARMOR_SET_POPULARITY_URL]
        : [ARMOR_SET_POPULARITY_URL],
    what: "Set popularity",
    retry: false,
    // The data repo rebuilds it several times a day.
    staleTime: 60 * 60_000,
    parse: (json) => {
      const data = json as ArmorSetPopularity;
      if (data?.schema !== 1 || typeof data.buckets !== "object")
        throw new Error("The set popularity snapshot is incomplete.");
      return data;
    },
  });
}
