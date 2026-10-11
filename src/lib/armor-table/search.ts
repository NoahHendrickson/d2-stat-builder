// Loose name search for the armor table, ported (functionally) from Noah's
// armorset-tracker: each whitespace token matches by normalized substring,
// falling back to ordered subsequence (typo-tolerant partial typing). Names that
// match every token win; with none, tokens combine with OR — "ferro smoke"
// surfaces both Ferropotent and Smokejumper pieces. See filterBySearch.

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

// Match tiers, strictest first. Each token as a plain substring beats a loose
// (subsequence) hit, and every token matching beats any one token matching.
const ALL_EXACT = 0;
const ALL_LOOSE = 1;
const ANY_EXACT = 2;
const ANY_LOOSE = 3;
const NO_MATCH = 4;

function matchTier(normalizedName: string, tokens: readonly string[]): number {
  if (tokens.every((t) => normalizedName.includes(t))) return ALL_EXACT;
  if (tokens.every((t) => looseNormalizedMatch(t, normalizedName))) return ALL_LOOSE;
  if (tokens.some((t) => normalizedName.includes(t))) return ANY_EXACT;
  if (tokens.some((t) => looseNormalizedMatch(t, normalizedName))) return ANY_LOOSE;
  return NO_MATCH;
}

/**
 * Filter by search, keeping only the strictest tier that has any hits. Short
 * words loosely match nearly everything ("no" is a subsequence of most names),
 * so "no backup plans" must not OR its way to the whole vault: when some name
 * contains every word, only those names survive. Typo tolerance and the OR
 * ("ferro smoke" → both sets) still apply when nothing stricter matches.
 */
export function filterBySearch<T>(
  items: readonly T[],
  normalizedName: (item: T) => string,
  tokens: readonly string[],
): T[] {
  if (tokens.length === 0) return [...items];
  let best = NO_MATCH;
  const tiers = items.map((item) => {
    const tier = matchTier(normalizedName(item), tokens);
    if (tier < best) best = tier;
    return tier;
  });
  if (best === NO_MATCH) return [];
  return items.filter((_, i) => tiers[i] === best);
}
