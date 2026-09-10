"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useHydrated } from "@/lib/use-hydrated";

export interface SessionUser {
  membershipId: string;
  destinyMembershipId?: string;
  destinyMembershipType?: number;
  displayName?: string;
  /** Relative Bungie.net profile avatar path (e.g. `/img/profile/avatars/cc13.jpg`). */
  iconPath?: string;
}

export interface SessionState {
  authenticated: boolean;
  user?: SessionUser;
}

/** What every consumer sees on the server and in the hydrating render: not known yet. */
const HYDRATING = {
  data: undefined,
  error: null,
  status: "pending",
  fetchStatus: "fetching",
  isPending: true,
  isLoading: true,
  isFetching: true,
  isSuccess: false,
  isError: false,
} as const;

/**
 * Current auth session. The access token stays server-side.
 *
 * Reports "loading" until hydration is over. The root layout's session query can
 * resolve before a route segment hydrates (the page is prerendered and hydrates
 * separately under Cache Components), and a segment that then rendered the signed-in
 * or signed-out branch during hydration would not match the server's loading HTML —
 * React throws the tree away and rebuilds it. One extra render per consumer after
 * hydration is the price.
 */
export function useSession(): UseQueryResult<SessionState> {
  const query = useQuery<SessionState>({
    queryKey: ["session"],
    queryFn: async () => {
      const res = await fetch("/api/auth/session", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load session");
      return (await res.json()) as SessionState;
    },
    staleTime: 5 * 60_000,
  });
  const hydrated = useHydrated();
  if (hydrated) return query;
  return { ...query, ...HYDRATING } as unknown as UseQueryResult<SessionState>;
}
