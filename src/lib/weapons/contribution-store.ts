// Neon store for signed-in players' weapons, for perk popularity
// (popularity-contribution.ts). Server-only.
//
// One row per Destiny membership: their weapons as of the latest save, gzipped.
// A save replaces the row at most every SAVE_EVERY_HOURS, so the profile route's
// polls cost one write a day or two per player; rows not saved for KEEP_DAYS
// go (each instance clears them once a day), since the copy store drops
// players who stopped playing long before that. Each crawl run reads the rows
// saved since its last one. The schema is created lazily, like loadouts.
import { gzipSync } from "node:zlib";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type { DestinyProfileResponse } from "bungie-api-ts/destiny2";
import { contributionFromProfile, encodeContribution } from "./popularity-contribution";

/** How often one player's weapons are saved again. */
export const SAVE_EVERY_HOURS = 12;
/** Rows not saved for this long are deleted. */
const KEEP_DAYS = 30;
/** Players an instance remembers saving; past this it forgets them all (the SQL guard still holds). */
const REMEMBERED = 50_000;

export class NeonContributionStore {
  private readonly sql: NeonQueryFunction<false, false>;
  private schemaReady: Promise<void> | null = null;
  /** When this instance last saved (or is saving) each membership, so polls skip the work and the write. */
  private readonly savedAt = new Map<string, number>();
  /** When this instance last deleted rows past KEEP_DAYS. */
  private clearedAt = 0;

  constructor(databaseUrl: string) {
    this.sql = neon(databaseUrl);
  }

  private ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = (async () => {
        await this.sql`
          CREATE TABLE IF NOT EXISTS popularity_contributions (
            membership_id bigint PRIMARY KEY,
            membership_type smallint NOT NULL,
            last_played timestamptz,
            saved_at timestamptz NOT NULL DEFAULT now(),
            weapons bytea NOT NULL
          )`;
        await this.sql`
          CREATE INDEX IF NOT EXISTS popularity_contributions_saved_at
          ON popularity_contributions (saved_at)`;
      })().catch((err) => {
        this.schemaReady = null; // let the next call retry
        throw err;
      });
    }
    return this.schemaReady;
  }

  /**
   * The save of the player's weapons from a profile just loaded, to run once
   * the response is out, or undefined when this instance saved them in the
   * last SAVE_EVERY_HOURS. The weapons are taken out of the profile now, so
   * the profile itself needn't outlive the response.
   */
  prepare(destinyMembershipId: string, membershipType: number, profile: DestinyProfileResponse) {
    const last = this.savedAt.get(destinyMembershipId);
    if (last !== undefined && Date.now() - last < SAVE_EVERY_HOURS * 3_600_000) return undefined;
    const read = contributionFromProfile(profile);
    if (!read) return undefined;
    if (this.savedAt.size >= REMEMBERED) this.savedAt.clear();
    this.savedAt.set(destinyMembershipId, Date.now());
    const weapons = gzipSync(encodeContribution(read.contribution)).toString("base64");
    return () =>
      this.write(destinyMembershipId, membershipType, read.lastPlayed, weapons).catch((err: unknown) => {
        // Let the next load try again.
        this.savedAt.delete(destinyMembershipId);
        throw err;
      });
  }

  private async write(destinyMembershipId: string, membershipType: number, lastPlayed: string | undefined, weapons: string) {
    await this.ensureSchema();
    await this.sql`
      INSERT INTO popularity_contributions (membership_id, membership_type, last_played, weapons)
      VALUES (${destinyMembershipId}, ${membershipType}, ${lastPlayed ?? null}, decode(${weapons}, 'base64'))
      ON CONFLICT (membership_id) DO UPDATE SET
        membership_type = EXCLUDED.membership_type,
        last_played = EXCLUDED.last_played,
        saved_at = now(),
        weapons = EXCLUDED.weapons
      WHERE popularity_contributions.saved_at < now() - make_interval(hours => ${SAVE_EVERY_HOURS})`;
    if (Date.now() - this.clearedAt > 86_400_000) {
      this.clearedAt = Date.now();
      await this.sql`
        DELETE FROM popularity_contributions
        WHERE saved_at < now() - make_interval(days => ${KEEP_DAYS})`;
    }
  }
}

let singleton: NeonContributionStore | null | undefined;

/** The server's contribution store, or null when `DATABASE_URL` isn't set. */
export function getServerContributionStore(): NeonContributionStore | null {
  if (singleton !== undefined) return singleton;
  const url = process.env.DATABASE_URL;
  singleton = url ? new NeonContributionStore(url) : null;
  return singleton;
}
