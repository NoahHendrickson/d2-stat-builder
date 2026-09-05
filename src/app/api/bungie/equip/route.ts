import { NextResponse } from "next/server";
import { BungieHttpError, createBungieHttp } from "@/lib/bungie/http";
import { clearSession, getValidAccessToken, readUser } from "@/lib/bungie/session";
import type { EquipItemState } from "@/lib/bungie/equip-plan";
import { stageAndEquip } from "@/lib/bungie/equip-server";

export const dynamic = "force-dynamic";

interface EquipRequestBody {
  characterId: string;
  items: EquipItemState[];
  /** "move" stages the items on the character without equipping. Default "equip". */
  mode?: "move" | "equip";
}

function parseEquipItems(v: unknown, max: number): EquipItemState[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > max) return null;
  for (const i of v as Partial<EquipItemState>[]) {
    if (
      typeof i?.itemInstanceId !== "string" ||
      !i.itemInstanceId ||
      typeof i.itemHash !== "number" ||
      (i.characterId !== undefined && typeof i.characterId !== "string")
    )
      return null;
  }
  return v as EquipItemState[];
}

function parseBody(body: unknown): EquipRequestBody | null {
  const b = body as Partial<EquipRequestBody> | null;
  if (!b || typeof b.characterId !== "string" || !b.characterId) return null;
  const items = parseEquipItems(b.items, 5);
  if (!items) return null;
  if (b.mode !== undefined && b.mode !== "move" && b.mode !== "equip") return null;
  return { characterId: b.characterId, items, mode: b.mode };
}

export async function POST(request: Request) {
  const user = await readUser();
  const token = await getValidAccessToken();
  if (!user?.destinyMembershipId || user.destinyMembershipType == null || !token) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: EquipRequestBody | null = null;
  try {
    body = parseBody(await request.json());
  } catch {
    body = null;
  }
  if (!body) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const results = await stageAndEquip({
      http: createBungieHttp(token),
      membershipType: user.destinyMembershipType,
      characterId: body.characterId,
      items: body.items,
      mode: body.mode,
    });
    return NextResponse.json({ results });
  } catch (err) {
    if (err instanceof BungieHttpError && err.status === 401) {
      // Pre-scope tokens (or an expired session) get a 401 from Bungie — the fix
      // is a fresh sign-in that carries the move/equip scope.
      await clearSession();
      return NextResponse.json(
        {
          error: "Bungie needs new permissions — sign in again to allow equipping",
          reauth: true,
        },
        { status: 401 },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Bungie request failed" },
      { status: 502 },
    );
  }
}
