"use client";

import { useQuery } from "@tanstack/react-query";

/**
 * A JSON snapshot fetched once and kept for the session (the weapon catalog,
 * boss DPS, perk popularity, Clarity's insights). `parse` checks what arrived
 * and shapes it, throwing if it isn't usable; a failed fetch or parse leaves
 * the query in error, and callers that treat the data as optional go without.
 * Returns the query, so callers choose between `.data` and the loading state.
 */
export function useStaticJson<T>({
  key,
  url,
  what,
  parse,
  retry = 3,
  revalidateInDev = false,
}: {
  key: string;
  url: string;
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
}) {
  return useQuery({
    queryKey: [key],
    staleTime: Infinity,
    gcTime: Infinity,
    retry,
    queryFn: async ({ signal }) => {
      const response = await fetch(url, {
        signal,
        cache: revalidateInDev && process.env.NODE_ENV === "development" ? "no-cache" : "default",
      });
      if (!response.ok) throw new Error(`${what} could not be loaded (${response.status}).`);
      return parse(await response.json());
    },
  });
}
