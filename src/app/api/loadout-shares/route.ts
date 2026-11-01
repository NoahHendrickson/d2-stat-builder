import { NextResponse } from "next/server";
import { readUser } from "@/lib/bungie/session";
import { getShareStore, MAX_SHARES_PER_ACCOUNT, ShareLimitError } from "@/lib/loadouts/share-store";
import { parseSavedLoadoutData } from "@/lib/loadouts/types";
import { notConfigured, storageError } from "@/lib/loadouts/api-responses";
import { rejectCrossSite } from "@/lib/http/same-origin";

/** Store a share snapshot of a loadout; answers `{ code }` for `/loadouts#s=<code>`. */
export async function POST(request: Request) {
  const refused = rejectCrossSite(request);
  if (refused) return refused;
  const user = await readUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const store = getShareStore();
  if (!store) return notConfigured("Share");

  const data = parseSavedLoadoutData(await request.json().catch(() => null));
  if (!data) return NextResponse.json({ error: "Invalid loadout" }, { status: 400 });

  try {
    return NextResponse.json({ code: await store.create(user.membershipId, data) });
  } catch (err) {
    if (err instanceof ShareLimitError) {
      return NextResponse.json(
        { error: `You can create up to ${MAX_SHARES_PER_ACCOUNT} share links` },
        { status: 409 },
      );
    }
    return storageError(err, "Share");
  }
}
