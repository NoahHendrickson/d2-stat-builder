// Neon store for "Send feedback" (bug reports and ideas). Server-only.
//
// One row per report, from a signed-in account. Inserts are capped per account (an hour
// and a day) and across everyone (a day). The caps are checked in the insert itself,
// behind a lock every insert takes, so parallel requests can't all read the same count
// and slip past. The schema is created lazily, like loadouts.
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { fromDatabaseUrl, lazySchema } from "../db/neon";
import type { BugReportContext, FeedbackKind } from "./bug-report";

/** Reports one account can make in an hour. */
export const MAX_REPORTS_PER_ACCOUNT_HOUR = 5;
/** Reports one account can make in a day. */
export const MAX_REPORTS_PER_ACCOUNT_DAY = 10;
/**
 * Reports everyone together can make in a day, so a flood can't fill the database. High
 * enough that using it up takes a hundred accounts at their daily cap.
 */
export const MAX_REPORTS_PER_DAY = 1000;

export interface NewBugReport {
  kind: FeedbackKind;
  title: string;
  description: string;
  context: BugReportContext;
  userAgent: string;
  /** The host it was sent to, e.g. canary.d2conflux.com. */
  host: string;
  /** Short commit SHA of the deploy, when known. */
  build: string;
  membershipId: string;
  displayName: string | null;
}

export class NeonBugReportStore {
  private readonly sql: NeonQueryFunction<false, false>;

  constructor(databaseUrl: string) {
    this.sql = neon(databaseUrl);
  }

  private readonly ensureSchema = lazySchema(async () => {
    await this.sql`
      CREATE TABLE IF NOT EXISTS bug_reports (
        id bigserial PRIMARY KEY,
        created_at timestamptz NOT NULL DEFAULT now(),
        kind text NOT NULL DEFAULT 'bug',
        title text NOT NULL,
        description text NOT NULL,
        path text NOT NULL,
        viewport text NOT NULL,
        theme text NOT NULL,
        user_agent text NOT NULL,
        host text NOT NULL,
        build text NOT NULL,
        membership_id text NOT NULL,
        display_name text
      )`;
    // Tables made before ideas existed lack `kind`. Check first: ALTER TABLE takes an
    // exclusive lock (and needs ownership) even when the column is already there.
    const [{ missing }] = (await this.sql`
      SELECT NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'bug_reports' AND column_name = 'kind'
      ) AS missing`) as { missing: boolean }[];
    if (missing) {
      await this.sql`
        ALTER TABLE bug_reports ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'bug'`;
    }
    await this.sql`
      CREATE INDEX IF NOT EXISTS bug_reports_account_created
      ON bug_reports (membership_id, created_at)`;
    await this.sql`
      CREATE INDEX IF NOT EXISTS bug_reports_created ON bug_reports (created_at)`;
  });

  /** Save a report. Its id, or null when the account or the day is over its cap. */
  async add(r: NewBugReport): Promise<string | null> {
    await this.ensureSchema();
    // Read committed: the insert's counts see every report committed by whoever held the
    // lock before. Bug reports are rare, so one lock for all of them costs nothing.
    const [, rows] = (await this.sql.transaction(
      [
        this.sql`SELECT pg_advisory_xact_lock(hashtext('bug_reports'))`,
        this.sql`
          INSERT INTO bug_reports (kind, title, description, path, viewport, theme, user_agent, host,
            build, membership_id, display_name)
          SELECT ${r.kind}, ${r.title}, ${r.description}, ${r.context.path}, ${r.context.viewport},
            ${r.context.theme}, ${r.userAgent}, ${r.host}, ${r.build}, ${r.membershipId},
            ${r.displayName}
          WHERE (
            SELECT count(*) FROM bug_reports
            WHERE membership_id = ${r.membershipId} AND created_at > now() - interval '1 hour'
          ) < ${MAX_REPORTS_PER_ACCOUNT_HOUR}
          AND (
            SELECT count(*) FROM bug_reports
            WHERE membership_id = ${r.membershipId} AND created_at > now() - interval '1 day'
          ) < ${MAX_REPORTS_PER_ACCOUNT_DAY}
          AND (
            SELECT count(*) FROM bug_reports WHERE created_at > now() - interval '1 day'
          ) < ${MAX_REPORTS_PER_DAY}
          RETURNING id::text AS id`,
      ],
      { isolationLevel: "ReadCommitted" },
    )) as [unknown, { id: string }[]];
    return rows[0]?.id ?? null;
  }
}

/** The server's bug report store, or null when `DATABASE_URL` isn't set. */
export const getServerBugReportStore = fromDatabaseUrl((url) => new NeonBugReportStore(url));
