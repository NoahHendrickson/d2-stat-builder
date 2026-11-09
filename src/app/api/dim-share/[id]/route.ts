import { NextResponse } from "next/server";
import { readUser } from "@/lib/bungie/session";
import { isDimShareId } from "@/lib/loadouts/dim-import";

const DIM_SHARE_ENDPOINT = "https://api.destinyitemmanager.com/loadout_share";
const TIMEOUT_MS = 8000;

type Ctx = { params: Promise<{ id: string }> };

/**
 * The loadout behind a dim.gg link. Fetched here so the page's content security policy
 * doesn't have to allow DIM. Signed-in players only, and only ever this one endpoint.
 * Answers `{ loadout }`, which the client validates.
 */
export async function GET(_request: Request, { params }: Ctx) {
  const user = await readUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  if (!isDimShareId(id)) return NextResponse.json({ error: "Invalid link" }, { status: 400 });

  try {
    const res = await fetch(`${DIM_SHARE_ENDPOINT}?shareId=${encodeURIComponent(id)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 404) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!res.ok) throw new Error(`DIM answered HTTP ${res.status}`);
    const body = (await res.json()) as { loadout?: unknown };
    return NextResponse.json({ loadout: body.loadout ?? null });
  } catch (err) {
    console.error("GET /api/dim-share failed", err);
    return NextResponse.json({ error: "Couldn't reach DIM" }, { status: 502 });
  }
}
