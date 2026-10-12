// Neon store for "Report a bug". Server-only.
//
// One row per report, from a signed-in account. Inserts are capped: a few per account
// an hour and a ceiling across everyone per day, checked in the same statement as the
// insert. The schema is created lazily, like loadouts.
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type { BugReportContext } from "./bug-report";

/** Reports one account can make in an hour. */
export const MAX_REPORTS_PER_ACCOUNT_HOUR = 5;
/** Reports everyone together can make in a day, so a flood can't fill the database. */
export const MAX_REPORTS_PER_DAY = 200;

export interface NewBugReport {
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
  private schemaReady: Promise<void> | null = null;

  constructor(databaseUrl: string) {
    this.sql = neon(databaseUrl);
  }

  private ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = (async () => {
        await this.sql`
          CREATE TABLE IF NOT EXISTS bug_reports (
            id bigserial PRIMARY KEY,
            created_at timestamptz NOT NULL DEFAULT now(),
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
        await this.sql`
          CREATE INDEX IF NOT EXISTS bug_reports_account_created
          ON bug_reports (membership_id, created_at)`;
        await this.sql`
          CREATE INDEX IF NOT EXISTS bug_reports_created ON bug_reports (created_at)`;
      })().catch((err) => {
        this.schemaReady = null; // let the next call retry
        throw err;
      });
    }
    return this.schemaReady;
  }

  /** Save a report. Its id, or null when the account or the day is over its cap. */
  async add(r: NewBugReport): Promise<string | null> {
    await this.ensureSchema();
    const rows = (await this.sql`
      INSERT INTO bug_reports (title, description, path, viewport, theme, user_agent, host,
        build, membership_id, display_name)
      SELECT ${r.title}, ${r.description}, ${r.context.path}, ${r.context.viewport},
        ${r.context.theme}, ${r.userAgent}, ${r.host}, ${r.build}, ${r.membershipId},
        ${r.displayName}
      WHERE (
        SELECT count(*) FROM bug_reports
        WHERE membership_id = ${r.membershipId} AND created_at > now() - interval '1 hour'
      ) < ${MAX_REPORTS_PER_ACCOUNT_HOUR}
      AND (
        SELECT count(*) FROM bug_reports WHERE created_at > now() - interval '1 day'
      ) < ${MAX_REPORTS_PER_DAY}
      RETURNING id::text AS id`) as { id: string }[];
    return rows[0]?.id ?? null;
  }
}

let singleton: NeonBugReportStore | null | undefined;

/** The server's bug report store, or null when `DATABASE_URL` isn't set. */
export function getServerBugReportStore(): NeonBugReportStore | null {
  if (singleton !== undefined) return singleton;
  const url = process.env.DATABASE_URL;
  singleton = url ? new NeonBugReportStore(url) : null;
  return singleton;
}
