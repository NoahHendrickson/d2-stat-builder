import { NextResponse } from "next/server";
import { readUser } from "@/lib/bungie/session";
import { isLoadoutId, notConfigured, storageError } from "@/lib/loadouts/api-responses";
import { rejectCrossSite } from "@/lib/http/same-origin";
import { getServerFarmListStore } from "@/lib/farm-list/neon-store";
import { parseFarmPatch } from "@/lib/farm-list/types";

type Ctx = { params: Promise<{ id: string }> };

/** `{ obtained: instanceId }` when a drop matches, `{ reject: true }` for "Not this one". */
export async function PATCH(request: Request, { params }: Ctx) {
  const refused = rejectCrossSite(request);
  if (refused) return refused;
  const user = await readUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const store = getServerFarmListStore();
  if (!store) return notConfigured("Farm list");

  const { id } = await params;
  if (!isLoadoutId(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  const patch = parseFarmPatch(await request.json().catch(() => null));
  if (!patch) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  try {
    const entry = await store.patch(user.membershipId, id, patch);
    if (!entry) return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    return NextResponse.json({ entry });
  } catch (err) {
    return storageError(err, "Farm list");
  }
}

export async function DELETE(request: Request, { params }: Ctx) {
  const refused = rejectCrossSite(request);
  if (refused) return refused;
  const user = await readUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const store = getServerFarmListStore();
  if (!store) return notConfigured("Farm list");

  const { id } = await params;
  if (!isLoadoutId(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  try {
    const ok = await store.delete(user.membershipId, id);
    if (!ok) return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return storageError(err, "Farm list");
  }
}
