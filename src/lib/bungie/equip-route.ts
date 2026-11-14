// Request/response plumbing shared by the /api/bungie/equip and /api/bungie/apply-loadout
// route handlers: the item-list validator and the Bungie error → HTTP response mapping.
// Both clients (equip-client.ts, apply-client.ts) key on the `reauth` flag, so the
// contract must stay identical across the two routes.
import { NextResponse } from "next/server";
import { BungieHttpError } from "./http";
import { clearSession } from "./session";
import {
  EQUIP_SLOTS,
  MAX_SPARES_PER_ITEM,
  type EquipItemState,
  type SpareItems,
} from "./equip-plan";
import type {
  ApplyTargets,
  ArmorSocketTarget,
  ArtifactSocketTarget,
  ItemTarget,
  SubclassGroupTarget,
} from "../loadouts/apply-targets";

/** Bungie instance / character ids: decimal int64s, sent as strings. */
export const isBungieId = (v: unknown): v is string =>
  typeof v === "string" && /^\d{1,20}$/.test(v);

/** Validate a client-supplied item list; null if malformed or outside `min`–`max` items. */
export function parseEquipItems(
  v: unknown,
  { min, max }: { min: number; max: number },
): EquipItemState[] | null {
  if (!Array.isArray(v) || v.length < min || v.length > max) return null;
  for (const i of v as Partial<EquipItemState>[]) {
    if (
      !isBungieId(i?.itemInstanceId) ||
      typeof i.itemHash !== "number" ||
      (i.characterId !== undefined && !isBungieId(i.characterId)) ||
      (i.isExotic !== undefined && typeof i.isExotic !== "boolean") ||
      (i.postmaster !== undefined && typeof i.postmaster !== "boolean") ||
      (i.slot !== undefined && !EQUIP_SLOTS.includes(i.slot))
    )
      return null;
  }
  return v as EquipItemState[];
}

/**
 * Validate the optional make-room map (staged item id → same-slot spares the server may
 * vault). Absent means "don't make room"; malformed or oversized lists are rejected.
 */
export function parseSpares(v: unknown): SpareItems | null {
  if (v === undefined) return {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: SpareItems = {};
  for (const [id, list] of Object.entries(v as Record<string, unknown>)) {
    if (!isBungieId(id)) return null;
    const items = parseEquipItems(list, { min: 0, max: MAX_SPARES_PER_ITEM });
    if (!items) return null;
    if (items.length > 0) out[id] = items;
  }
  return out;
}

/**
 * The response for an error thrown out of a Bungie action. A 401 means the token lacks
 * the move/equip scope (pre-scope sign-in) or the session is dead — clear it and tell
 * the client to re-authenticate; anything else is a 502 with Bungie's message.
 */
export async function bungieErrorResponse(
  err: unknown,
  reauthMessage = "Bungie needs new permissions — sign in again to allow equipping",
): Promise<NextResponse> {
  if (err instanceof BungieHttpError && err.status === 401) {
    await clearSession();
    return NextResponse.json({ error: reauthMessage, reauth: true }, { status: 401 });
  }
  return NextResponse.json(
    { error: err instanceof Error ? err.message : "Bungie request failed" },
    { status: 502 },
  );
}

/**
 * No session to act with: never signed in, or getValidAccessToken just cleared it after
 * a failed refresh. Carries `reauth` so the client forgets its local player data too.
 */
export function notSignedIn(): NextResponse {
  return NextResponse.json({ error: "Not signed in", reauth: true }, { status: 401 });
}

/** Sockets per item a target may name: armor has ~12, a subclass ~18, an artifact 8. */
const MAX_TARGET_SOCKETS = 32;
/** Plug hashes the cost table may price (every costing plug a piece's sockets accept). */
const MAX_PLUG_COSTS = 4000;
/** Highest armor energy cost a plug can have (pieces top out at 11). */
const MAX_PLUG_COST = 20;

const isHash = (v: unknown): v is number =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 0xffffffff;
const isIndex = (v: unknown): v is number =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) < 256;
const optional = (v: unknown, check: (v: unknown) => boolean) => v === undefined || check(v);

function isPlugRecord(v: unknown): v is Record<number, number> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const entries = Object.entries(v);
  return (
    entries.length <= MAX_TARGET_SOCKETS &&
    entries.every(([k, h]) => /^\d{1,3}$/.test(k) && isIndex(Number(k)) && isHash(h))
  );
}

function isItemTarget(t: Partial<ItemTarget> | null): boolean {
  if (!t || !isBungieId(t.itemInstanceId)) return false;
  const list = (v: unknown) => Array.isArray(v) && v.length <= MAX_TARGET_SOCKETS;
  switch (t.kind) {
    case "armor":
      return (
        list(t.sockets) &&
        (t.sockets as Partial<ArmorSocketTarget>[]).every(
          (s) =>
            isIndex(s?.index) &&
            optional(s.plug, isHash) &&
            optional(s.empty, isHash) &&
            optional(s.current, isHash),
        )
      );
    case "artifact":
      return (
        list(t.sockets) &&
        (t.sockets as Partial<ArtifactSocketTarget>[]).every(
          (s) =>
            isIndex(s?.index) && isHash(s.empty) && optional(s.plug, isHash) && optional(s.current, isHash),
        )
      );
    case "subclass":
      return (
        list(t.groups) &&
        (t.groups as Partial<SubclassGroupTarget>[]).every(
          (g) =>
            ["super", "ability", "aspect", "fragment"].includes(g?.kind as string) &&
            isIndex(g.start) &&
            Number.isInteger(g.count) &&
            (g.count as number) >= 0 &&
            (g.count as number) <= MAX_TARGET_SOCKETS &&
            Array.isArray(g.desired) &&
            g.desired.length <= MAX_TARGET_SOCKETS &&
            g.desired.every(isHash) &&
            optional(g.emptyHash, isHash) &&
            optional(g.clearUnused, (v) => typeof v === "boolean") &&
            optional(g.current, isPlugRecord),
        )
      );
    default:
      return false;
  }
}

/**
 * Validate the apply route's socket targets (see apply-targets.ts); null if malformed,
 * oversized, or naming one item twice.
 */
export function parseApplyTargets(v: unknown, { maxItems }: { maxItems: number }): ApplyTargets | null {
  const t = v as Partial<ApplyTargets> | null;
  if (!t || typeof t !== "object" || !Array.isArray(t.items) || t.items.length > maxItems) return null;
  if (!t.items.every((item) => isItemTarget(item as Partial<ItemTarget>))) return null;
  const ids = t.items.map((item) => item.itemInstanceId);
  if (new Set(ids).size !== ids.length) return null;
  const costs = t.costs ?? {};
  if (!costs || typeof costs !== "object" || Array.isArray(costs)) return null;
  const entries = Object.entries(costs);
  if (entries.length > MAX_PLUG_COSTS) return null;
  for (const [hash, cost] of entries) {
    if (!/^\d{1,10}$/.test(hash) || !isHash(Number(hash))) return null;
    if (!Number.isInteger(cost) || cost < 0 || cost > MAX_PLUG_COST) return null;
  }
  return { items: t.items as ItemTarget[], costs };
}
