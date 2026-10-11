// The record request's body, shared by the client (encode) and the route (decode).
// Compact on purpose: a query's pool can be a few hundred pieces.
//
// Runtime imports are relative (not `@/`) — the vitest runner has no `@/` alias.
import { isInstanceId, type PieceUsage } from "./summarize";

/** Most pieces one record accepts — a full vault is 600 pieces across every class. */
export const MAX_RECORD_PIECES = 3000;

/** 0 = not used, 1 = used only in beaten builds, 2 = used in a build nothing beat. */
type UsageFlag = 0 | 1 | 2;

export interface RecordBody {
  key: string;
  pieces: [string, UsageFlag][];
}

export function encodeRecord(key: string, pieces: readonly PieceUsage[]): RecordBody {
  return {
    key,
    pieces: pieces.map((p) => [p.id, p.optimal ? 2 : p.used ? 1 : 0]),
  };
}

/** SHA-256 hex of the query identity (see `queryIdentity`). */
const QUERY_KEY = /^[0-9a-f]{64}$/;

export function decodeRecord(body: unknown): { key: string; pieces: PieceUsage[] } | null {
  if (!body || typeof body !== "object") return null;
  const { key, pieces } = body as Partial<Record<keyof RecordBody, unknown>>;
  if (typeof key !== "string" || !QUERY_KEY.test(key)) return null;
  if (!Array.isArray(pieces) || pieces.length === 0 || pieces.length > MAX_RECORD_PIECES) {
    return null;
  }
  const seen = new Set<string>();
  const out: PieceUsage[] = [];
  for (const entry of pieces) {
    if (!Array.isArray(entry) || entry.length !== 2) return null;
    const [id, flag] = entry as unknown[];
    if (typeof id !== "string" || !isInstanceId(id) || (flag !== 0 && flag !== 1 && flag !== 2)) {
      return null;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, used: flag > 0, optimal: flag === 2 });
  }
  return { key, pieces: out };
}
