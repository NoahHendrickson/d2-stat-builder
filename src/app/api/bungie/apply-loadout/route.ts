import { NextResponse } from "next/server";
import { createBungieHttp } from "@/lib/bungie/http";
import { getValidAccessToken, readUser } from "@/lib/bungie/session";
import type { EquipItemState } from "@/lib/bungie/equip-plan";
import {
  insertPlugs,
  stageAndEquip,
  type ApplyResponse,
  type PlugRequest,
  type PlugResult,
} from "@/lib/bungie/equip-server";
import { bungieErrorResponse, parseEquipItems } from "@/lib/bungie/equip-route";
import { FRAGMENT_SOCKET_COUNT } from "@/lib/armory/equipped-subclass";
import { MAX_MODS } from "@/lib/loadouts/types";
import { ASPECT_SOCKET_COUNT } from "@/lib/dim/subclasses";

export const dynamic = "force-dynamic";

/** 5 armor + 1 subclass. */
const MAX_ITEMS = 6;
/**
 * Every mod a loadout may list (stat / tuning / artifice / slot-specific — the same cap
 * the loadout parser enforces) plus a full set of fragments. Anything the client plans
 * within a valid loadout must fit, or a fully-modded build could never be applied.
 */
const MAX_PLUGS = MAX_MODS + ASPECT_SOCKET_COUNT + FRAGMENT_SOCKET_COUNT;

interface ApplyRequestBody {
  characterId: string;
  /** Armor (and the subclass item) to stage + equip. May be empty when only plugs change. */
  items: EquipItemState[];
  /** Socket inserts to run after equipping (planned client-side, see apply-plan.ts). */
  plugs: PlugRequest[];
}

function parsePlugs(v: unknown): PlugRequest[] | null {
  if (!Array.isArray(v) || v.length > MAX_PLUGS) return null;
  for (const p of v as Partial<PlugRequest>[]) {
    if (
      typeof p?.itemInstanceId !== "string" ||
      !p.itemInstanceId ||
      !Number.isInteger(p.socketIndex) ||
      (p.socketIndex as number) < 0 ||
      !Number.isInteger(p.plugItemHash)
    )
      return null;
  }
  return v as PlugRequest[];
}

function parseBody(body: unknown): ApplyRequestBody | null {
  const b = body as Partial<ApplyRequestBody> | null;
  if (!b || typeof b.characterId !== "string" || !b.characterId) return null;
  const items = parseEquipItems(b.items ?? [], { min: 0, max: MAX_ITEMS });
  const plugs = parsePlugs(b.plugs ?? []);
  if (!items || !plugs || (items.length === 0 && plugs.length === 0)) return null;
  return { characterId: b.characterId, items, plugs };
}

/**
 * Apply a saved loadout: stage + equip the armor (and subclass), then socket the
 * planned mods / tuning / artifice / fragments. Plugs for an item whose equip failed
 * are skipped with that item's message rather than attempted.
 */
export async function POST(request: Request) {
  const user = await readUser();
  const token = await getValidAccessToken();
  if (!user?.destinyMembershipId || user.destinyMembershipType == null || !token) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: ApplyRequestBody | null = null;
  try {
    body = parseBody(await request.json());
  } catch {
    body = null;
  }
  if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const http = createBungieHttp(token);
  const membershipType = user.destinyMembershipType;
  const { characterId } = body;

  try {
    const equip =
      body.items.length > 0
        ? await stageAndEquip({ http, membershipType, characterId, items: body.items })
        : [];

    const failedItems = new Map(
      equip.filter((r) => !r.ok).map((r) => [r.itemInstanceId, r.message ?? "Equip failed"]),
    );
    const runnable = body.plugs.filter((p) => !failedItems.has(p.itemInstanceId));
    const plugResults = await insertPlugs({
      http,
      membershipType,
      characterId,
      plugs: runnable,
    });
    const plugs: PlugResult[] = [
      ...plugResults,
      ...body.plugs
        .filter((p) => failedItems.has(p.itemInstanceId))
        .map((p) => ({ ...p, ok: false, message: failedItems.get(p.itemInstanceId) })),
    ];

    const response: ApplyResponse = { equip, plugs };
    return NextResponse.json(response);
  } catch (err) {
    return bungieErrorResponse(err);
  }
}
