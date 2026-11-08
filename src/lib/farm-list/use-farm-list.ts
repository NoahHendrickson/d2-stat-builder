"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/lib/auth/use-session";
import { sessionMembershipId } from "@/lib/armory/use-profile";
import { parseFarmEntry, type FarmEntry, type FarmEntryData, type FarmPatch } from "./types";

/** Per account, so a different sign-in on this browser never sees the last one's list. */
export const farmListKey = (membershipId: string | undefined) => ["farm-list", membershipId] as const;

/** A failed /api/farm-list call, carrying the HTTP status (503 = storage not configured). */
export class FarmListApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "FarmListApiError";
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    cache: "no-store",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => null)) as ({ error?: string } & Record<string, unknown>) | null;
  if (!res.ok) throw new FarmListApiError(res.status, body?.error ?? `Request failed (${res.status})`);
  return body as T;
}

function readEntry(raw: unknown): FarmEntry {
  const entry = parseFarmEntry(raw);
  if (!entry) throw new FarmListApiError(500, "Server returned an unreadable entry");
  return entry;
}

/** The signed-in player's entries, newest first; undefined data while signed out. */
export function useFarmList() {
  const membershipId = sessionMembershipId(useSession().data);
  return useQuery<FarmEntry[], FarmListApiError>({
    queryKey: farmListKey(membershipId),
    enabled: membershipId !== undefined,
    staleTime: 60_000,
    retry: (count, err) => err.status >= 500 && err.status !== 503 && count < 2,
    queryFn: async () => {
      const { entries } = await api<{ entries: unknown[] }>("/api/farm-list");
      return entries.map(parseFarmEntry).filter((w): w is FarmEntry => w !== null);
    },
  });
}

/** Obtained entries the player hasn't looked at yet: the sidebar's count. */
export function useUnseenFarmDrops(): number {
  const { data } = useFarmList();
  return data?.filter((w) => w.obtained && !w.obtained.seen).length ?? 0;
}

/**
 * Add / patch / remove / mark seen. Each writes the server's answer into the cached list
 * rather than refetching it, as the loadouts mutations do.
 */
export function useFarmListMutations() {
  const queryClient = useQueryClient();
  const membershipId = sessionMembershipId(useSession().data);
  const key = farmListKey(membershipId);
  const patchList = (fn: (list: FarmEntry[]) => FarmEntry[]) =>
    queryClient.setQueryData<FarmEntry[]>(key, (list) => (list ? fn(list) : list));
  const replace = (entry: FarmEntry) => patchList((list) => list.map((w) => (w.id === entry.id ? entry : w)));

  const add = useMutation<FarmEntry, FarmListApiError, FarmEntryData>({
    mutationFn: async (data) =>
      readEntry((await api<{ entry: unknown }>("/api/farm-list", { method: "POST", body: JSON.stringify(data) })).entry),
    onSuccess: (entry) => patchList((list) => [entry, ...list]),
  });

  const patch = useMutation<FarmEntry, FarmListApiError, { id: string; patch: FarmPatch }>({
    mutationFn: async ({ id, patch }) =>
      readEntry(
        (await api<{ entry: unknown }>(`/api/farm-list/${id}`, { method: "PATCH", body: JSON.stringify(patch) }))
          .entry,
      ),
    onSuccess: replace,
  });

  const remove = useMutation<void, FarmListApiError, string>({
    mutationFn: async (id) => {
      await api(`/api/farm-list/${id}`, { method: "DELETE" });
    },
    onSuccess: (_, id) => patchList((list) => list.filter((w) => w.id !== id)),
  });

  const markSeen = useMutation<void, FarmListApiError, void>({
    mutationFn: async () => {
      await api("/api/farm-list", { method: "PATCH", body: JSON.stringify({ seen: true }) });
    },
    onSuccess: () =>
      patchList((list) =>
        list.map((w) => (w.obtained && !w.obtained.seen ? { ...w, obtained: { ...w.obtained, seen: true } } : w)),
      ),
  });

  return { add, patch, remove, markSeen };
}
