"use client";

import { useSyncExternalStore } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import { handleSessionExpired } from "@/lib/auth/sign-out";
import type { Armory } from "@/lib/armory/fetch";
import type { RefreshResult } from "@/lib/armory/use-armory";
import type { Manifest } from "@/lib/manifest/load";
import { defaultIdentifiers, type InGameLoadoutsResponse } from "@/lib/bungie/ingame-loadouts";
import type { ActivitySet } from "./activity-sets";
import { applySavedLoadout } from "./apply-client";
import { fetchInGameLoadouts, fullyApplied, snapshotInGame, waitBeforeSnapshot } from "./ingame-save";
import { resolveLoadout } from "./resolve";
import type { SavedLoadout } from "./types";

// Running an activity set: for each assigned slot, equip the loadout and snapshot it
// into the slot — the single "Save in-game" flow, repeated. A slot whose loadout can't
// be fully applied is left as it was and the run moves on. The run lives in this
// module (not a component) so it carries on if the player leaves the page.

export interface ActivitySetRunState {
  setId: string;
  /** 1-based position of the slot being saved now. */
  position: number;
  total: number;
  stopping: boolean;
}

let state: ActivitySetRunState | null = null;
const listeners = new Set<() => void>();

function setState(next: ActivitySetRunState | null) {
  state = next;
  for (const l of listeners) l();
}

const readState = () => state;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The set being run right now, if any. Only one runs at a time. */
export function useActivitySetRun(): ActivitySetRunState | null {
  return useSyncExternalStore(subscribe, () => state, () => null);
}

/** Finish the slot in progress, then stop. */
export function stopActivitySet(): void {
  if (state) setState({ ...state, stopping: true });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Tries at re-reading the profile until Bungie serves one taken after the last slot. */
const FRESH_PROFILE_TRIES = 3;
const FRESH_PROFILE_WAIT_MS = 1500;
/** Bungie's clock and ours needn't agree to the second. */
const CLOCK_SLACK_MS = 2000;

/**
 * The armory after the slot just saved. Bungie can serve a cached profile for a few
 * seconds after gear moves, and the next loadout's equip plan reads item locations
 * from it — so wait (briefly) for one minted after `since`. Falls back to the newest
 * one read, then to `fallback`.
 */
async function freshArmory(
  refresh: () => Promise<RefreshResult>,
  since: number,
  fallback: Armory,
): Promise<Armory> {
  let latest = fallback;
  for (let i = 0; i < FRESH_PROFILE_TRIES; i++) {
    const result = await refresh().catch(() => undefined);
    if (result?.data) {
      latest = result.data;
      if ((result.mintedAt ?? NaN) >= since - CLOCK_SLACK_MS) return latest;
    }
    if (i < FRESH_PROFILE_TRIES - 1) await sleep(FRESH_PROFILE_WAIT_MS);
  }
  return latest;
}

interface SlotResult {
  index: number;
  ok: boolean;
  reason?: string;
}

/**
 * Save every loadout in `set` into its in-game slot, in slot order. Reports one summary
 * toast at the end; each loadout's equip shows on the apply progress card as it runs.
 * The slots' names, icons and colours are kept (an empty slot gets the first of each).
 */
export async function runActivitySet({
  set,
  loadouts,
  armory,
  refreshArmory,
  manifest,
  queryClient,
}: {
  set: ActivitySet;
  loadouts: readonly SavedLoadout[];
  armory: Armory;
  /** Re-reads the profile from Bungie (useArmory's refetch). */
  refreshArmory: () => Promise<RefreshResult>;
  manifest: Manifest;
  queryClient: QueryClient;
}): Promise<void> {
  if (state || set.slots.length === 0) return;
  const total = set.slots.length;
  setState({ setId: set.id, position: 0, total, stopping: false });

  const results: SlotResult[] = [];
  let current = armory;
  let signedOut = false;
  try {
    let inGame: InGameLoadoutsResponse;
    try {
      inGame = await fetchInGameLoadouts(set.characterId);
    } catch (err) {
      toast.error(`Couldn't run ${set.name}`, err instanceof Error ? err.message : undefined);
      return;
    }

    for (const [i, assignment] of set.slots.entries()) {
      // Read through a call: TypeScript would otherwise keep the null it narrowed to above.
      const live = readState();
      if (!live || live.stopping) break;
      setState({ ...live, position: i + 1 });
      const skip = (reason: string) => results.push({ index: assignment.index, ok: false, reason });

      const saved = loadouts.find((l) => l.id === assignment.loadoutId);
      if (!saved) {
        skip("its loadout was deleted");
        continue;
      }
      const slot = inGame.slots.find((s) => s.index === assignment.index);
      const identifiers = slot && defaultIdentifiers(slot, inGame.identifiers);
      if (!slot || !identifiers) {
        skip("the slot isn't unlocked on this character");
        continue;
      }
      const character = current.characters.find((c) => c.id === set.characterId);
      if (!character) {
        toast.error(`Couldn't run ${set.name}`, "Its character is no longer on your account");
        return;
      }
      const pieceMap = new Map(current.pieces.map((p) => [p.instanceId, p]));
      const weaponMap = new Map((current.weapons ?? []).map((w) => [w.instanceId, w]));
      const resolved = resolveLoadout(saved.loadout, pieceMap, manifest, weaponMap);
      if (!resolved.actionable) {
        skip(`${saved.loadout.name} has armor that isn't in your inventory`);
        continue;
      }

      const outcome = await applySavedLoadout({
        saved,
        resolved,
        character,
        armory: current.pieces,
        weapons: current.weapons,
        manifest,
        queryClient,
        batch: `${set.name}: slot ${assignment.index + 1} (${i + 1} of ${total})`,
      });
      if (!outcome) {
        skip(`${saved.loadout.name} couldn't be equipped`);
      } else if (!fullyApplied(outcome)) {
        skip(`${saved.loadout.name} didn't fully apply`);
      } else {
        await waitBeforeSnapshot();
        const snapshot = await snapshotInGame(set.characterId, {
          loadoutIndex: assignment.index,
          ...identifiers,
        });
        if (snapshot.ok) {
          results.push({ index: assignment.index, ok: true });
        } else {
          skip(snapshot.error);
          if (snapshot.reauth) {
            signedOut = true;
            void handleSessionExpired(queryClient);
            break;
          }
        }
      }

      // Gear moved: the next loadout plans its equips from where things are now.
      const last = i === total - 1;
      if (outcome && !last) current = await freshArmory(refreshArmory, Date.now(), current);
    }
  } finally {
    setState(null);
  }

  if (signedOut) return;
  // Leave the page showing what the character ended up wearing.
  void refreshArmory();
  const saved = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  const notRun = total - results.length;
  const details = [
    ...failed.map((r) => `Slot ${r.index + 1}: ${r.reason}`),
    ...(notRun > 0 ? [`Stopped before ${notRun} more`] : []),
  ].join("; ");
  if (failed.length === 0 && notRun === 0) {
    toast.success(`${set.name} saved in-game`, `${saved} ${saved === 1 ? "slot" : "slots"} updated`);
  } else if (saved > 0) {
    toast.warning(`${set.name}: saved ${saved} of ${total} slots`, details);
  } else {
    toast.error(`${set.name}: no slots saved`, details || undefined);
  }
}
