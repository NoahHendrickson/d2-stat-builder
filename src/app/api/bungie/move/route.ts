import { NextResponse } from "next/server";
import { createBungieHttp } from "@/lib/bungie/http";
import { getValidAccessToken, readUser } from "@/lib/bungie/session";
import { bungieErrorResponse } from "@/lib/bungie/equip-route";
import type { MoveDestination, MoveRequest, MoveSource } from "@/lib/bungie/move-plan";
import { runMove } from "@/lib/bungie/move-server";

const isId = (v: unknown): v is string => typeof v === "string" && /^\d+$/.test(v);

function parseSource(v: unknown): MoveSource | null {
  const s = v as Partial<{ kind: string; characterId: unknown; equipped: unknown }> | null;
  if (s?.kind === "vault") return { kind: "vault" };
  if ((s?.kind === "character" || s?.kind === "postmaster") && isId(s.characterId)) {
    if (s.kind === "postmaster") return { kind: "postmaster", characterId: s.characterId };
    if (s.equipped !== undefined && typeof s.equipped !== "boolean") return null;
    return { kind: "character", characterId: s.characterId, equipped: s.equipped === true };
  }
  return null;
}

function parseDestination(v: unknown): MoveDestination | null {
  const d = v as Partial<{ kind: string; characterId: unknown; equip: unknown }> | null;
  if (d?.kind === "vault") return { kind: "vault" };
  if (d?.kind === "character" && isId(d.characterId)) {
    if (d.equip !== undefined && typeof d.equip !== "boolean") return null;
    return { kind: "character", characterId: d.characterId, equip: d.equip === true };
  }
  return null;
}

function parseBody(body: unknown): MoveRequest | null {
  const b = body as Partial<Record<keyof MoveRequest, unknown>> | null;
  if (!b || !isId(b.itemId) || typeof b.itemHash !== "number") return null;
  const stackSize = b.stackSize ?? 1;
  if (typeof stackSize !== "number" || !Number.isInteger(stackSize) || stackSize < 1) return null;
  const from = parseSource(b.from);
  const to = parseDestination(b.to);
  if (!from || !to) return null;
  return { itemId: b.itemId, itemHash: b.itemHash, stackSize, from, to };
}

/** Move one item for the inventory manager: vault ↔ characters, postmaster pulls, equips. */
export async function POST(request: Request) {
  const user = await readUser();
  const token = await getValidAccessToken();
  if (!user?.destinyMembershipId || user.destinyMembershipType == null || !token) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: MoveRequest | null = null;
  try {
    body = parseBody(await request.json());
  } catch {
    body = null;
  }
  if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  try {
    const result = await runMove({
      http: createBungieHttp(token),
      membershipType: user.destinyMembershipType,
      request: body,
    });
    return NextResponse.json(result);
  } catch (err) {
    return bungieErrorResponse(err);
  }
}
