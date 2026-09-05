// Pure filtering + sorting for the loadouts page. Runtime imports are relative so the
// module runs under vitest.
import { loadoutHashtags, type SavedLoadout } from "./types";

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
  /** Case-insensitive substring over name + notes. A leading `#` matches hashtags. */
  query: string;
  /** DestinyClass (0–2), or null for all. Any-class loadouts (3) always pass. */
  classType: number | null;
}

export function filterLoadouts(
  loadouts: readonly SavedLoadout[],
  filter: LoadoutListFilter,
): SavedLoadout[] {
  const q = filter.query.trim().toLowerCase();
  const tag = q.startsWith("#") ? q.slice(1) : null;
  return loadouts.filter((l) => {
    if (
      filter.classType !== null &&
      l.loadout.classType !== 3 &&
      l.loadout.classType !== filter.classType
    )
      return false;
    if (!q) return true;
    if (tag !== null) {
      return tag === "" || loadoutHashtags(l.loadout).some((t) => t.startsWith(tag));
    }
    const hay = `${l.loadout.name}\n${l.loadout.notes ?? ""}`.toLowerCase();
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

/** Every hashtag across the list, most-used first. */
export function collectHashtags(loadouts: readonly SavedLoadout[]): string[] {
  const counts = new Map<string, number>();
  for (const l of loadouts) {
    for (const t of loadoutHashtags(l.loadout)) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
}

/** "Name (copy)", "Name (copy 2)", … — the first title not already in `existing`. */
export function duplicateName(name: string, existing: readonly string[]): string {
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  let candidate = `${name} (copy)`;
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${name} (copy ${n})`;
  return candidate;
}
