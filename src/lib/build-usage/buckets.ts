// The /armor "Searches" column and filter: one piece's optimizer history, and the
// bucket the filter sorts it into. Pure — shared by the table and its tests.

/** One piece's history across the account's recorded optimizer queries. */
export interface PieceUsageCounts {
  /** Distinct queries whose pool the piece was in. */
  eligible: number;
  /** Of those, queries where a displayed build used it. */
  used: number;
}

/** What /api/build-usage answers: the account's history, per armor instance id. */
export interface BuildUsageSummary {
  pieces: Record<string, PieceUsageCounts>;
}

/**
 * A piece that sat unused through fewer distinct queries than this hasn't had a fair
 * chance yet (it's new, its class is rarely optimized, or the searches so far were a
 * few variations on one idea), so it isn't called "never used". Deliberately high: the
 * filter exists to inform deletes.
 */
export const MIN_ELIGIBLE_QUERIES = 20;

export const USAGE_BUCKETS = ["never", "few", "many", "unknown"] as const;
export type UsageBucket = (typeof USAGE_BUCKETS)[number];

export const USAGE_BUCKET_LABELS: Record<UsageBucket, string> = {
  never: "Never used",
  few: "Used in 1–2 searches",
  many: "Used in 3+ searches",
  unknown: "Not enough searches",
};

/** The buckets the Searches filter offers; "unknown" is explained under it, not picked. */
export const USAGE_FILTER_BUCKETS = ["never", "few", "many"] as const satisfies readonly UsageBucket[];

export function isUsageFilterBucket(v: unknown): v is UsageBucket {
  return typeof v === "string" && (USAGE_FILTER_BUCKETS as readonly string[]).includes(v);
}

export function usageBucket(u: PieceUsageCounts | undefined): UsageBucket {
  if (!u || (u.used === 0 && u.eligible < MIN_ELIGIBLE_QUERIES)) return "unknown";
  if (u.used === 0) return "never";
  return u.used <= 2 ? "few" : "many";
}

/** The cell's hover text. */
export function usageTitle(u: PieceUsageCounts | undefined): string {
  if (!u || u.eligible === 0) return "No optimizer searches have included this piece yet";
  const of = `${u.eligible} ${u.eligible === 1 ? "search" : "searches"} it could join`;
  if (u.used > 0) return `In the shown builds of ${u.used} of ${of}`;
  return u.eligible < MIN_ELIGIBLE_QUERIES
    ? `In no shown builds yet, across ${of}. "Never used" needs ${MIN_ELIGIBLE_QUERIES}.`
    : `In no shown builds across ${of}`;
}
