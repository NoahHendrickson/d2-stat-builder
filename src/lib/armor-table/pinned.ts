// Pin-to-top support for the armor table's filter dropdowns (ported from
// Noah's armorset-tracker): pinned options float to a "Pinned" section at the
// top of the list, in the order they were pinned; searching suppresses the
// partition so results read as one flat list.
//
// Runtime imports are relative (not `@/`) — the vitest runner has no `@/` alias.
import { nameMatchesSearch, tokenizeSearchQuery } from "./search";

export interface FilterOption<V> {
  value: V;
  label: string;
}

/** Toggle membership; existing pins keep their order, new pins append last. */
export function togglePinned<V>(pinned: readonly V[], value: V): V[] {
  return pinned.includes(value)
    ? pinned.filter((v) => !Object.is(v, value))
    : [...pinned, value];
}

export interface PinPartition<V> {
  /** Pinned options in pin order. Empty while a search query is active. */
  pinned: FilterOption<V>[];
  /** Remaining options in their original order. */
  rest: FilterOption<V>[];
}

/**
 * Partition options for the dropdown list: pinned first (in pin order, unknown
 * pinned values ignored), then the rest (original order). A non-empty query
 * suppresses the partition — everything collapses into a single label-filtered
 * `rest` list.
 */
export function partitionByPin<V>(
  options: readonly FilterOption<V>[],
  pinned: readonly V[],
  query: string,
): PinPartition<V> {
  const tokens = tokenizeSearchQuery(query);
  if (tokens.length > 0) {
    return {
      pinned: [],
      rest: options.filter((o) => nameMatchesSearch(o.label, tokens)),
    };
  }
  const byValue = new Map(options.map((o) => [o.value, o]));
  const pinnedOptions = pinned
    .map((v) => byValue.get(v))
    .filter((o): o is FilterOption<V> => o !== undefined);
  const pinnedSet = new Set(pinned);
  return {
    pinned: pinnedOptions,
    rest: options.filter((o) => !pinnedSet.has(o.value)),
  };
}
