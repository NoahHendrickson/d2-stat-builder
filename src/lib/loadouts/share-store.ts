// Shared-loadout snapshots in Neon. Server-only. A share is immutable: editing or
// deleting the loadout later leaves links already sent alone, like the self-contained
// links before them.
import { neon } from "@neondatabase/serverless";
import { fromDatabaseUrl, lazySchema } from "../db/neon";
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
        ON loadout_shares (membership_id)`;
  });

  /** Store a snapshot and return its code. Throws ShareLimitError at the cap. */
  async create(membershipId: string, saved: SavedLoadoutData): Promise<string> {
    await this.ensureSchema();
    const json = JSON.stringify(shareableData(saved));
    const code = shareCodeFor(json);
    // The cap rides in the INSERT (counted off the owner index), as in neon-store.ts.
    const inserted = await this.sql`
      INSERT INTO loadout_shares (code, membership_id, data)
      SELECT ${code}, ${membershipId}, ${json}::jsonb
      WHERE (SELECT count(*) FROM loadout_shares WHERE membership_id = ${membershipId})
        < ${MAX_SHARES_PER_ACCOUNT}
      ON CONFLICT (code) DO NOTHING
      RETURNING code`;
    if (inserted[0]) return code;
    // Nothing inserted. The row is already there (a repeat share, or a racing one won),
    // the code belongs to a different loadout, or the owner is at the cap.
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
