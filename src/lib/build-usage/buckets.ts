// The /armor "Searches" column and Cleanup view: one piece's optimizer history, and the
// rating it gets. Pure — shared by the table and its tests.

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
 * A piece seen in fewer distinct queries than this hasn't had a fair chance yet (it's
 * new, its class is rarely optimized, or the searches so far were a few variations on
 * one idea), so it gets no rating. Deliberately high: Cleanup exists to inform deletes.
 */
export const MIN_ELIGIBLE_QUERIES = 20;

export const USAGE_BUCKETS = ["never", "rarely", "sometimes", "often", "unknown"] as const;
export type UsageBucket = (typeof USAGE_BUCKETS)[number];

export const USAGE_BUCKET_LABELS: Record<UsageBucket, string> = {
  never: "Never used",
  rarely: "Rarely used",
  sometimes: "Sometimes used",
  often: "Often used",
  unknown: "Not enough searches",
};

/** Share of a piece's searches whose shown builds used it: below this is "rarely". */
export const RARELY_BELOW = 0.1;
/** At or above this share it's "often"; between the two, "sometimes". */
export const OFTEN_FROM = 0.35;

/**
 * How much the optimizer reaches for a piece, by the share of its searches whose shown
 * builds used it. A piece in a saved loadout is "often" whatever its count: you chose it.
 * Below MIN_ELIGIBLE_QUERIES searches a share means little, so it's "unknown".
 */
export function usageBucket(u: PieceUsageCounts | undefined, inLoadout = false): UsageBucket {
  if (inLoadout) return "often";
  if (!u || u.eligible < MIN_ELIGIBLE_QUERIES) return "unknown";
  if (u.used === 0) return "never";
  const share = u.used / u.eligible;
  return share < RARELY_BELOW ? "rarely" : share < OFTEN_FROM ? "sometimes" : "often";
}

/** The cell's hover text. */
export function usageTitle(u: PieceUsageCounts | undefined, inLoadout = false): string {
  const loadout = inLoadout ? "In a saved loadout. " : "";
  if (!u || u.eligible === 0) {
    return loadout + "No optimizer searches have included this piece yet";
  }
  const of = `${u.eligible} ${u.eligible === 1 ? "search" : "searches"} it could join`;
  if (u.used > 0) return `${loadout}In the shown builds of ${u.used} of ${of}`;
  return u.eligible < MIN_ELIGIBLE_QUERIES
    ? `${loadout}In no shown builds yet, across ${of}. A rating needs ${MIN_ELIGIBLE_QUERIES}.`
    : `${loadout}In no shown builds across ${of}`;
}

/** Armor instance ids in any saved loadout (the equipped items and the optimizer build). */
export function loadoutPieceIds(
  loadouts: readonly {
    loadout: { equipped: readonly { id?: string }[] };
    optimizer?: { pieceIds: readonly string[] };
  }[],
): Set<string> {
  const ids = new Set<string>();
  for (const l of loadouts) {
    for (const item of l.loadout.equipped) if (item.id) ids.add(item.id);
    for (const id of l.optimizer?.pieceIds ?? []) ids.add(id);
  }
  return ids;
}
