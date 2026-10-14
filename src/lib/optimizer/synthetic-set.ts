/**
 * Synthetic set hashes: set requirements for groups of armor that aren't a manifest
 * armor set (legacy raid armor is one, see armory/legacy-raids.ts). The solver counts
 * them like any set. They're negative, so they never collide with a real
 * DestinyEquipableItemSetDefinition hash (unsigned), and no Tier-5 roll belongs to
 * one: a farmed (dream) roll can never satisfy a synthetic requirement.
 *
 * Pure — no DOM/React deps, so it runs in a Web Worker and in Node tests.
 */

/** The synthetic set hash for group `index` (0-based) of a caller's own numbering. */
export function syntheticSetHash(index: number): number {
  return -(index + 1);
}

/** The group index a synthetic set hash was made from (inverse of syntheticSetHash). */
export function syntheticSetIndex(setHash: number): number {
  return -setHash - 1;
}

export function isSyntheticSetHash(setHash: number): boolean {
  return setHash < 0;
}
