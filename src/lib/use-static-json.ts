"use client";

import { useQuery } from "@tanstack/react-query";

/**
 * A JSON snapshot fetched once and kept for the session, or for `staleTime`
 * (the weapon catalog, boss DPS, perk popularity, Clarity's insights). `parse`
 * checks what arrived and shapes it, throwing if it isn't usable; a failed
 * fetch or parse leaves the query in error, and callers that treat the data as
 * optional go without.
 * Returns the query, so callers choose between `.data` and the loading state.
 */
export function useStaticJson<T>({
  key,
  urls,
  what,
  parse,
  retry = 3,
  revalidateInDev = false,
  staleTime = Infinity,
}: {
  key: string;
  /**
   * Tried in order: one that is missing (404) or that `parse` rejects moves on
   * to the next, with a warning naming which one was used instead. The last
   * one's failure is the query's error.
   */
  urls: readonly string[];
  /** For the error message: "<what> could not be loaded (404)." */
  what: string;
  parse: (json: unknown) => T;
  retry?: number | false;
  /**
   * Our own committed snapshots: a hard reload doesn't reach fetches made after
   * load, so in dev revalidate every time, and a regenerated file shows up on
   * the next reload.
   */
  revalidateInDev?: boolean;
  /**
   * How long a load stays current (ms). Kept for the session by default; a
   * snapshot rebuilt during the day sets one, so an open tab picks up the new
   * copy on its next focus or mount after that.
   */
  staleTime?: number;
}) {
  return useQuery({
    queryKey: [key],
    staleTime,
    gcTime: Infinity,
    // The app turns focus refetches off; a snapshot that goes stale wants them back.
    refetchOnWindowFocus: staleTime !== Infinity,
    retry,
    queryFn: async ({ signal }) => {
      const cache = revalidateInDev && process.env.NODE_ENV === "development" ? "no-cache" : "default";
      for (const [i, url] of urls.entries()) {
        const last = i === urls.length - 1;
        const response = await fetch(url, { signal, cache });
        if (response.status === 404 && !last) {
          console.warn(`${what}: ${url} is missing; using ${urls[i + 1]} instead.`);
          continue;
        }
        if (!response.ok) throw new Error(`${what} could not be loaded (${response.status}).`);
        try {
          return parse(await response.json());
        } catch (error) {
          if (last) throw error;
          console.warn(`${what}: ${url} is unusable; using ${urls[i + 1]} instead.`, error);
        }
      }
      throw new Error(`${what} has nowhere to load from.`);
    },
  });
}
