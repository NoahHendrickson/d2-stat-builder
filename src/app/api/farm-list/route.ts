import { NextResponse } from "next/server";
import { readUser } from "@/lib/bungie/session";
import { notConfigured, storageError } from "@/lib/loadouts/api-responses";
import { rejectCrossSite } from "@/lib/http/same-origin";
import { getServerFarmListStore, FarmListLimitError } from "@/lib/farm-list/neon-store";
import { MAX_FARM_ENTRIES_PER_ACCOUNT, parseFarmEntryData } from "@/lib/farm-list/types";

/**
 * The Farm list, owned by the signed session cookie's Bungie.net membership id
 * (see the loadouts route: the cookie's signature is what separates accounts).
 */
export async function GET() {
  const user = await readUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const store = getServerFarmListStore();
  if (!store) return notConfigured("Farm list");
  try {
    return NextResponse.json({ entries: await store.list(user.membershipId) });
  } catch (err) {
    return storageError(err, "Farm list");
  }
}

export async function POST(request: Request) {
  const refused = rejectCrossSite(request);
  if (refused) return refused;
  const user = await readUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const store = getServerFarmListStore();
  if (!store) return notConfigured("Farm list");

  const data = parseFarmEntryData(await request.json().catch(() => null));
  if (!data) return NextResponse.json({ error: "Invalid entry" }, { status: 400 });

  try {
    return NextResponse.json({ entry: await store.create(user.membershipId, data) }, { status: 201 });
  } catch (err) {
    if (err instanceof FarmListLimitError) {
      return NextResponse.json(
        { error: `You can keep up to ${MAX_FARM_ENTRIES_PER_ACCOUNT} entries. Remove some to add more` },
        { status: 409 },
      );
    }
    return storageError(err, "Farm list");
  }
}

/** `{ seen: true }`: every obtained entry has been looked at. */
export async function PATCH(request: Request) {
  const refused = rejectCrossSite(request);
  if (refused) return refused;
  const user = await readUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const store = getServerFarmListStore();
  if (!store) return notConfigured("Farm list");

  const body = (await request.json().catch(() => null)) as { seen?: unknown } | null;
  if (body?.seen !== true) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try {
    await store.markSeen(user.membershipId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return storageError(err, "Farm list");
  }
}
