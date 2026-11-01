// Shared-loadout snapshots in Neon. Server-only. A share is immutable: editing or
// deleting the loadout later leaves links already sent alone, like the self-contained
// links before them. Same lazy-schema approach as neon-store.ts.
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { shareableData } from "./share";
import { shareCodeFor } from "./share-code";
import { parseSavedLoadoutData, type SavedLoadoutData } from "./types";

/** Most shares one account may create — far past real use, but bounds the table. */
export const MAX_SHARES_PER_ACCOUNT = 2000;

export class ShareLimitError extends Error {
  constructor() {
    super(`Share limit reached (${MAX_SHARES_PER_ACCOUNT})`);
    this.name = "ShareLimitError";
  }
}

export class NeonShareStore {
  private readonly sql: NeonQueryFunction<false, false>;
  private schemaReady: Promise<void> | null = null;

  constructor(databaseUrl: string) {
    this.sql = neon(databaseUrl);
  }

  private ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = (async () => {
        await this.sql`
          CREATE TABLE IF NOT EXISTS loadout_shares (
            code text PRIMARY KEY,
            membership_id text NOT NULL,
            data jsonb NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now()
          )`;
        await this.sql`
          CREATE INDEX IF NOT EXISTS loadout_shares_owner_idx
            ON loadout_shares (membership_id)`;
      })().catch((err) => {
        this.schemaReady = null; // let the next call retry
        throw err;
      });
    }
    return this.schemaReady;
  }

  /** Store a snapshot and return its code. Throws ShareLimitError at the cap. */
  async create(membershipId: string, saved: SavedLoadoutData): Promise<string> {
    await this.ensureSchema();
    const json = JSON.stringify(shareableData(saved));
    const code = shareCodeFor(json);
    // Sharing the same loadout again finds the row it already made.
    const existing = (await this.sql`
      SELECT data = ${json}::jsonb AS same FROM loadout_shares WHERE code = ${code}`) as {
      same: boolean;
    }[];
    if (existing[0]) {
      if (existing[0].same) return code;
      throw new Error("Share code collision"); // ~59-bit codes: not expected in practice
    }
    // The cap rides in the INSERT (counted off the owner index), as in neon-store.ts.
    const rows = (await this.sql`
      INSERT INTO loadout_shares (code, membership_id, data)
      SELECT ${code}, ${membershipId}, ${json}::jsonb
      WHERE (SELECT count(*) FROM loadout_shares WHERE membership_id = ${membershipId})
        < ${MAX_SHARES_PER_ACCOUNT}
      ON CONFLICT (code) DO NOTHING
      RETURNING code`) as { code: string }[];
    if (rows[0]) return code;
    // Nothing inserted: a racing share of the same loadout won, or the owner is at the cap.
    const raced = (await this.sql`
      SELECT 1 FROM loadout_shares WHERE code = ${code}`) as unknown[];
    if (raced.length > 0) return code;
    throw new ShareLimitError();
  }

  /** The shared loadout, or null when the code is unknown (or no longer parses). */
  async get(code: string): Promise<SavedLoadoutData | null> {
    await this.ensureSchema();
    const rows = (await this.sql`
      SELECT data FROM loadout_shares WHERE code = ${code}`) as { data: unknown }[];
    return rows[0] ? parseSavedLoadoutData(rows[0].data) : null;
  }
}

let singleton: NeonShareStore | null | undefined;

/** The share store, or null when `DATABASE_URL` isn't set. */
export function getShareStore(): NeonShareStore | null {
  if (singleton !== undefined) return singleton;
  const url = process.env.DATABASE_URL;
  singleton = url ? new NeonShareStore(url) : null;
  return singleton;
}
