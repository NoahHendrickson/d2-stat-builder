// Neon store for the optimizer's armor usage history. Server-only.
//
// Two tables: one row per (account, query) with when it last ran, and one compact row
// per (query, piece the query could use) saying whether a displayed build used it.
// Recording a query replaces that query's pieces, so re-running it never counts twice;
// the oldest queries beyond the cap go on every record, and their pieces cascade with
// them. The schema is created lazily, like loadouts.
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type { BuildUsageSummary, PieceUsageCounts } from "./buckets";
import type { PieceUsage } from "./summarize";

/** Queries kept per account; the least recently run go first. */
export const MAX_QUERIES_PER_ACCOUNT = 500;

export class NeonBuildUsageStore {
  private readonly sql: NeonQueryFunction<false, false>;
  private schemaReady: Promise<void> | null = null;

  constructor(databaseUrl: string) {
    this.sql = neon(databaseUrl);
  }

  private ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = (async () => {
        // The first, unreleased layout (one wide row per query × piece); it only ever
        // held test data.
        await this.sql`DROP TABLE IF EXISTS armor_build_usage`;
        await this.sql`
          CREATE TABLE IF NOT EXISTS armor_usage_queries (
            id bigserial PRIMARY KEY,
            membership_id text NOT NULL,
            query_key text NOT NULL,
            seen_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (membership_id, query_key)
          )`;
        await this.sql`
          CREATE TABLE IF NOT EXISTS armor_usage_pieces (
            query_id bigint NOT NULL REFERENCES armor_usage_queries (id) ON DELETE CASCADE,
            instance_id bigint NOT NULL,
            used boolean NOT NULL,
            PRIMARY KEY (query_id, instance_id)
          )`;
      })().catch((err) => {
        this.schemaReady = null; // let the next call retry
        throw err;
      });
    }
    return this.schemaReady;
  }

  async summary(membershipId: string): Promise<BuildUsageSummary> {
    await this.ensureSchema();
    const rows = (await this.sql`
      SELECT p.instance_id::text AS instance_id,
        count(*)::int AS eligible,
        count(*) FILTER (WHERE p.used)::int AS used
      FROM armor_usage_pieces p
      JOIN armor_usage_queries q ON q.id = p.query_id
      WHERE q.membership_id = ${membershipId}
      GROUP BY p.instance_id`) as ({ instance_id: string } & PieceUsageCounts)[];
    const pieces: Record<string, PieceUsageCounts> = {};
    for (const r of rows) pieces[r.instance_id] = { eligible: r.eligible, used: r.used };
    return { pieces };
  }

  /** Replace one query's record with the pieces of its latest run. No pieces = no-op. */
  async record(membershipId: string, queryKey: string, pieces: readonly PieceUsage[]) {
    // An empty list would wipe the query's pieces and insert nothing.
    if (pieces.length === 0) return;
    await this.ensureSchema();
    await this.sql.transaction([
      this.sql`
        INSERT INTO armor_usage_queries (membership_id, query_key)
        VALUES (${membershipId}, ${queryKey})
        ON CONFLICT (membership_id, query_key) DO UPDATE SET seen_at = now()`,
      this.sql`
        DELETE FROM armor_usage_pieces
        WHERE query_id = (
          SELECT id FROM armor_usage_queries
          WHERE membership_id = ${membershipId} AND query_key = ${queryKey}
        )`,
      this.sql`
        INSERT INTO armor_usage_pieces (query_id, instance_id, used)
        SELECT q.id, u.id, u.used
        FROM armor_usage_queries q,
          unnest(
            ${pieces.map((p) => p.id)}::bigint[],
            ${pieces.map((p) => p.used)}::boolean[]
          ) AS u(id, used)
        WHERE q.membership_id = ${membershipId} AND q.query_key = ${queryKey}`,
      this.sql`
        DELETE FROM armor_usage_queries
        WHERE id IN (
          SELECT id FROM armor_usage_queries
          WHERE membership_id = ${membershipId}
          ORDER BY seen_at DESC
          OFFSET ${MAX_QUERIES_PER_ACCOUNT}
        )`,
    ]);
  }

  /** Forget the account's whole history. */
  async clear(membershipId: string) {
    await this.ensureSchema();
    await this.sql`DELETE FROM armor_usage_queries WHERE membership_id = ${membershipId}`;
  }
}

let singleton: NeonBuildUsageStore | null | undefined;

/** The server's usage store, or null when `DATABASE_URL` isn't set. */
export function getServerBuildUsageStore(): NeonBuildUsageStore | null {
  if (singleton !== undefined) return singleton;
  const url = process.env.DATABASE_URL;
  singleton = url ? new NeonBuildUsageStore(url) : null;
  return singleton;
}
