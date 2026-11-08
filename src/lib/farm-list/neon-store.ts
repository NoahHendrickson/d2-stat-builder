// The Farm list in Neon. Server-only. One row per entry: the picks in `data`
// (validated by parseFarmEntryData), and the obtained state in columns of its own so a
// match, a "not this one", and a seen mark are single-statement updates that never
// race a whole-row write. Lazy schema and a cached list, as in src/lib/loadouts/neon-store.ts.
import { cacheLife, cacheTag } from "next/cache";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { fromDatabaseUrl, lazySchema } from "../db/neon";
import { ACCOUNT_READ_LIFE, expiring, fromCache, loggedRead } from "../read-cache";
import {
  MAX_IGNORED_COPIES,
  MAX_FARM_ENTRIES_PER_ACCOUNT,
  parseFarmEntryData,
  type FarmEntry,
  type FarmEntryData,
  type FarmPatch,
} from "./types";

interface Row {
  id: string;
  data: unknown;
  created_at: string | Date;
  obtained_instance_id: string | null;
  obtained_at: string | Date | null;
  seen_at: string | Date | null;
  done_at: string | Date | null;
}

const toMs = (v: string | Date) => (v instanceof Date ? v.getTime() : Date.parse(v));

function rowToEntry(row: Row): FarmEntry | null {
  const data = parseFarmEntryData(row.data);
  if (!data) return null;
  return {
    ...data,
    id: row.id,
    createdAt: toMs(row.created_at),
    ...(row.obtained_instance_id && row.obtained_at
      ? {
          obtained: {
            instanceId: row.obtained_instance_id,
            at: toMs(row.obtained_at),
            seen: row.seen_at !== null,
            ...(row.done_at ? { doneAt: toMs(row.done_at) } : {}),
          },
        }
      : {}),
  };
}

/** Thrown by `create` when the owner already has MAX_FARM_ENTRIES_PER_ACCOUNT rows. */
export class FarmListLimitError extends Error {
  constructor() {
    super(`Farm list limit reached (${MAX_FARM_ENTRIES_PER_ACCOUNT})`);
    this.name = "FarmListLimitError";
  }
}

export class NeonFarmListStore {
  private readonly sql: NeonQueryFunction<false, false>;

  constructor(databaseUrl: string) {
    this.sql = neon(databaseUrl);
  }

  private readonly ensureSchema = lazySchema(async () => {
    await this.sql`
      CREATE TABLE IF NOT EXISTS farm_list (
        id uuid PRIMARY KEY,
        membership_id text NOT NULL,
        data jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        obtained_instance_id text,
        obtained_at timestamptz,
        seen_at timestamptz,
        done_at timestamptz
      )`;
    await this.sql`
      CREATE INDEX IF NOT EXISTS farm_list_owner_idx
        ON farm_list (membership_id, created_at DESC)`;
  });

  async list(membershipId: string): Promise<FarmEntry[]> {
    await this.ensureSchema();
    const rows = (await this.sql`
      SELECT * FROM farm_list WHERE membership_id = ${membershipId}
      ORDER BY created_at DESC`) as Row[];
    return rows.map(rowToEntry).filter((w): w is FarmEntry => w !== null);
  }

  async create(membershipId: string, data: FarmEntryData): Promise<FarmEntry> {
    await this.ensureSchema();
    // The cap rides in the INSERT, as the loadouts store does it.
    const rows = (await this.sql`
      INSERT INTO farm_list (id, membership_id, data)
      SELECT ${crypto.randomUUID()}::uuid, ${membershipId}, ${JSON.stringify(data)}::jsonb
      WHERE (SELECT count(*) FROM farm_list WHERE membership_id = ${membershipId})
        < ${MAX_FARM_ENTRIES_PER_ACCOUNT}
      RETURNING *`) as Row[];
    if (!rows[0]) throw new FarmListLimitError();
    const entry = rowToEntry(rows[0]);
    if (!entry) throw new Error("Stored entry failed to parse back");
    return entry;
  }

