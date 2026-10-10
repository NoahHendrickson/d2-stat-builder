import { NextResponse } from "next/server";

/** Shared responses for the /api/loadouts routes (route files may only export handlers). */

export function notConfigured() {
  return NextResponse.json(
    {
      error: "Loadout storage isn't configured — set DATABASE_URL (see .env.example)",
      configured: false,
    },
    { status: 503 },
  );
}

export function storageError(err: unknown) {
  console.error("Loadout storage error:", err instanceof Error ? err.message : err);
  return NextResponse.json({ error: "Loadout storage failed — try again" }, { status: 502 });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Loadout row ids are UUIDs; anything else is refused before it reaches the database. */
export const isLoadoutId = (id: unknown): id is string => typeof id === "string" && UUID.test(id);
