import { NextResponse } from "next/server";
import { getShareStore, readShare } from "@/lib/loadouts/share-store";
import { isShareCode } from "@/lib/loadouts/share";
import { notConfigured, storageError } from "@/lib/loadouts/api-responses";

type Ctx = { params: Promise<{ code: string }> };

// next.config.ts leaves this route's caching to it.
const noStore = (res: NextResponse) => {
  res.headers.set("Cache-Control", "private, no-store");
  return res;
};

/**
 * A shared loadout. Public like the old self-contained links: the code is the secret.
 * Shares never change, so a found one is cached for good, by browsers and the CDN.
 */
export async function GET(_request: Request, { params }: Ctx) {
  const { code } = await params;
  if (!isShareCode(code)) return noStore(NextResponse.json({ error: "Invalid link" }, { status: 400 }));
  if (!getShareStore()) return noStore(notConfigured("Share"));
  try {
    const loadout = await readShare(code);
    if (!loadout) return noStore(NextResponse.json({ error: "Share not found" }, { status: 404 }));
    return NextResponse.json(
      { loadout },
      { headers: { "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable" } },
    );
  } catch (err) {
    return noStore(storageError(err, "Share"));
  }
}
