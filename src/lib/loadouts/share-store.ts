// Shared-loadout snapshots in Neon. Server-only. A share is immutable: editing or
// deleting the loadout later leaves links already sent alone, like the self-contained
// links before them.
import { cacheLife } from "next/cache";
import { neon } from "@neondatabase/serverless";
import { fromDatabaseUrl, lazySchema } from "../db/neon";
import { fromCache, loggedRead } from "../read-cache";
import { shareableData } from "./share";
import { shareCodeFor } from "./share-code";
import { parseSavedLoadoutData, type SavedLoadoutData } from "./types";

/**
 * New shares one account may create in a day: far past real use, but bounds how fast
 * the table can grow. Shares are never deleted, so a lifetime cap would lock an
 * account out for good.
 */
export const MAX_SHARES_PER_DAY = 200;

export class ShareLimitError extends Error {
  constructor() {
    super(`Share limit reached (${MAX_SHARES_PER_DAY} a day)`);
    this.name = "ShareLimitError";
  }
}

/** The query tag the store runs on: Neon's in production, any Postgres in tests. */
export type Sql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Record<string, unknown>[]>;

export class NeonShareStore {
  constructor(private readonly sql: Sql) {}

  private readonly ensureSchema = lazySchema(async () => {
    await this.sql`
      CREATE TABLE IF NOT EXISTS loadout_shares (
        code text PRIMARY KEY,
        membership_id text NOT NULL,
        data jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`;
    await this.sql`
      CREATE INDEX IF NOT EXISTS loadout_shares_owner_idx
        ON loadout_shares (membership_id, created_at)`;
  });

  /** Store a snapshot and return its code. Throws ShareLimitError at the daily limit. */
  async create(membershipId: string, saved: SavedLoadoutData): Promise<string> {
    await this.ensureSchema();
    const json = JSON.stringify(shareableData(saved));
    const code = shareCodeFor(json);
    // The limit rides in the INSERT (counted off the owner index), as in neon-store.ts.
    const inserted = await this.sql`
      INSERT INTO loadout_shares (code, membership_id, data)
      SELECT ${code}, ${membershipId}, ${json}::jsonb
      WHERE (
        SELECT count(*) FROM loadout_shares
        WHERE membership_id = ${membershipId} AND created_at > now() - interval '1 day'
      ) < ${MAX_SHARES_PER_DAY}
      ON CONFLICT (code) DO NOTHING
      RETURNING code`;
    if (inserted[0]) return code;
    // Nothing inserted. The row is already there (a repeat share, or a racing one won),
    // the code belongs to a different loadout, or the owner is at the daily limit.
    const existing = await this.sql`
      SELECT data = ${json}::jsonb AS same FROM loadout_shares WHERE code = ${code}`;
    if (!existing[0]) throw new ShareLimitError();
    if (existing[0].same) return code;
    throw new Error("Share code collision"); // ~59-bit codes: not expected in practice
  }

  /** The shared loadout, or null when the code is unknown (or no longer parses). */
  async get(code: string): Promise<SavedLoadoutData | null> {
    await this.ensureSchema();
    const rows = await this.sql`SELECT data FROM loadout_shares WHERE code = ${code}`;
    return rows[0] ? parseSavedLoadoutData(rows[0].data) : null;
  }
}

/** The share store, or null when `DATABASE_URL` isn't set. */
export const getShareStore = fromDatabaseUrl((url) => new NeonShareStore(neon(url)));

async function cachedShare(code: string) {
  "use cache: remote";
  // Shares never change, so a found one can be kept for good. An unknown code is kept
  // too, so repeat lookups of a bad link stay off Neon. A code only exists once it has
  // been created (it is a hash of the loadout), so nobody asks for one too early.
  cacheLife("max");
  return loggedRead("Share", () => getShareStore()!.get(code));
}

/** A shared loadout from Vercel's shared cache, reaching Neon only on a miss. Call when `getShareStore()` isn't null. */
export function readShare(code: string): Promise<SavedLoadoutData | null> {
  return fromCache(cachedShare(code));
}
