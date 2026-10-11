// The /armor "Builds" column and filter: one piece's optimizer history, and the bucket
// the filter sorts it into. Pure — shared by the table and its tests.

/** One piece's history across the account's recorded optimizer queries. */
export interface PieceUsageCounts {
  /** Queries whose pool the piece was in. */
  eligible: number;
  /** Of those, queries where a shown build used it. */
  used: number;
  /** Of those, queries where a build nothing beat used it. */
  optimal: number;
}

/** What /api/build-usage answers: the account's history, per armor instance id. */
export interface BuildUsageSummary {
  /** Distinct queries recorded for the account. */
  queries: number;
  pieces: Record<string, PieceUsageCounts>;
}

/**
 * A piece that sat unused through fewer queries than this hasn't had a fair chance yet
 * (it's new, or its class is rarely optimized), so it isn't called "never used".
 */
export const MIN_ELIGIBLE_QUERIES = 5;

export const USAGE_BUCKETS = ["never", "nonOptimal", "few", "many", "unknown"] as const;
export type UsageBucket = (typeof USAGE_BUCKETS)[number];

export const USAGE_BUCKET_LABELS: Record<UsageBucket, string> = {
  never: "Never used",
  nonOptimal: "Only in worse builds",
  few: "Used in 1–2",
  many: "Used in 3+",
  unknown: "Not enough searches",
};

export function isUsageBucket(v: unknown): v is UsageBucket {
  return typeof v === "string" && (USAGE_BUCKETS as readonly string[]).includes(v);
}

export function usageBucket(u: PieceUsageCounts | undefined): UsageBucket {
  if (!u || (u.used === 0 && u.eligible < MIN_ELIGIBLE_QUERIES)) return "unknown";
  if (u.used === 0) return "never";
  if (u.optimal === 0) return "nonOptimal";
  return u.used <= 2 ? "few" : "many";
}

/** The cell's hover text. */
export function usageTitle(u: PieceUsageCounts | undefined): string {
  if (!u || u.eligible === 0) return "No optimizer searches have included this piece yet";
  const of = `${u.eligible} ${u.eligible === 1 ? "search" : "searches"} it could join`;
  if (u.used === 0) return `In no builds across ${of}`;
  const worse = u.used - u.optimal;
  return (
    `In builds for ${u.used} of ${of}` +
    (worse > 0
      ? `. In ${worse} of them, only builds that another build beat on every stat`
      : "")
  );
}
