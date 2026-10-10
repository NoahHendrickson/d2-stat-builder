"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/lib/auth/use-session";
import type { StoredSettings } from "@/lib/settings/keys";
import {
  flushSettingPushes,
  getSetting,
  reconcileSettings,
  setSyncAccount,
} from "@/lib/settings/synced-settings";

/**
 * Keeps the account-synced settings (links, pinned sets) in step with the signed-in
 * account: pulls on load and whenever the window regains focus, so switching back
 * from another computer picks up what changed there. Renders nothing.
 */
export function SettingsSync() {
  const session = useSession();
  const membershipId =
    session.data?.authenticated === true ? (session.data.user?.membershipId ?? null) : null;
  const signedOut = session.isSuccess && !membershipId;

  const query = useQuery<StoredSettings>({
    queryKey: ["settings", membershipId],
    enabled: membershipId !== null,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    // 503 (storage not configured) and 401 won't change by retrying.
    retry: false,
    queryFn: async () => {
      const res = await fetch("/api/settings", { cache: "no-store" });
      if (!res.ok) throw new Error(`Settings request failed (${res.status})`);
      const { settings } = (await res.json()) as { settings: StoredSettings };
      return settings;
    },
  });

  // Reading the pins copies them out of the builder's old selections blob. Do it on
  // load: "Optimize" on a loadout rewrites that blob, and could otherwise run first.
  useEffect(() => {
    getSetting("pinnedSets");
  }, []);

  useEffect(() => {
    if (signedOut) setSyncAccount(null);
  }, [signedOut]);

  // Keyed on the fetch time, not the data: an unchanged response still has to retry
  // pushes that failed last time.
  const { data, dataUpdatedAt } = query;
  useEffect(() => {
    if (membershipId && data) void reconcileSettings(membershipId, data);
  }, [membershipId, data, dataUpdatedAt]);

  useEffect(() => {
    window.addEventListener("pagehide", flushSettingPushes);
    return () => window.removeEventListener("pagehide", flushSettingPushes);
  }, []);

  return null;
}
