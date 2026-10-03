// Account-synced settings in Neon. Server-only. One row per (account, key) so two
// computers editing different settings never overwrite each other. Same lazy-schema
// approach as the loadouts store (see src/lib/loadouts/neon-store.ts).
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import {
  isSettingKey,
  parseSettingValue,
  type SettingKey,
  type SettingValues,
  type StoredSetting,
  type StoredSettings,
} from "./keys";

interface Row {
  key: string;
  value: unknown;
  updated_at: string | Date;
}

const toMs = (v: string | Date) => (v instanceof Date ? v.getTime() : Date.parse(v));

export class NeonSettingsStore {
  private readonly sql: NeonQueryFunction<false, false>;
  private schemaReady: Promise<void> | null = null;

  constructor(databaseUrl: string) {
    this.sql = neon(databaseUrl);
  }

  private ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = (async () => {
        await this.sql`
          CREATE TABLE IF NOT EXISTS user_settings (
            membership_id text NOT NULL,
            key text NOT NULL,
            value jsonb NOT NULL,
            updated_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (membership_id, key)
          )`;
      })().catch((err) => {
        this.schemaReady = null; // let the next call retry
        throw err;
      });
    }
    return this.schemaReady;
  }

  async list(membershipId: string): Promise<StoredSettings> {
    await this.ensureSchema();
    const rows = (await this.sql`
      SELECT key, value, updated_at FROM user_settings
      WHERE membership_id = ${membershipId}`) as Row[];
    const out: Record<string, StoredSetting> = {};
    for (const row of rows) {
      // Keys this build doesn't know (or values that no longer parse) are skipped.
      if (!isSettingKey(row.key)) continue;
      const value = parseSettingValue(row.key, row.value);
      if (value) out[row.key] = { value, updatedAt: toMs(row.updated_at) };
    }
    return out as StoredSettings;
  }

  async put<K extends SettingKey>(
    membershipId: string,
    key: K,
    value: SettingValues[K],
  ): Promise<StoredSetting<K>> {
    await this.ensureSchema();
    const rows = (await this.sql`
      INSERT INTO user_settings (membership_id, key, value)
      VALUES (${membershipId}, ${key}, ${JSON.stringify(value)}::jsonb)
      ON CONFLICT (membership_id, key)
        DO UPDATE SET value = EXCLUDED.value, updated_at = now()
      RETURNING updated_at`) as Pick<Row, "updated_at">[];
    return { value, updatedAt: toMs(rows[0].updated_at) };
  }
}

let singleton: NeonSettingsStore | null | undefined;

/** The server's settings store, or null when `DATABASE_URL` isn't set. */
export function getServerSettingsStore(): NeonSettingsStore | null {
  if (singleton !== undefined) return singleton;
  const url = process.env.DATABASE_URL;
  singleton = url ? new NeonSettingsStore(url) : null;
  return singleton;
}
