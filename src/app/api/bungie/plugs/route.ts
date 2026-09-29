import { NextResponse } from "next/server";
import { createBungieHttp } from "@/lib/bungie/http";
import { getValidAccessToken, readUser } from "@/lib/bungie/session";
import { bungieErrorResponse } from "@/lib/bungie/equip-route";
import { insertPlugs, type PlugRequest } from "@/lib/bungie/equip-server";

const isId = (v: unknown): v is string => typeof v === "string" && /^\d+$/.test(v);
/** A weapon has well under this many perk sockets. */
const MAX_PLUGS = 12;

/**
 * Swap perks on one item for the inventory manager (DIM's "Apply perks"): each plug
 * goes into its socket with InsertSocketPlugFree, one at a time. The item must be on
 * `characterId` (not in the vault), and that character in orbit, a social space, or
 * offline. Answers `{ plugs: PlugResult[] }`; a dead session is a 401 with `reauth`.
 */
export async function POST(request: Request) {
  const user = await readUser();
  const token = await getValidAccessToken();
  if (!user?.destinyMembershipId || user.destinyMembershipType == null || !token) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: { itemId?: unknown; characterId?: unknown; plugs?: unknown } | null = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const plugs = Array.isArray(body?.plugs) ? (body.plugs as Partial<PlugRequest>[]) : null;
  if (
    !body ||
    !isId(body.itemId) ||
    !isId(body.characterId) ||
    !plugs ||
    plugs.length === 0 ||
    plugs.length > MAX_PLUGS ||
    plugs.some(
      (p) =>
        !Number.isInteger(p?.socketIndex) ||
        (p.socketIndex as number) < 0 ||
        !Number.isInteger(p?.plugItemHash),
    )
  ) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const itemId = body.itemId;

  try {
    const results = await insertPlugs({
      http: createBungieHttp(token),
      membershipType: user.destinyMembershipType,
      characterId: body.characterId,
      plugs: plugs.map((p) => ({
        itemInstanceId: itemId,
        socketIndex: p.socketIndex as number,
        plugItemHash: p.plugItemHash as number,
      })),
    });
    return NextResponse.json({ plugs: results });
  } catch (err) {
    return bungieErrorResponse(err);
  }
}
