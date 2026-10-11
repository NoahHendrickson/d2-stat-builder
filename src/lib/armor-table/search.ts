// Loose name search for the armor table, ported (functionally) from Noah's
// armorset-tracker: each whitespace token matches by normalized substring,
// falling back to ordered subsequence (typo-tolerant partial typing) when no
// name contains it. Names matching the most tokens win, so with no name matching
// them all, tokens combine with OR — "ferro smoke" surfaces both Ferropotent and
// Smokejumper pieces. See searchMatcher.

/**
 * Split a search box value into normalized tokens (whitespace-separated).
 * Normalizing here — once per query, not once per piece — keeps the filter
 * pass from re-normalizing the same token against every name.
 */
export function tokenizeSearchQuery(query: string): string[] {
  return query
    .trim()
    .split(/\s+/)
    .map(normalizeSearchText)
    .filter((t) => t.length > 0);
}

/** Strip punctuation so "smoke-jumper" and "smokejumper" align. */
export function normalizeSearchText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Loose match for armor names: normalized substring, then ordered subsequence
 * (typo-tolerant partial typing, e.g. "frpot" → "Ferropotent"). `token` must
 * already be normalized (tokenizeSearchQuery output).
 */
function looseNormalizedMatch(token: string, normalizedName: string): boolean {
  if (token.length === 0) return true;
  if (normalizedName.length === 0) return false;
  if (normalizedName.includes(token)) return true;

  let ti = 0;
  for (let ni = 0; ni < normalizedName.length && ti < token.length; ni++) {
    if (normalizedName[ni] === token[ti]) ti++;
  }
  return ti === token.length;
}

export function looseNameMatch(token: string, name: string): boolean {
  return looseNormalizedMatch(token, normalizeSearchText(name));
}

/**
 * Build the search predicate for a list. A word only loosely matches
 * (subsequence) when no name in `scope` contains it outright — short words
 * loosely match nearly everything ("no" is a subsequence of most names), so a
 * word that's spelled right should never take the loose path. Then the names
 * matching the most words win: "no backup plans" keeps only No Backup Plans,
 * a typo in one word ("no bakcup plans") still leaves it ahead on the other
 * two, and "ferro smoke" (no name has both) keeps either set.
 *
 * Pass the whole list as `scope` and test only the rows that survive the other
 * filters, so a filter can only narrow results: "no backup plans" on Hunter
 * shows nothing instead of every Hunter piece containing "no".
 */
export function searchMatcher<T>(
  scope: readonly T[],
  normalizedName: (item: T) => string,
  tokens: readonly string[],
): (item: T) => boolean {
  if (tokens.length === 0) return () => true;
  const names = scope.map(normalizedName);
  const exact = tokens.map((t) => names.some((name) => name.includes(t)));
  const matchCount = (name: string) => {
    let count = 0;
    for (let i = 0; i < tokens.length; i++) {
      if (
        exact[i]
          ? name.includes(tokens[i])
          : looseNormalizedMatch(tokens[i], name)
      )
        count++;
    }
    return count;
  };
  let best = 0;
  for (const name of names) best = Math.max(best, matchCount(name));
  if (best === 0) return () => false;
  return (item) => matchCount(normalizedName(item)) === best;
}

/** searchMatcher scoped to `items` itself. */
export function filterBySearch<T>(
  items: readonly T[],
  normalizedName: (item: T) => string,
  tokens: readonly string[],
): T[] {
  return items.filter(searchMatcher(items, normalizedName, tokens));
}
