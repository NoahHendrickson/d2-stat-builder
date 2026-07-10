// Client half of the equip flow, shared by the builder footer ("Equip items")
// and the armor table's per-row Move/Equip: one request/response contract for
// POST /api/bungie/equip, including the reauth handshake.
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ArmorPiece } from "../armory/normalize";
import type { ArmoryCharacter } from "../armory/fetch";
import { characterForClass } from "../armory/character-for-class";

/** Per-item outcome from POST /api/bungie/equip. */
export interface EquipResult {
  itemInstanceId: string;
  ok: boolean;
  message?: string;
}

/** The most recently played character of the given class. */
export function lastPlayedCharacter(
  characters: ArmoryCharacter[],
  classType: number | undefined,
): ArmoryCharacter | undefined {
  if (classType === undefined) return undefined;
  return characterForClass(characters, classType);
}

/** The request-body item shape the equip route expects. */
export function equipItemRef(piece: ArmorPiece) {
  return {
    itemInstanceId: piece.instanceId,
    itemHash: piece.itemHash,
    location: piece.location,
    characterId: piece.characterId,
  };
}

/**
 * POST to /api/bungie/equip. On a non-OK response, toasts the server's error
 * (falling back to `failureMessage`) and returns null; success/partial-failure
 * toasts stay with the caller, which knows the items involved.
 */
export async function postEquipRequest(
  body: {
    characterId: string;
    items: ReturnType<typeof equipItemRef>[];
    /** "move" stages the items on the character without equipping. */
    mode?: "move" | "equip";
  },
  opts: { queryClient: QueryClient; failureMessage: string },
): Promise<EquipResult[] | null> {
  const res = await fetch("/api/bungie/equip", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as {
    results?: EquipResult[];
    error?: string;
    reauth?: boolean;
  };

  if (!res.ok) {
    toast.error(data.error ?? opts.failureMessage);
    // The server cleared the stale (pre-scope or expired) session; surfacing
    // the session query brings back the sign-in card.
    if (data.reauth) {
      void opts.queryClient.invalidateQueries({ queryKey: ["session"] });
    }
    return null;
  }
  return data.results ?? [];
}
