import { NextResponse } from "next/server";
import { readUser } from "@/lib/bungie/session";
import { getServerLoadoutStore } from "@/lib/loadouts/neon-store";
import { parseSavedLoadoutData } from "@/lib/loadouts/types";
import { isLoadoutId, notConfigured, storageError } from "@/lib/loadouts/api-responses";
import { rejectCrossSite } from "@/lib/http/same-origin";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Ctx) {
  const refused = rejectCrossSite(request);
  if (refused) return refused;
  const user = await readUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const store = getServerLoadoutStore();
  if (!store) return notConfigured();

  const { id } = await params;
  if (!isLoadoutId(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  const data = parseSavedLoadoutData(await request.json().catch(() => null));
  if (!data) return NextResponse.json({ error: "Invalid loadout" }, { status: 400 });

  try {
    const loadout = await store.update(user.membershipId, id, data);
    if (!loadout) return NextResponse.json({ error: "Loadout not found" }, { status: 404 });
    return NextResponse.json({ loadout });
  } catch (err) {
    return storageError(err);
  }
}

export async function DELETE(request: Request, { params }: Ctx) {
  const refused = rejectCrossSite(request);
  if (refused) return refused;
  const user = await readUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const store = getServerLoadoutStore();
  if (!store) return notConfigured();

  const { id } = await params;
  if (!isLoadoutId(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  try {
    const ok = await store.delete(user.membershipId, id);
    if (!ok) return NextResponse.json({ error: "Loadout not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return storageError(err);
  }
}
