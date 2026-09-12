import { NextResponse } from "next/server";
import { readUser } from "@/lib/bungie/session";
import { getServerLoadoutStore } from "@/lib/loadouts/neon-store";
import { parseSavedLoadoutData } from "@/lib/loadouts/types";
import { notConfigured, storageError } from "@/lib/loadouts/api-responses";

/**
 * Saved loadouts, owned by the signed (tamper-evident) session cookie's Bungie.net
 * membership id. No Bungie call is involved, so the cookie's signature is the only
 * thing standing between accounts — see session.ts.
 */
export async function GET() {
  const user = await readUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const store = getServerLoadoutStore();
  if (!store) return notConfigured();
  try {
    return NextResponse.json({ loadouts: await store.list(user.membershipId) });
  } catch (err) {
    return storageError(err);
  }
}

export async function POST(request: Request) {
  const user = await readUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const store = getServerLoadoutStore();
  if (!store) return notConfigured();

  const data = parseSavedLoadoutData(await request.json().catch(() => null));
  if (!data) return NextResponse.json({ error: "Invalid loadout" }, { status: 400 });

  try {
    const loadout = await store.create(user.membershipId, data);
    return NextResponse.json({ loadout }, { status: 201 });
  } catch (err) {
    return storageError(err);
  }
}
