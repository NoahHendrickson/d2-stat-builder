"use client";

import { useDataRepoSnapshot } from "@/lib/use-data-repo-snapshot";
import { ARMOR_SET_POPULARITY_FILE, type ArmorSetPopularity } from "./set-popularity";

/** The armor set popularity snapshot; fetched when the dialog first opens. */
export function useSetPopularity() {
  return useDataRepoSnapshot<ArmorSetPopularity>({
    file: ARMOR_SET_POPULARITY_FILE,
    what: "Set popularity",
    isValid: (data) => data.schema === 1 && typeof data.buckets === "object",
  });
}
