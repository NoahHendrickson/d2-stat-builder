// Cancel flags for in-flight loadout applies. Server-only. The apply's request runs on
// its own function instance and keeps going if the client drops (see the apply route),
// so the Cancel button can't just close the stream: it writes a flag here, and the
// apply checks for it between Bungie calls. Neon when `DATABASE_URL` is set (same lazy
// schema as the settings store), else process memory — enough for a single dev server.
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

export interface ApplyCancelStore {
  cancel(membershipId: string, applyId: string): Promise<void>;
  isCancelled(membershipId: string, applyId: string): Promise<boolean>;
}

class NeonApplyCancelStore implements ApplyCancelStore {
  private readonly sql: NeonQueryFunction<false, false>;
  private schemaReady: Promise<void> | null = null;

  constructor(databaseUrl: string) {
    this.sql = neon(databaseUrl);
  }

  private ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = (async () => {
        await this.sql`
          CREATE TABLE IF NOT EXISTS apply_cancellations (
            membership_id text NOT NULL,
            apply_id text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (membership_id, apply_id)
          )`;
      })().catch((err) => {
        this.schemaReady = null; // let the next call retry
        throw err;
      });
    }
    return this.schemaReady;
  }

  async cancel(membershipId: string, applyId: string) {
    await this.ensureSchema();
    // An apply lasts a minute at most, so older flags are dead weight.
    await this.sql`DELETE FROM apply_cancellations WHERE created_at < now() - interval '1 hour'`;
    await this.sql`
      INSERT INTO apply_cancellations (membership_id, apply_id)
      VALUES (${membershipId}, ${applyId})
      ON CONFLICT DO NOTHING`;
  }

  async isCancelled(membershipId: string, applyId: string) {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT 1 FROM apply_cancellations
      WHERE membership_id = ${membershipId} AND apply_id = ${applyId}`;
    return rows.length > 0;
  }
}

class MemoryApplyCancelStore implements ApplyCancelStore {
  private readonly flags = new Set<string>();

  async cancel(membershipId: string, applyId: string) {
    this.flags.add(`${membershipId}:${applyId}`);
  }

  async isCancelled(membershipId: string, applyId: string) {
    return this.flags.has(`${membershipId}:${applyId}`);
  }
}

let singleton: ApplyCancelStore | undefined;

export function getApplyCancelStore(): ApplyCancelStore {
  if (!singleton) {
    const url = process.env.DATABASE_URL;
    singleton = url ? new NeonApplyCancelStore(url) : new MemoryApplyCancelStore();
  }
  return singleton;
}

/** A client-made apply id: a UUID, or anything else short and plain. */
export function isApplyId(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9-]{8,64}$/.test(v);
}
