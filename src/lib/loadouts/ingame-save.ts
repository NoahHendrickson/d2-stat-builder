"use client";

import { toast } from "@/lib/toast";
import { handleSessionExpired } from "@/lib/auth/sign-out";
import type {
  InGameLoadoutsResponse,
  SlotIdentifiers,
  SnapshotRequest,
} from "@/lib/bungie/ingame-loadouts";
import { applySavedLoadout, type ApplyOutcome } from "./apply-client";

/** Which in-game slot to save into, and what to label it. */
export interface InGameSlotChoice extends SlotIdentifiers {
  loadoutIndex: number;
}

/** Bungie asks for at least a second between actions; the apply's last plug just landed. */
const SNAPSHOT_DELAY_MS = 1000;

export const waitBeforeSnapshot = () => new Promise((r) => setTimeout(r, SNAPSHOT_DELAY_MS));

/** The character's in-game loadout slots and the identifiers they can carry. */
export async function fetchInGameLoadouts(characterId: string): Promise<InGameLoadoutsResponse> {
  const res = await fetch(`/api/bungie/ingame-loadouts?characterId=${encodeURIComponent(characterId)}`);
  const data = (await res.json().catch(() => null)) as
    | (Partial<InGameLoadoutsResponse> & { error?: string })
    | null;
  if (!res.ok || !data?.slots || !data.identifiers) {
    throw new Error(data?.error ?? "Couldn't load your in-game loadouts");
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

export type SnapshotResult = { ok: true } | { ok: false; error: string; reauth?: boolean };

/** Save what `characterId` is wearing into an in-game slot. Never throws. */
export async function snapshotInGame(
  characterId: string,
  choice: InGameSlotChoice,
): Promise<SnapshotResult> {
  try {
    const res = await fetch("/api/bungie/ingame-loadouts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ characterId, ...choice } satisfies SnapshotRequest),
    });
    if (res.ok) return { ok: true };
    const data = (await res.json().catch(() => null)) as
      | { error?: string; reauth?: boolean }
      | null;
    return { ok: false, error: data?.error ?? "Bungie request failed", reauth: data?.reauth };
  } catch {
    return { ok: false, error: "Check your connection and try again" };
  }
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

  await waitBeforeSnapshot();
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
