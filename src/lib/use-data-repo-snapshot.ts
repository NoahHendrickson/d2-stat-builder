"use client";

import { dataRepoUrl } from "./data-repo";
import { useStaticJson } from "./use-static-json";

/**
 * A data repo snapshot (data-repo.ts). In development it's the local
 * crawler or merge output in public/dev-data (git-ignored) when there is a
 * usable one, else the published copy, which is all production reads.
 * Optional: if it can't load, its feature just goes without, so it isn't
 * retried. `isValid` checks the shape (its schema) before it's used.
 */
export function useDataRepoSnapshot<T>({
  file,
  what,
  isValid,
}: {
  file: string;
  /** For messages: "<what> could not be loaded". */
  what: string;
  isValid: (data: T) => boolean;
}) {
  return useStaticJson({
    key: `data-repo:${file}`,
    urls: process.env.NODE_ENV === "development" ? [`/dev-data/${file}`, dataRepoUrl(file)] : [dataRepoUrl(file)],
    what,
    retry: false,
    // The data repo rebuilds it several times a day.
    staleTime: 60 * 60_000,
    parse: (json) => {
      const data = json as T;
      if (!data || !isValid(data)) throw new Error(`The ${what.toLowerCase()} snapshot is incomplete.`);
      return data;
    },
  });
}
