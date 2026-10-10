"use client";

// The one armor-set dropdown: every set menu in the app (optimizer roll grid, armor
// table filters, loadout filters) is this, so they search the same way and share the
// account's pinned sets (synced setting `pinnedSets`).
import { useCallback } from "react";
import { FilterMultiselect } from "@/components/armor-table/filter-multiselect";
import type { FilterOption } from "@/lib/armor-table/pinned";
import { togglePinnedSet, usePinnedSets } from "@/lib/settings/pinned-sets";

/** Set menu props shared by both kinds: options carry the set name and a count. */
type SetMenuBase = {
  options: FilterOption<number>[];
  label?: string;
  className?: string;
};

/** Filter by any number of sets. */
export function SetFilterMenu({
  options,
  value,
  onChange,
  label = "Set",
  allLabel = "All sets",
  className,
}: SetMenuBase & {
  value: number[];
  onChange: (value: number[]) => void;
  allLabel?: string;
}) {
  const pinned = usePinnedSets();
  return (
    <FilterMultiselect
      label={label}
      allLabel={allLabel}
      options={options}
      value={value}
      onChange={onChange}
      searchable
      pinnable
      pinned={pinned}
      onTogglePin={togglePinnedSet}
      className={className}
    />
  );
}

/**
 * Pick one set. `noneLabel` adds a row (and placeholder) for picking none; without it
 * the pick can't be cleared.
 */
export function SetPickerMenu({
  options,
  value,
  onChange,
  label = "Set",
  noneLabel,
  placeholder,
  className,
}: SetMenuBase & {
  value: number | null;
  onChange: (value: number | null) => void;
  noneLabel?: string;
  /** The trigger's text with nothing picked (defaults to `noneLabel`). */
  placeholder?: string;
}) {
  const pinned = usePinnedSets();
  const onPick = useCallback((v: number[]) => onChange(v[0] ?? null), [onChange]);
  return (
    <FilterMultiselect
      label={label}
      allLabel={placeholder ?? noneLabel ?? "Pick a set"}
      single
      required={!noneLabel}
      noneLabel={noneLabel}
      options={options}
      value={value === null ? [] : [value]}
      onChange={onPick}
      searchable
      pinnable
      pinned={pinned}
      onTogglePin={togglePinnedSet}
      className={className}
    />
  );
}
