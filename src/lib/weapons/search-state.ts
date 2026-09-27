import type { WeaponFilters } from "./search";

export const FILTERS = [
  ["type", "Weapon type"],
  ["element", "Element"],
  ["ammo", "Ammo"],
  ["trait1", "Trait 1"],
  ["trait2", "Trait 2"],
  ["perkCombo", "Perk combo"],
  ["originTrait", "Origin trait"],
  ["perks", "Required perks"],
  ["frame", "Frame"],
  ["slot", "Slot"],
  ["rarity", "Rarity"],
  ["source", "Source"],
  ["season", "Season"],
  ["craftable", "Craftable"],
] as const;
export const SORTS = [
  ["season-desc", "Newest"],
  ["season-asc", "Oldest"],
  ["name", "A–Z"],
  ["ammo-gen-desc", "Ammo generation"],
] as const;

export function readSearchState(params: URLSearchParams) {
  const filters: WeaponFilters = {};
  for (const [key] of FILTERS) {
    const values = [...new Set(params.getAll(key).filter(Boolean))];
    if (values.length)
      filters[key] = key === "perkCombo" ? values.slice(0, 2) : values;
  }
  if (params.get("adept") === "true") filters.adept = true;
  if (params.get("adept") === "false") filters.adept = false;
  if (params.get("trait1DamagePerks") === "true")
    filters.trait1DamagePerks = true;
  if (params.get("trait2DamagePerks") === "true")
    filters.trait2DamagePerks = true;
  const groups: string[][] = [];
  for (const raw of params.getAll("group").slice(0, 12)) {
    try {
      const values: unknown = JSON.parse(raw);
      if (!Array.isArray(values)) continue;
      const group = [
        ...new Set(
          values.filter(
            (value): value is string =>
              typeof value === "string" && value.length > 0,
          ),
        ),
      ].slice(0, 100);
      if (group.length) groups.push(group);
    } catch {
      /* Ignore malformed shared URLs. */
    }
  }
  if (groups.length) filters.customPerkGroups = groups;
  const sort =
    SORTS.find(([value]) => value === params.get("sort"))?.[0] ?? "season-desc";
  return { query: params.get("q") ?? "", filters, sort };
}

export type WeaponSearchState = ReturnType<typeof readSearchState>;

/** Human-readable one-liner for a saved search: query, then each filter with its label. */
export function describeSearchState(state: WeaponSearchState): string {
  const parts: string[] = [];
  if (state.query) parts.push(state.query);
  for (const [key, label] of FILTERS) {
    for (const value of state.filters[key] ?? []) parts.push(`${label}: ${value}`);
  }
  if (state.filters.adept != null) parts.push(state.filters.adept ? "Adept" : "Standard");
  if (state.filters.trait1DamagePerks) parts.push("Trait 1: damage perks");
  if (state.filters.trait2DamagePerks) parts.push("Trait 2: damage perks");
  for (const group of state.filters.customPerkGroups ?? []) {
    parts.push(`Any: ${group.join(" / ")}`);
  }
  return parts.join(" · ") || "All weapons";
}
