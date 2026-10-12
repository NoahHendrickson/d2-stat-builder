import { NextResponse } from "next/server";

/**
 * Shared responses for the Neon-backed routes (route files may only export handlers).
 * `what` names the storage in the message and the server log; it defaults to loadouts.
 */

export function notConfigured(what = "Loadout") {
  return NextResponse.json(
    {
      error: `${what} storage isn't configured — set DATABASE_URL (see .env.example)`,
      configured: false,
    },
    { status: 503 },
  );
}

export function storageError(err: unknown, what = "Loadout") {
  console.error(`${what} storage error:`, err instanceof Error ? err.message : err);
  return NextResponse.json({ error: `${what} storage failed — try again` }, { status: 502 });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Loadout row ids are UUIDs; anything else is refused before it reaches the database. */
export const isLoadoutId = (id: unknown): id is string => typeof id === "string" && UUID.test(id);
