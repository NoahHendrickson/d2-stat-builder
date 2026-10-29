"use client";

import type { QueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import { handleSessionExpired } from "@/lib/auth/sign-out";
import type {
  InGameLoadoutsResponse,
  SlotIdentifiers,
  SlotRequest,
  SnapshotRequest,
} from "@/lib/bungie/ingame-loadouts";
import { applySavedLoadout, type ApplyOutcome } from "./apply-client";

/** Which in-game slot to save into, and what to label it. */
export interface InGameSlotChoice extends SlotIdentifiers {
  loadoutIndex: number;
}

/** Bungie asks for at least a second between loadout actions (snapshot, clear). */
const LOADOUT_ACTION_GAP_MS = 1000;

export const waitBetweenLoadoutActions = () =>
  new Promise((r) => setTimeout(r, LOADOUT_ACTION_GAP_MS));

/** The query key every view of a character's in-game slots shares. */
export const inGameLoadoutsKey = (characterId: string | undefined) =>
  ["ingame-loadouts", characterId] as const;

/** A failed slot load; `reauth` when the session is gone and the player must sign in again. */
export class InGameLoadoutsError extends Error {
  constructor(
    message: string,
    readonly reauth: boolean,
  ) {
    super(message);
  }
}

/** The character's in-game loadout slots and the identifiers they can carry. */
export async function fetchInGameLoadouts(characterId: string): Promise<InGameLoadoutsResponse> {
  const res = await fetch(`/api/bungie/ingame-loadouts?characterId=${encodeURIComponent(characterId)}`);
  const data = (await res.json().catch(() => null)) as
    | (Partial<InGameLoadoutsResponse> & { error?: string; reauth?: boolean })
    | null;
  if (!res.ok || !data?.slots || !data.identifiers) {
    throw new InGameLoadoutsError(
      data?.error ?? "Couldn't load your in-game loadouts",
      data?.reauth === true,
    );
  }
  return { slots: data.slots, identifiers: data.identifiers };
}

/** Every piece equipped and every planned mod socketed — what the slot is about to capture. */
export function fullyApplied({
  equip,
  plugs,
  cancelled,
}: Pick<ApplyOutcome, "equip" | "plugs" | "cancelled">): boolean {
  return !cancelled && equip.every((r) => r.ok) && plugs.every((r) => r.ok);
}

export type SlotActionResult = { ok: true } | { ok: false; error: string; reauth: boolean };

/** One action on the in-game loadouts route. Never throws. */
async function slotAction(method: "POST" | "DELETE", body: SlotRequest): Promise<SlotActionResult> {
  try {
    const res = await fetch("/api/bungie/ingame-loadouts", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return { ok: true };
    const data = (await res.json().catch(() => null)) as
      | { error?: string; reauth?: boolean }
      | null;
    return { ok: false, error: data?.error ?? "Bungie request failed", reauth: data?.reauth === true };
  } catch {
    return { ok: false, error: "Check your connection and try again", reauth: false };
  }
}

/** Save what `characterId` is wearing into an in-game slot. Never throws. */
export const snapshotInGame = (characterId: string, choice: InGameSlotChoice) =>
  slotAction("POST", { characterId, ...choice } satisfies SnapshotRequest);

/** Empty an in-game slot — gear and labels both. Never throws. */
export const clearInGameSlot = (characterId: string, loadoutIndex: number) =>
  slotAction("DELETE", { characterId, loadoutIndex });

export interface ClearSlotsResult {
  /** How many slots were emptied, from the front of `indexes`. */
  cleared: number;
  /** The slot that stopped the run; the ones after it weren't tried. */
  failure?: { index: number; error: string; reauth: boolean };
}

/**
 * Empty several of a character's in-game slots, one request a second, stopping at the
 * first failure: Bungie's errors here (throttling, a dead session) would hit the rest
 * too. Each emptied slot is marked empty in the shared slots query as it lands, so
 * every open view drops it; a refetch then confirms. A dead session signs out.
 * Never throws.
 */
export async function clearInGameSlots({
  characterId,
  indexes,
  queryClient,
  onProgress,
}: {
  characterId: string;
  indexes: readonly number[];
  queryClient: QueryClient;
  onProgress?: (cleared: number) => void;
}): Promise<ClearSlotsResult> {
  const key = inGameLoadoutsKey(characterId);
  let cleared = 0;
  let failure: ClearSlotsResult["failure"];
  for (const index of indexes) {
    if (cleared > 0) await waitBetweenLoadoutActions();
    const result = await clearInGameSlot(characterId, index);
    if (!result.ok) {
      failure = { index, error: result.error, reauth: result.reauth };
      break;
    }
    cleared++;
    queryClient.setQueryData<InGameLoadoutsResponse>(key, (prev) =>
      prev && {
        ...prev,
        slots: prev.slots.map((s) => (s.index === index ? { ...s, items: [], empty: true } : s)),
      },
    );
    onProgress?.(cleared);
  }
  // The route cleared the dead session; forget the local player data too.
  if (failure?.reauth) void handleSessionExpired(queryClient);
  else void queryClient.invalidateQueries({ queryKey: key });
  return { cleared, failure };
}

/**
 * Save a saved loadout into an in-game slot. Bungie can only snapshot what a character
 * is wearing, so this equips the loadout first and snapshots only if the whole apply
 * landed — a half-applied character would overwrite the slot with the wrong build.
 * Returns the apply outcome (null when the apply request itself failed, already
 * reported) so the caller can refresh its gear either way.
 */
export async function saveLoadoutInGame({
  choice,
  queryClient,
  ...apply
}: Parameters<typeof applySavedLoadout>[0] & {
  choice: InGameSlotChoice;
}): Promise<ApplyOutcome | null> {
  const outcome = await applySavedLoadout({ ...apply, queryClient });
  if (!outcome) return null;
  // Stopped from the progress card, which already says so; the slot is left alone.
  if (outcome.cancelled) return outcome;

  const slot = `in-game loadout ${choice.loadoutIndex + 1}`;
  if (!fullyApplied(outcome)) {
    toast.warning(
      "Not saved in-game",
      `The loadout didn't fully apply, so ${slot} was left as it was`,
    );
    return outcome;
  }

  await waitBetweenLoadoutActions();
  const snapshot = await snapshotInGame(apply.character.id, choice);
  if (!snapshot.ok) {
    toast.error(`Couldn't save to ${slot}`, snapshot.error);
    // The route cleared the dead session; forget the local player data too.
    if (snapshot.reauth) void handleSessionExpired(queryClient);
    return outcome;
  }

  // Skips are known before anything is sent (a mod with no socket, a subclass this
  // character lacks); retrying wouldn't place them, so the slot is saved without them.
  toast.success(
    `Saved to ${slot}`,
    outcome.plan.skipped.length > 0
      ? "Some of the loadout couldn't be applied, so the in-game copy is missing it"
      : undefined,
  );
  return outcome;
}
