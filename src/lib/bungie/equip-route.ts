// Request/response plumbing shared by the /api/bungie/equip and /api/bungie/apply-loadout
// route handlers: the item-list validator and the Bungie error → HTTP response mapping.
// Both clients (equip-client.ts, apply-client.ts) key on the `reauth` flag, so the
// contract must stay identical across the two routes.
import { NextResponse } from "next/server";
import { BungieHttpError } from "./http";
import { clearSession } from "./session";
import type { EquipItemState } from "./equip-plan";

/** Validate a client-supplied item list; null if malformed or outside `min`–`max` items. */
export function parseEquipItems(
  v: unknown,
  { min, max }: { min: number; max: number },
): EquipItemState[] | null {
  if (!Array.isArray(v) || v.length < min || v.length > max) return null;
  for (const i of v as Partial<EquipItemState>[]) {
    if (
      typeof i?.itemInstanceId !== "string" ||
      !i.itemInstanceId ||
      typeof i.itemHash !== "number" ||
      (i.characterId !== undefined && typeof i.characterId !== "string")
    )
      return null;
  }
  return v as EquipItemState[];
}

/**
 * The response for an error thrown out of a Bungie action. A 401 means the token lacks
 * the move/equip scope (pre-scope sign-in) or the session is dead — clear it and tell
 * the client to re-authenticate; anything else is a 502 with Bungie's message.
 */
export async function bungieErrorResponse(err: unknown): Promise<NextResponse> {
  if (err instanceof BungieHttpError && err.status === 401) {
    await clearSession();
    return NextResponse.json(
      {
        error: "Bungie needs new permissions — sign in again to allow equipping",
        reauth: true,
      },
      { status: 401 },
    );
  }
  return NextResponse.json(
    { error: err instanceof Error ? err.message : "Bungie request failed" },
    { status: 502 },
  );
}
