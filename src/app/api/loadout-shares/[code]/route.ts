import { NextResponse } from "next/server";
import { getShareStore } from "@/lib/loadouts/share-store";
import { isShareCode } from "@/lib/loadouts/share";
import { notConfigured, storageError } from "@/lib/loadouts/api-responses";

type Ctx = { params: Promise<{ code: string }> };

/**
 * A shared loadout. Public like the old self-contained links: the code is the secret.
 * Shares never change, so a found one may be cached for good.
 */
export async function GET(_request: Request, { params }: Ctx) {
  const { code } = await params;
  if (!isShareCode(code)) return NextResponse.json({ error: "Invalid link" }, { status: 400 });
  const store = getShareStore();
  if (!store) return notConfigured("Share");
  try {
    const loadout = await store.get(code);
    if (!loadout) return NextResponse.json({ error: "Share not found" }, { status: 404 });
    return NextResponse.json(
      { loadout },
      { headers: { "Cache-Control": "public, max-age=31536000, immutable" } },
    );
  } catch (err) {
    return storageError(err, "Share");
  }
}
