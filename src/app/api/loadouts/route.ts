import { NextResponse } from "next/server";
import { readUser } from "@/lib/bungie/session";
import { getServerLoadoutStore } from "@/lib/loadouts/neon-store";
import { parseSavedLoadoutData } from "@/lib/loadouts/types";
import { isLoadoutId, notConfigured, storageError } from "@/lib/loadouts/api-responses";
import { rejectCrossSite } from "@/lib/http/same-origin";
import { LoadoutLimitError, MAX_LOADOUTS_PER_ACCOUNT } from "@/lib/loadouts/store";

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
  const refused = rejectCrossSite(request);
  if (refused) return refused;
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
    if (err instanceof LoadoutLimitError) {
      return NextResponse.json(
        { error: `You can keep up to ${MAX_LOADOUTS_PER_ACCOUNT} loadouts — delete some to save more` },
        { status: 409 },
      );
    }
    return storageError(err);
  }
}

/** Most ids one bulk delete accepts — well past any real library. */
const MAX_BULK_DELETE = 1000;

/**
 * Bulk delete: `{ ids: [...] }` removes those rows, `{ all: true }` removes every row
 * this account owns. Answers with the ids that were actually deleted.
 */
export async function DELETE(request: Request) {
  const refused = rejectCrossSite(request);
  if (refused) return refused;
  const user = await readUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const store = getServerLoadoutStore();
  if (!store) return notConfigured();

  const body = (await request.json().catch(() => null)) as { ids?: unknown; all?: unknown } | null;
  let target: string[] | "all";
  if (body?.all === true) {
    target = "all";
  } else if (
    Array.isArray(body?.ids) &&
    body.ids.length <= MAX_BULK_DELETE &&
    body.ids.every(isLoadoutId)
  ) {
    target = [...new Set(body.ids)];
  } else {
    return NextResponse.json({ error: "Invalid delete request" }, { status: 400 });
  }

  try {
    return NextResponse.json({ deleted: await store.deleteMany(user.membershipId, target) });
  } catch (err) {
    return storageError(err);
  }
}
