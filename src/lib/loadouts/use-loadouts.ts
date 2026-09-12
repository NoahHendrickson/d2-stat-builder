"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/lib/auth/use-session";
import { parseSavedLoadout, type SavedLoadout, type SavedLoadoutData } from "./types";

export const LOADOUTS_QUERY_KEY = ["loadouts"] as const;

/** A failed /api/loadouts call, carrying the HTTP status (503 = storage not configured). */
export class LoadoutsApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "LoadoutsApiError";
  }
  get notConfigured() {
    return this.status === 503;
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    cache: "no-store",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => null)) as
    | ({ error?: string } & Record<string, unknown>)
    | null;
  if (!res.ok) {
    throw new LoadoutsApiError(res.status, body?.error ?? `Request failed (${res.status})`);
  }
  return body as T;
}

/** The signed-in player's saved loadouts, newest-edited first. */
export function useLoadouts() {
  const session = useSession();
  return useQuery<SavedLoadout[], LoadoutsApiError>({
    queryKey: LOADOUTS_QUERY_KEY,
    enabled: session.data?.authenticated === true,
    staleTime: 60_000,
    // A 503 (not configured) or 401 can't be fixed by retrying.
    retry: (count, err) => err.status >= 500 && err.status !== 503 && count < 2,
    queryFn: async () => {
      const { loadouts } = await api<{ loadouts: unknown[] }>("/api/loadouts");
      return loadouts
        .map(parseSavedLoadout)
        .filter((l): l is SavedLoadout => l !== null);
    },
  });
}

/**
 * Create / update / delete. Each writes the server's response straight into the cached
 * list instead of invalidating it: the row that came back is authoritative, and a
 * refetch of the whole list (which grows with every save) after every edit would be a
 * full-list re-render for nothing.
 */
export function useLoadoutMutations() {
  const queryClient = useQueryClient();
  const patchList = (fn: (list: SavedLoadout[]) => SavedLoadout[]) =>
    queryClient.setQueryData<SavedLoadout[]>(LOADOUTS_QUERY_KEY, (list) =>
      list ? fn(list) : list,
    );

  const create = useMutation<SavedLoadout, LoadoutsApiError, SavedLoadoutData>({
    mutationFn: async (data) => {
      const { loadout } = await api<{ loadout: unknown }>("/api/loadouts", {
        method: "POST",
        body: JSON.stringify(data),
      });
      const parsed = parseSavedLoadout(loadout);
      if (!parsed) throw new LoadoutsApiError(500, "Server returned an unreadable loadout");
      return parsed;
    },
    onSuccess: (saved) => patchList((list) => [saved, ...list]),
  });

  const update = useMutation<
    SavedLoadout,
    LoadoutsApiError,
    { id: string; data: SavedLoadoutData }
  >({
    mutationFn: async ({ id, data }) => {
      const { loadout } = await api<{ loadout: unknown }>(`/api/loadouts/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      });
      const parsed = parseSavedLoadout(loadout);
      if (!parsed) throw new LoadoutsApiError(500, "Server returned an unreadable loadout");
      return parsed;
    },
    onSuccess: (saved) => patchList((list) => list.map((l) => (l.id === saved.id ? saved : l))),
  });

  const remove = useMutation<void, LoadoutsApiError, string>({
    mutationFn: async (id) => {
      await api(`/api/loadouts/${id}`, { method: "DELETE" });
    },
    onSuccess: (_, id) => patchList((list) => list.filter((l) => l.id !== id)),
  });

  return { create, update, remove };
}
