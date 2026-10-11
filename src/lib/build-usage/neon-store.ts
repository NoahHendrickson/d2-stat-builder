// Neon store for the optimizer's armor usage history. Server-only.
//
// One row per (account, query, piece the query could use): whether a displayed build
// used it. Recording a query replaces that query's rows, so re-running it never counts
// twice. The schema is created lazily, like loadouts.
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type { BuildUsageSummary, PieceUsageCounts } from "./buckets";
import type { PieceUsage } from "./summarize";

/** Queries kept per account; the least recently run go first. */
export const MAX_QUERIES_PER_ACCOUNT = 1000;
/** Prune on roughly one record in this many (it groups the account's whole history). */
const PRUNE_EVERY = 10;

export class NeonBuildUsageStore {
  private readonly sql: NeonQueryFunction<false, false>;
  private schemaReady: Promise<void> | null = null;

  constructor(databaseUrl: string) {
    this.sql = neon(databaseUrl);
  }

  private ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = (async () => {
        await this.sql`
          CREATE TABLE IF NOT EXISTS armor_build_usage (
            membership_id text NOT NULL,
            query_key text NOT NULL,
            instance_id text NOT NULL,
            used boolean NOT NULL,
            seen_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (membership_id, query_key, instance_id)
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
      SELECT instance_id,
        count(*)::int AS eligible,
        count(*) FILTER (WHERE used)::int AS used
      FROM armor_build_usage WHERE membership_id = ${membershipId}
      GROUP BY instance_id`) as ({ instance_id: string } & PieceUsageCounts)[];
    const pieces: Record<string, PieceUsageCounts> = {};
    for (const r of rows) pieces[r.instance_id] = { eligible: r.eligible, used: r.used };
    return { pieces };
  }

  /** Replace one query's record with the pieces of its latest run. No pieces = no-op. */
  async record(membershipId: string, queryKey: string, pieces: readonly PieceUsage[]) {
    // An empty list would make the DELETE below wipe the query and insert nothing.
    if (pieces.length === 0) return;
    await this.ensureSchema();
    const ids = pieces.map((p) => p.id);
    const statements = [
      // Pieces that left the query's pool (deleted, or a pool toggle) drop out of it.
      this.sql`
        DELETE FROM armor_build_usage
        WHERE membership_id = ${membershipId} AND query_key = ${queryKey}
          AND NOT (instance_id = ANY(${ids}::text[]))`,
      this.sql`
        INSERT INTO armor_build_usage (membership_id, query_key, instance_id, used)
        SELECT ${membershipId}, ${queryKey}, u.id, u.used
        FROM unnest(${ids}::text[], ${pieces.map((p) => p.used)}::boolean[]) AS u(id, used)
        ON CONFLICT (membership_id, query_key, instance_id)
        DO UPDATE SET used = excluded.used, seen_at = now()`,
    ];
    if (Math.random() < 1 / PRUNE_EVERY) {
      statements.push(this.sql`
        DELETE FROM armor_build_usage
        WHERE membership_id = ${membershipId} AND query_key IN (
          SELECT query_key FROM armor_build_usage
          WHERE membership_id = ${membershipId}
          GROUP BY query_key
          ORDER BY max(seen_at) DESC
          OFFSET ${MAX_QUERIES_PER_ACCOUNT}
        )`);
    }
    await this.sql.transaction(statements);
  }

  /** Forget the account's whole history. */
  async clear(membershipId: string) {
    await this.ensureSchema();
    await this.sql`DELETE FROM armor_build_usage WHERE membership_id = ${membershipId}`;
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
