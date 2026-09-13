import { NextResponse } from "next/server";
import { createBungieHttp } from "@/lib/bungie/http";
import { getValidAccessToken, readUser } from "@/lib/bungie/session";
import type { EquipItemState, SpareItems } from "@/lib/bungie/equip-plan";
import { stageAndEquip } from "@/lib/bungie/equip-server";
import { bungieErrorResponse, parseEquipItems, parseSpares } from "@/lib/bungie/equip-route";

interface EquipRequestBody {
  characterId: string;
  items: EquipItemState[];
  /** "move" stages the items on the character without equipping. Default "equip". */
  mode?: "move" | "equip";
  /** Same-slot pieces the server may vault when a character's slot is full. */
  spares: SpareItems;
}

function parseBody(body: unknown): EquipRequestBody | null {
  const b = body as Partial<EquipRequestBody> | null;
  if (!b || typeof b.characterId !== "string" || !b.characterId) return null;
  const items = parseEquipItems(b.items, { min: 1, max: 5 });
  if (!items) return null;
  if (b.mode !== undefined && b.mode !== "move" && b.mode !== "equip") return null;
  const spares = parseSpares(b.spares);
  if (!spares) return null;
  return { characterId: b.characterId, items, mode: b.mode, spares };
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
      spares: body.spares,
      mode: body.mode,
    });
    return NextResponse.json({ results });
  } catch (err) {
    return bungieErrorResponse(err);
  }
}