  /** Returns null when the row doesn't exist for this owner. */
  async patch(membershipId: string, id: string, patch: FarmPatch): Promise<FarmEntry | null> {
    await this.ensureSchema();
    const rows = (
      "done" in patch
        ? await this.sql`
            UPDATE farm_list SET done_at = now()
            WHERE membership_id = ${membershipId} AND id = ${id}::uuid
              AND obtained_instance_id IS NOT NULL AND done_at IS NULL
            RETURNING *`
        : "obtained" in patch
        ? // Only the first match sticks, and never a copy the entry ignores.
          await this.sql`
            UPDATE farm_list SET obtained_instance_id = ${patch.obtained}, obtained_at = now(),
              seen_at = NULL
            WHERE membership_id = ${membershipId} AND id = ${id}::uuid
              AND obtained_instance_id IS NULL
              AND NOT coalesce(data->'ignoredInstanceIds', '[]'::jsonb)
                @> jsonb_build_array(${patch.obtained}::text)
            RETURNING *`
        : // Not this one: ignore the copy (keeping the newest ids) and wait again.
          await this.sql`
            UPDATE farm_list SET
              data = jsonb_set(data, '{ignoredInstanceIds}', (
                SELECT coalesce(jsonb_agg(v ORDER BY n), '[]'::jsonb) FROM (
                  SELECT v, n FROM jsonb_array_elements(
                    coalesce(data->'ignoredInstanceIds', '[]'::jsonb)
                      || to_jsonb(obtained_instance_id)
                  ) WITH ORDINALITY AS e(v, n)
                  ORDER BY n DESC LIMIT ${MAX_IGNORED_COPIES}
                ) kept
              )),
              obtained_instance_id = NULL, obtained_at = NULL, seen_at = NULL, done_at = NULL
            WHERE membership_id = ${membershipId} AND id = ${id}::uuid
              AND obtained_instance_id IS NOT NULL
            RETURNING *`
    ) as Row[];
    if (rows[0]) return rowToEntry(rows[0]);
    // Nothing to change (already obtained, or already waiting): answer with the row as is.
    const current = (await this.sql`
      SELECT * FROM farm_list WHERE membership_id = ${membershipId} AND id = ${id}::uuid`) as Row[];
    return current[0] ? rowToEntry(current[0]) : null;
  }

  /** Marks every obtained entry as seen. */
  async markSeen(membershipId: string): Promise<void> {
    await this.ensureSchema();
    await this.sql`
      UPDATE farm_list SET seen_at = now()
      WHERE membership_id = ${membershipId} AND obtained_at IS NOT NULL AND seen_at IS NULL`;
  }

  async delete(membershipId: string, id: string): Promise<boolean> {
    await this.ensureSchema();
    const rows = (await this.sql`
      DELETE FROM farm_list WHERE membership_id = ${membershipId} AND id = ${id}::uuid
      RETURNING id`) as Pick<Row, "id">[];
    return rows.length > 0;
  }
}

let neonSingleton: NeonFarmListStore | undefined;

/** The Neon store under the cache. A cached function can't close over an instance, so it's module-level. */
function neonStore(): NeonFarmListStore {
  if (!neonSingleton) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL isn't set");
    neonSingleton = new NeonFarmListStore(url);
  }
  return neonSingleton;
}

const accountTag = (membershipId: string) => `farm-list:${membershipId}`;

async function cachedList(membershipId: string) {
  "use cache: remote";
  cacheTag(accountTag(membershipId));
  cacheLife(ACCOUNT_READ_LIFE);
  return loggedRead("Farm list", () => neonStore().list(membershipId));
}

/** Neon behind Vercel's shared cache (see read-cache.ts): `list` is cached per account, and every write expires it. */
class CachedFarmListStore {
  list(membershipId: string) {
    return fromCache(cachedList(membershipId));
  }
  create(membershipId: string, data: FarmEntryData) {
    return expiring(accountTag(membershipId), () => neonStore().create(membershipId, data));
  }
  patch(membershipId: string, id: string, patch: FarmPatch) {
    return expiring(accountTag(membershipId), () => neonStore().patch(membershipId, id, patch));
  }
  markSeen(membershipId: string) {
    return expiring(accountTag(membershipId), () => neonStore().markSeen(membershipId));
  }
  delete(membershipId: string, id: string) {
    return expiring(accountTag(membershipId), () => neonStore().delete(membershipId, id));
  }
}

/** The server's Farm list store, or null when `DATABASE_URL` isn't set. */
export const getServerFarmListStore: () => CachedFarmListStore | null = fromDatabaseUrl(() => new CachedFarmListStore());
