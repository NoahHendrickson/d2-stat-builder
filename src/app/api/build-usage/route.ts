import { NextResponse } from "next/server";
import { readUser } from "@/lib/bungie/session";
import { getServerBuildUsageStore } from "@/lib/build-usage/neon-store";
import { decodeRecord } from "@/lib/build-usage/wire";
import { notConfigured, storageError } from "@/lib/loadouts/api-responses";
import { rejectCrossSite } from "@/lib/http/same-origin";

/** ~40 bytes per piece at MAX_RECORD_PIECES, with room to spare. */
const MAX_BODY_LENGTH = 256 * 1024;

/** Per armor piece: how many recorded optimizer queries it could join, was used in, was optimal in. */
export async function GET() {
  const user = await readUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const store = getServerBuildUsageStore();
  if (!store) return notConfigured();
  try {
    return NextResponse.json(await store.summary(user.membershipId));
  } catch (err) {
    return storageError(err);
  }
}

/** Record one settled optimizer query. Body: see `RecordBody`. */
export async function POST(request: Request) {
  const refused = rejectCrossSite(request);
  if (refused) return refused;
  const user = await readUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const store = getServerBuildUsageStore();
  if (!store) return notConfigured();

  const text = await request.text().catch(() => "");
  if (text.length > MAX_BODY_LENGTH) {
    return NextResponse.json({ error: "Record too large" }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  const record = decodeRecord(body);
  if (!record) return NextResponse.json({ error: "Invalid record" }, { status: 400 });

  try {
    await store.record(user.membershipId, record.key, record.pieces);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return storageError(err);
  }
}
