/** Keep only equipped fragment hashes that exist in the known (stat-affecting) set. */
export function fragSelFromEquipped(
  fragmentHashes: readonly number[],
  knownHashes: ReadonlySet<number>,
): Set<number> {
  return new Set(fragmentHashes.filter((h) => knownHashes.has(h)));
}
