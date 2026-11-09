import { NextResponse } from "next/server";
import { readUser } from "@/lib/bungie/session";
import { getServerLoadoutStore } from "@/lib/loadouts/neon-store";
import { parseSavedLoadoutData, type SavedLoadoutData } from "@/lib/loadouts/types";
import { isLoadoutId, notConfigured, storageError } from "@/lib/loadouts/api-responses";
import { rejectCrossSite } from "@/lib/http/same-origin";
import { LoadoutLimitError, MAX_LOADOUTS_PER_ACCOUNT } from "@/lib/loadouts/store";

/**
 * Saved loadouts, owned by the signed (tamper-evident) session cookie's Bungie.net
 * membership id. No Bungie call is involved, so the cookie's signature is the only
 * thing standing between accounts — see session.ts.
 */
/**
 * The player's loadouts. Activity sets' private copies are left out unless `?copies=1`
 * asks for them: they aren't the player's to see as loadouts.
 */
export async function GET(request: Request) {
  const user = await readUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const store = getServerLoadoutStore();
  if (!store) return notConfigured();
  const withCopies = new URL(request.url).searchParams.get("copies") === "1";
  try {
    const loadouts = await store.list(user.membershipId);
    return NextResponse.json({ loadouts: withCopies ? loadouts : loadouts.filter((l) => !l.setOnly) });
  } catch (err) {
    return storageError(err);
  }
}

/** Most loadouts one bulk create accepts: an activity set can't hold more. */
const MAX_BULK_CREATE = 32;

/** Every entry must be a valid loadout, or nothing is stored. */
function parseBulkCreate(list: unknown[]): SavedLoadoutData[] | null {
  if (list.length === 0 || list.length > MAX_BULK_CREATE) return null;
  const parsed = list.map(parseSavedLoadoutData);
  return parsed.every((d) => d !== null) ? (parsed as SavedLoadoutData[]) : null;
}

/** Create one loadout, or with `{ loadouts: [...] }` several, all or none, in that order. */
export async function POST(request: Request) {
  const refused = rejectCrossSite(request);
  if (refused) return refused;
  const user = await readUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const store = getServerLoadoutStore();
  if (!store) return notConfigured();

  const body = (await request.json().catch(() => null)) as { loadouts?: unknown } | null;
  try {
    if (Array.isArray(body?.loadouts)) {
      const data = parseBulkCreate(body.loadouts);
      if (!data) return NextResponse.json({ error: "Invalid loadouts" }, { status: 400 });
      const loadouts = await store.createMany(user.membershipId, data);
      return NextResponse.json({ loadouts }, { status: 201 });
    }
    const data = parseSavedLoadoutData(body);
    if (!data) return NextResponse.json({ error: "Invalid loadout" }, { status: 400 });
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

/** Bulk delete: `{ ids: [...] }` removes those rows. Answers with the ids actually deleted. */
export async function DELETE(request: Request) {
  const refused = rejectCrossSite(request);
  if (refused) return refused;
  const user = await readUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const store = getServerLoadoutStore();
  if (!store) return notConfigured();

  const body = (await request.json().catch(() => null)) as { ids?: unknown; all?: unknown } | null;
  // `{ all: true }` comes from tabs still running the release before activity sets' copies;
  // it means every loadout they could see. Drop it once those tabs are gone.
  const legacyAll = body?.all === true;
  if (
    !legacyAll &&
    (!Array.isArray(body?.ids) || body.ids.length > MAX_BULK_DELETE || !body.ids.every(isLoadoutId))
  ) {
    return NextResponse.json({ error: "Invalid delete request" }, { status: 400 });
  }

  try {
    const ids = legacyAll
      ? (await store.list(user.membershipId)).filter((l) => !l.setOnly).map((l) => l.id)
      : [...new Set(body!.ids as string[])];
    const deleted = await store.deleteMany(user.membershipId, ids);
    return NextResponse.json({ deleted });
  } catch (err) {
    return storageError(err);
  }
}
