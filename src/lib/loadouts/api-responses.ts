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
