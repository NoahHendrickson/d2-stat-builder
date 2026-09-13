// Neon (serverless Postgres) implementation of LoadoutStore. Server-only.
//
// One table, one JSONB column: loadouts are small (~1–2 KB) and few per user, and the
// list endpoint returns them all, so there is nothing to gain from normalizing. The
// schema is created lazily on first use (`CREATE TABLE IF NOT EXISTS`) — no migration
// tooling for a single table on a hobby deploy. Add a real migration step if the
// schema ever changes shape.
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type { LoadoutStore } from "./store";
import { parseSavedLoadoutData, type SavedLoadout, type SavedLoadoutData } from "./types";

interface Row {
  id: string;
  data: unknown;
  created_at: string | Date;
  updated_at: string | Date;
}

const toMs = (v: string | Date) => (v instanceof Date ? v.getTime() : Date.parse(v));

function rowToLoadout(row: Row): SavedLoadout | null {
  const data = parseSavedLoadoutData(row.data);
  if (!data) return null;
  return { ...data, id: row.id, createdAt: toMs(row.created_at), updatedAt: toMs(row.updated_at) };
}

export class NeonLoadoutStore implements LoadoutStore {
  private readonly sql: NeonQueryFunction<false, false>;
  private schemaReady: Promise<void> | null = null;

  constructor(databaseUrl: string) {
    this.sql = neon(databaseUrl);
  }

  private ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = (async () => {
        await this.sql`
          CREATE TABLE IF NOT EXISTS loadouts (
            id uuid PRIMARY KEY,
            membership_id text NOT NULL,
            data jsonb NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
          )`;
        await this.sql`
          CREATE INDEX IF NOT EXISTS loadouts_owner_idx
            ON loadouts (membership_id, updated_at DESC)`;
      })().catch((err) => {
        this.schemaReady = null; // let the next call retry
        throw err;
      });
    }
    return this.schemaReady;
  }

  async list(membershipId: string): Promise<SavedLoadout[]> {
    await this.ensureSchema();
    const rows = (await this.sql`
      SELECT id, data, created_at, updated_at FROM loadouts
      WHERE membership_id = ${membershipId}
      ORDER BY updated_at DESC`) as Row[];
    // A row that no longer parses (schema drift) is skipped rather than failing the list.
    return rows.map(rowToLoadout).filter((l): l is SavedLoadout => l !== null);
  }

  async get(membershipId: string, id: string): Promise<SavedLoadout | null> {
    await this.ensureSchema();
    const rows = (await this.sql`
      SELECT id, data, created_at, updated_at FROM loadouts
      WHERE membership_id = ${membershipId} AND id = ${id}::uuid`) as Row[];
    return rows[0] ? rowToLoadout(rows[0]) : null;
  }

  async create(
    membershipId: string,
    data: SavedLoadoutData,
    id = crypto.randomUUID(),
  ): Promise<SavedLoadout> {
    await this.ensureSchema();
    const rows = (await this.sql`
      INSERT INTO loadouts (id, membership_id, data)
      VALUES (${id}::uuid, ${membershipId}, ${JSON.stringify(data)}::jsonb)
      RETURNING id, data, created_at, updated_at`) as Row[];
    const row = rowToLoadout(rows[0]);
    if (!row) throw new Error("Stored loadout failed to parse back");
    return row;
  }

  async update(
    membershipId: string,
    id: string,
    data: SavedLoadoutData,
  ): Promise<SavedLoadout | null> {
    await this.ensureSchema();
    const rows = (await this.sql`
      UPDATE loadouts SET data = ${JSON.stringify(data)}::jsonb, updated_at = now()
      WHERE membership_id = ${membershipId} AND id = ${id}::uuid
      RETURNING id, data, created_at, updated_at`) as Row[];
    return rows[0] ? rowToLoadout(rows[0]) : null;
  }

  async delete(membershipId: string, id: string): Promise<boolean> {
    await this.ensureSchema();
    const rows = (await this.sql`
      DELETE FROM loadouts
      WHERE membership_id = ${membershipId} AND id = ${id}::uuid
      RETURNING id`) as Row[];
    return rows.length > 0;
  }
}

let singleton: LoadoutStore | null | undefined;

/**
 * The server's loadout store, or null when `DATABASE_URL` isn't set (routes answer 503
 * so the UI can explain that storage isn't configured instead of failing opaquely).
 */
export function getServerLoadoutStore(): LoadoutStore | null {
  if (singleton !== undefined) return singleton;
  const url = process.env.DATABASE_URL;
  singleton = url ? new NeonLoadoutStore(url) : null;
  return singleton;
}
