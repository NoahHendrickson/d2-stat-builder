"use client";

import { useEffect, useMemo } from "react";
import { useProfile } from "@/lib/armory/use-profile";
import { useManifest } from "@/lib/manifest/use-manifest";
import { useStoreValue } from "@/lib/value-store";
import { loadAnnotations } from "./annotations";
import { deriveInventory, type ManagerInventory } from "./build";
import { applyLocks, lockOps, settledLocks } from "./lock-queue";
import { moveOps } from "./move-queue";
import { applyMoves, settledOps } from "./moves";

/**
 * The whole account laid out for the manager: characters, vault, postmaster, and
 * account-wide inventories, with the moves and lock changes still in flight (or not yet
 * reflected by Bungie's profile) applied on top. Derived from the same profile query
 * the armory uses, so a refetch anywhere refreshes this too. Also points the tag and
 * notes store at the signed-in account.
 */
export function useInventory() {
  const { query: profile, membershipId } = useProfile();
  const manifestStatus = useManifest();
  const manifest = manifestStatus.state === "ready" ? manifestStatus.manifest : undefined;
  const base = useMemo<ManagerInventory | undefined>(
    () => (profile.data && manifest ? deriveInventory(profile.data, manifest) : undefined),
    [profile.data, manifest],
  );

  useEffect(() => loadAnnotations(membershipId), [membershipId]);

  // A new profile: forget the finished moves and locks it already shows.
  useEffect(() => {
    if (!base) return;
    const now = Date.now();
    const settled = settledOps(base, moveOps.get(), now);
    if (settled.size > 0) moveOps.set(moveOps.get().filter((o) => !settled.has(o.id)));
    const locks = settledLocks(base, lockOps.get(), now);
    if (locks.size > 0) lockOps.set(lockOps.get().filter((o) => !locks.has(o.id)));
  }, [base]);

  const ops = useStoreValue(moveOps);
  const locks = useStoreValue(lockOps);
  const data = useMemo(
    () => (base ? applyLocks(applyMoves(base, ops), locks) : undefined),
    [base, ops, locks],
  );
  return { data, profile, manifestStatus, membershipId };
}
