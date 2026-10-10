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
  const ll = label.toLowerCase();
  if (ll === ql) return 0;
  if (ll.startsWith(ql)) return 1;
  if (wordBoundaryPrefix(ll, ql)) return 2;
  if (ll.includes(ql)) return 3;
  return null;
}
