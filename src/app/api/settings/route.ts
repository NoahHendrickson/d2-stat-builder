import { NextResponse } from "next/server";
import { readUser } from "@/lib/bungie/session";
import { getServerSettingsStore } from "@/lib/settings/neon-store";
import { notConfigured, storageError } from "@/lib/loadouts/api-responses";

/** Every synced setting the signed-in account has stored, with its last write time. */
export async function GET() {
  const user = await readUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const store = getServerSettingsStore();
  if (!store) return notConfigured();
  try {
    return NextResponse.json({ settings: await store.list(user.membershipId) });
  } catch (err) {
    return storageError(err);
  }
}
