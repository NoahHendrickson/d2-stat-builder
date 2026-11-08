/** How many items map to each key; null keys are skipped. */
export function countBy<T, K>(items: readonly T[], key: (item: T) => K | null): Map<K, number> {
  const out = new Map<K, number>();
  for (const item of items) {
    const k = key(item);
    if (k !== null) out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}
