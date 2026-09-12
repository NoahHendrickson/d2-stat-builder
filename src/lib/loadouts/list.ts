// Pure filtering + sorting for the loadouts page. Runtime imports are relative so the
// module runs under vitest.
import type { Subclass } from "../armory/fragments";
import { subclassFromItemHash } from "../dim/subclasses";
import { MAX_NAME_LENGTH, loadoutHashtags, type SavedLoadout } from "./types";

export type LoadoutListSortKey = "edited" | "name" | "total";

export const LOADOUT_LIST_SORT_OPTIONS: readonly {
  key: LoadoutListSortKey;
  label: string;
}[] = [
  { key: "edited", label: "Last edited" },
  { key: "name", label: "Name" },
  { key: "total", label: "Total stats" },
];

export interface LoadoutListFilter {
  /** Case-insensitive substring over name, notes, and set bonus names. A leading `#` matches hashtags. */
  query: string;
  /** DestinyClass (0–2). Empty/omitted = all. Any-class loadouts (3) always pass. */
  classTypes?: readonly number[];
  /** Arc / Solar / …. Empty/omitted = all. Loadouts with no subclass item fail a subclass filter. */
  subclasses?: readonly Subclass[];
  /** Equipable-item-set hashes. Empty/omitted = all. Matches if the loadout has any selected set. */
  setHashes?: readonly number[];
  /** Resolve a set hash to its display name so the query can match set bonuses. */
  setName?: (hash: number) => string | undefined;
}

export function filterLoadouts(
  loadouts: readonly SavedLoadout[],
  filter: LoadoutListFilter,
): SavedLoadout[] {
  const q = filter.query.trim().toLowerCase();
  const tag = q.startsWith("#") ? q.slice(1) : null;
  return loadouts.filter((l) => {
    if (
      filter.classTypes?.length &&
      l.loadout.classType !== 3 &&
      !filter.classTypes.includes(l.loadout.classType)
    )
      return false;
    if (filter.subclasses?.length) {
      const sc = l.loadout.equipped
        .map((item) => subclassFromItemHash(item.hash))
        .find((name) => name !== undefined);
      if (sc === undefined || !filter.subclasses.includes(sc)) return false;
    }
    if (filter.setHashes?.length) {
      const sets = l.loadout.parameters.setBonuses ?? {};
      if (!filter.setHashes.some((hash) => Object.hasOwn(sets, hash))) return false;
    }
    if (!q) return true;
    if (tag !== null) {
      return tag === "" || loadoutHashtags(l.loadout).some((t) => t.startsWith(tag));
    }
    const sets = Object.keys(l.loadout.parameters.setBonuses ?? {})
      .map((h) => filter.setName?.(Number(h)) ?? "")
      .join("\n");
    const hay = `${l.loadout.name}\n${l.loadout.notes ?? ""}\n${sets}`.toLowerCase();
    return hay.includes(q);
  });
}

export function sortSavedLoadouts(
  loadouts: readonly SavedLoadout[],
  key: LoadoutListSortKey,
): SavedLoadout[] {
  const out = [...loadouts];
  switch (key) {
    case "name":
      out.sort((a, b) =>
        a.loadout.name.localeCompare(b.loadout.name, undefined, { sensitivity: "base" }),
      );
      break;
    case "total":
      out.sort(
        (a, b) =>
          (b.optimizer?.total ?? -1) - (a.optimizer?.total ?? -1) ||
          b.updatedAt - a.updatedAt,
      );
      break;
    case "edited":
    default:
      out.sort((a, b) => b.updatedAt - a.updatedAt);
  }
  return out;
}

/** Unique set-bonus hashes across the list, sorted numerically. */
export function collectSetBonusHashes(loadouts: readonly SavedLoadout[]): number[] {
  const seen = new Set<number>();
  for (const l of loadouts) {
    for (const raw of Object.keys(l.loadout.parameters.setBonuses ?? {})) {
      const hash = Number(raw);
      if (Number.isFinite(hash)) seen.add(hash);
    }
  }
  return [...seen].sort((a, b) => a - b);
}

/** Every hashtag across the list, most-used first. */
export function collectHashtags(loadouts: readonly SavedLoadout[]): string[] {
  const counts = new Map<string, number>();
  for (const l of loadouts) {
    for (const t of loadoutHashtags(l.loadout)) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
}

/**
 * "Name (copy)", "Name (copy 2)", … — the first title not already in `existing`. The base
 * is trimmed so the result always fits MAX_NAME_LENGTH (the parser rejects longer names).
 */
export function duplicateName(name: string, existing: readonly string[]): string {
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  const fit = (suffix: string) => `${name.slice(0, MAX_NAME_LENGTH - suffix.length).trimEnd()}${suffix}`;
  let candidate = fit(" (copy)");
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = fit(` (copy ${n})`);
  return candidate;
}
