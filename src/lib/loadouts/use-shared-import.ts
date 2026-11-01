"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import { shareSourceFrom } from "./share";
import { fetchShare, type ShareFetchError } from "./share-client";
import type { SavedLoadoutData } from "./types";

// Survives the loadouts list remounting (leaving the page and coming back), so a
// dismissed share link stays dismissed.
let dismissedKey: string | null = null;

// Share links ride in the URL fragment, which useSearchParams doesn't see.
function subscribeHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}
const readHash = () => window.location.hash;
const noHash = () => "";

/**
 * The share link the loadouts page was opened with, to offer saving a copy. `key`
 * names the link; `data` is its loadout, null until a short link's loadout arrives and
 * after `dismiss()`, which also takes the link out of the URL. A short link that
 * doesn't open says why in a toast. One that can never open (unknown or unreadable) is
 * dismissed; one that failed for now (offline, server error) stays in the URL, so
 * reloading tries again.
 */
export function useSharedImport() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const hash = useSyncExternalStore(subscribeHash, readHash, noHash);
  const source = useMemo(() => shareSourceFrom(hash, searchParams), [hash, searchParams]);
  const key = source?.key ?? null;
  const code = source?.kind === "code" ? source.code : null;
  const shared = useQuery<SavedLoadoutData, ShareFetchError>({
    queryKey: ["loadout-share", code],
    enabled: code !== null,
    queryFn: () => fetchShare(code!),
    staleTime: Infinity,
    retry: (count, err) => err.retryable && count < 2,
  });
  const [dismissed, setDismissed] = useState(() => dismissedKey);

  // Takes the link out of the URL, and keeps it dismissed if the list remounts.
  const forget = useCallback(() => {
    dismissedKey = key;
    router.replace(pathname);
  }, [key, router, pathname]);
  const dismiss = useCallback(() => {
    forget();
    setDismissed(key); // hide the drawer now, before the URL change lands
  }, [forget, key]);

  // A short link that didn't open has no loadout to hide, so this only says why.
  useEffect(() => {
    if (!shared.error || key === dismissedKey) return;
    toast.error(shared.error.message);
    if (shared.error.kind !== "unavailable") forget();
  }, [shared.error, key, forget]);

  const data =
    !source || key === dismissed
      ? null
      : source.kind === "inline"
        ? source.data
        : (shared.data ?? null);
  return { key, data, dismiss };
}
