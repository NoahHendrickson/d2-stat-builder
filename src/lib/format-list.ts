/** "A", "A and B", "A, B and C": the app's one way to list names in a sentence. */
export function listAnd(items: readonly string[]): string {
  return items.length > 1
    ? `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`
    : (items[0] ?? "");
}
