// Loose name search for the armor table, ported (functionally) from Noah's
// armorset-tracker: whitespace tokens combine with OR — "ferro smoke" surfaces
// both Ferropotent and Smokejumper pieces — and each token matches by normalized
// substring, falling back to ordered subsequence (typo-tolerant partial typing).

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

/** OR across tokens against an already-normalized name (skips per-row toLowerCase). */
export function nameMatchesNormalized(
  normalizedName: string,
  tokens: readonly string[],
): boolean {
  if (tokens.length === 0) return true;
  return tokens.some((token) => looseNormalizedMatch(token, normalizedName));
}

/** OR across tokens: the name matches when any token loosely matches it. */
export function nameMatchesSearch(
  name: string,
  tokens: readonly string[],
): boolean {
  return nameMatchesNormalized(normalizeSearchText(name), tokens);
}
