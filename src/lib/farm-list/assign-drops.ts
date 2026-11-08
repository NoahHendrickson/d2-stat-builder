// Which waiting entries a set of drops fills, for weapons and armor alike. Each kind only
// supplies the copies that would match an entry. Pure, so it runs under vitest.
import type { FarmEntry } from "./types";

/**
 * The waiting entries that now have a match, oldest first. One copy fills one entry: a
 * copy another entry already holds doesn't count, and a copy isn't handed to two entries
 * that both accept it.
 */
export function assignDrops<E extends FarmEntry, C extends { instanceId: string }>(
  entries: readonly E[],
  candidates: (entry: E) => readonly C[],
): { entry: E; copy: C }[] {
  const claimed = new Set(entries.flatMap((e) => (e.obtained ? [e.obtained.instanceId] : [])));
  const waiting = entries.filter((e) => !e.obtained).sort((a, b) => a.createdAt - b.createdAt);
  const out: { entry: E; copy: C }[] = [];
  for (const entry of waiting) {
    const copy = candidates(entry).find((c) => !claimed.has(c.instanceId));
    if (!copy) continue;
    claimed.add(copy.instanceId);
    out.push({ entry, copy });
  }
  return out;
}
