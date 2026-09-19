"use client";

import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/lib/auth/use-session";
import { toast } from "@/lib/toast";
import {
  LOADOUT_SCHEMA_VERSION,
  editLoadoutTag,
  newerSavedLoadout,
  parseSavedLoadout,
  withLoadoutTag,
  type SavedLoadout,
  type SavedLoadoutData,
  type TagEditResult,
} from "./types";

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

/**
 * In-flight tag writes, per loadout id: the promise the next write chains behind,
 * and how many are still queued. Module-level on purpose — `LoadoutsList` unmounts
 * whenever the mobile drawer closes or the sidebar breakpoint flips, and a chain
 * that resets there would let two PUTs for the same row interleave. Entries are
 * dropped once a row's queue drains.
 */
const tagChain = new Map<string, Promise<void>>();
const tagPending = new Map<string, number>();

function writeData(saved: SavedLoadout, loadout = saved.loadout): SavedLoadoutData {
  return {
    version: LOADOUT_SCHEMA_VERSION,
    loadout,
    ...(saved.optimizer ? { optimizer: saved.optimizer } : {}),
    ...(saved.builder ? { builder: saved.builder } : {}),
    ...(saved.modPlacement ? { modPlacement: saved.modPlacement } : {}),
  };
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
    { id: string; data: SavedLoadoutData; skipCache?: boolean }
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
    onSuccess: (saved, { skipCache }) => {
      if (skipCache) return;
      patchList((list) =>
        list.map((l) => (l.id === saved.id ? newerSavedLoadout(l, saved) : l)),
      );
    },
  });

  const remove = useMutation<void, LoadoutsApiError, string>({
    mutationFn: async (id) => {
      await api(`/api/loadouts/${id}`, { method: "DELETE" });
    },
    onSuccess: (_, id) => patchList((list) => list.filter((l) => l.id !== id)),
  });

  const updateMutateAsync = update.mutateAsync;

  /**
   * Toggle a hashtag on one loadout. Applies the edit to the cached row immediately,
   * then serializes PUTs per id — each request is rebuilt from the cache at send time
   * so an earlier tag response cannot drop tags that landed while it was in flight.
   * Ordinary `update.mutate` can still run concurrently; a response never replaces a
   * cached row with a later `updatedAt`. Refusals are synchronous; the caller toasts.
   */
  const setTag = useCallback(
    (id: string, tag: string, present: boolean): TagEditResult => {
      const current = queryClient
        .getQueryData<SavedLoadout[]>(LOADOUTS_QUERY_KEY)
        ?.find((l) => l.id === id);
      if (!current) return { status: "unchanged" };
      const result = editLoadoutTag(current.loadout, tag, present);
      if (result.status !== "applied") return result;

      queryClient.setQueryData<SavedLoadout[]>(LOADOUTS_QUERY_KEY, (list) =>
        list?.map((l) => (l.id === id ? { ...l, loadout: result.loadout } : l)),
      );
      tagPending.set(id, (tagPending.get(id) ?? 0) + 1);

      const run = async () => {
        let saved: SavedLoadout | undefined;
        let failed = false;
        try {
          const latest = queryClient
            .getQueryData<SavedLoadout[]>(LOADOUTS_QUERY_KEY)
            ?.find((l) => l.id === id);
          if (latest) {
            const loadout = withLoadoutTag(latest.loadout, tag, present);
            saved = await updateMutateAsync({
              id,
              data: writeData(latest, loadout),
              skipCache: true,
            });
          }
        } catch (err) {
          failed = true;
          const apiErr = err as LoadoutsApiError;
          toast.error(
            apiErr.notConfigured
              ? "Loadout storage isn't configured — set DATABASE_URL"
              : apiErr.message,
          );
        } finally {
          // Every exit decrements, including the one where the row went away —
          // a counter stuck above zero would silence the reconcile below for good.
          const left = (tagPending.get(id) ?? 1) - 1;
          if (left > 0) tagPending.set(id, left);
          else tagPending.delete(id);
          // Only the last queued write reconciles: an earlier response would
          // otherwise undo tags that landed while it was in flight.
          if (left <= 0) {
            if (saved) {
              const done = saved;
              queryClient.setQueryData<SavedLoadout[]>(LOADOUTS_QUERY_KEY, (list) =>
                list?.map((l) => (l.id === done.id ? newerSavedLoadout(l, done) : l)),
              );
            } else if (failed) {
              await queryClient.invalidateQueries({ queryKey: LOADOUTS_QUERY_KEY });
            }
          }
        }
      };
      const settle = () => {
        if ((tagPending.get(id) ?? 0) <= 0) tagChain.delete(id);
      };
      const prev = tagChain.get(id) ?? Promise.resolve();
      tagChain.set(id, prev.then(run, run).then(settle, settle));
      return result;
    },
    [queryClient, updateMutateAsync],
  );

  return { create, update, remove, setTag };
}
