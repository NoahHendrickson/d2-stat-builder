const lower = (s: string) => s.toLowerCase();

function wordBoundaryPrefix(labelLower: string, queryLower: string): boolean {
  if (labelLower.startsWith(queryLower)) return true;
  const parts = labelLower.split(/[\s\-–—]+/);
  return parts.some((part) => part.startsWith(queryLower));
}

/**
 * Match quality ladder — lower is better.
 * 0 exact, 1 prefix, 2 word-boundary prefix, 3 contains, null = no match.
 */
export function matchRank(label: string, query: string): number | null {
  const ql = query.trim().toLowerCase();
  if (!ql) return null;
  const ll = lower(label);
  if (ll === ql) return 0;
  if (ll.startsWith(ql)) return 1;
  if (wordBoundaryPrefix(ll, ql)) return 2;
  if (ll.includes(ql)) return 3;
  return null;
}

/** Combine generic and category-specific ranks (e.g. weapon names). */
export function resolveMatchRank(
  label: string,
  query: string,
  searchRank?: number,
): number | null {
  const generic = matchRank(label, query);
  if (generic != null && searchRank != null) return Math.min(generic, searchRank);
  return generic ?? searchRank ?? null;
}

/** Apply recency boost — subtract when label matches a recent value. */
export function effectiveRank(
  rank: number,
  label: string,
  recentValues?: ReadonlySet<string>,
): number {
  if (!recentValues || recentValues.size === 0) return rank;
  return recentValues.has(lower(label)) ? rank - 0.5 : rank;
}

export interface RankedLabel {
  label: string;
  rank: number;
  popularity: number;
}

/** Rank and sort labeled options; drops non-matches unless `fallbackRank` is set. */
export function rankLabeledOptions(
  items: readonly { label: string; popularity?: number; fallbackRank?: number }[],
  query: string,
  limit: number,
  recentValues?: ReadonlySet<string>,
): RankedLabel[] {
  const ql = query.trim();
  if (!ql) return [];

  const ranked: RankedLabel[] = [];
  for (const item of items) {
    const baseRank = resolveMatchRank(item.label, ql, item.fallbackRank);
    if (baseRank == null) continue;
    ranked.push({
      label: item.label,
      rank: effectiveRank(baseRank, item.label, recentValues),
      popularity: item.popularity ?? 0,
    });
  }

  ranked.sort(
    (a, b) =>
      a.rank - b.rank || b.popularity - a.popularity || a.label.localeCompare(b.label),
  );

  return ranked.slice(0, limit);
}

/** Suffix to append for Tab ghost completion, or undefined if none. */
export function ghostSuffix(label: string, query: string, maxRank = 1): string | undefined {
  const q = query;
  const ql = q.trim().toLowerCase();
  if (ql.length < 2) return undefined;
  const rank = matchRank(label, q);
  if (rank == null || rank > maxRank) return undefined;
  const ll = label.toLowerCase();
  if (!ll.startsWith(ql)) return undefined;
  const suffix = label.slice(q.trim().length);
  return suffix.length > 0 ? suffix : undefined;
}

/** Pick the best ghost suffix from candidate labels. */
export function bestGhostSuffix(
  query: string,
  candidates: readonly { label: string; popularity?: number }[],
  recentValues?: ReadonlySet<string>,
): string | undefined {
  const ranked = rankLabeledOptions(candidates, query, 1, recentValues);
  const top = ranked[0];
  if (!top) return undefined;
  return ghostSuffix(top.label, query);
}

export interface GhostCompletion {
  label: string;
  suffix: string;
}

/** Best Tab-completion candidate: canonical label + suffix to append. */
export function bestGhostCompletion(
  query: string,
  candidates: readonly { label: string; popularity?: number }[],
  recentValues?: ReadonlySet<string>,
  maxRank = 1,
): GhostCompletion | undefined {
  const ranked = rankLabeledOptions(candidates, query, 1, recentValues);
  const top = ranked[0];
  if (!top || top.rank > maxRank) return undefined;
  const suffix = ghostSuffix(top.label, query, maxRank);
  if (!suffix) return undefined;
  return { label: top.label, suffix };
}
