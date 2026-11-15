import type { WeaponFilters } from "./search";

export const FILTERS = [
  ["trait", "Trait"],
  ["type", "Weapon type"],
  ["element", "Element"],
  ["ammo", "Ammo"],
  ["trait1", "Trait 1"],
  ["trait2", "Trait 2"],
  ["perkCombo", "Perk combo"],
  ["originTrait", "Origin trait"],
  ["gear", "Barrel / Mag"],
  ["champion", "Champion"],
  ["frame", "Frame"],
  ["slot", "Slot"],
  ["rarity", "Rarity"],
  ["source", "Source"],
  ["season", "Season"],
] as const;
export const SORTS = [
  ["season-desc", "Newest"],
  ["season-asc", "Oldest"],
  ["name", "A–Z"],
] as const;

/** The URL param naming, by item hash, the exact weapon a link opens. */
const LINKED_WEAPON_PARAM = "weapon";

/**
 * Weapon search for one weapon: its name in the search box and that exact version open,
 * so a name with several perk pools still opens the pool this copy rolls from.
 */
export function weaponSearchHref({ name, itemHash }: { name: string; itemHash: number }): string {
  return `/weapons?${new URLSearchParams({ q: name, [LINKED_WEAPON_PARAM]: String(itemHash) })}`;
}

/** A link's `weapon=` item hash, or null when there's none or it isn't a hash. */
export function readLinkedWeaponHash(params: URLSearchParams): number | null {
  const raw = params.get(LINKED_WEAPON_PARAM)?.trim();
  if (!raw || !/^\d{1,10}$/.test(raw)) return null;
  const hash = Number(raw);
  return hash > 0 ? hash : null;
}

/** An `ammoGen` URL value as a whole number, or null when it isn't one. */
export function readAmmoGen(raw: string | null): number | null {
  if (!raw || !/^\d{1,3}$/.test(raw.trim())) return null;
  return Number(raw.trim());
}

/**
 * Links from before Craftable left Browse filters carry `craftable=Yes|No`. This
 * moves it into `q` as `is:`/`not:craftable`, the one way Craftable is set now.
 * Null when there's nothing to move.
 */
export function withLegacyCraftableInQuery(params: URLSearchParams): URLSearchParams | null {
  if (!params.has("craftable")) return null;
  const values = new Set(params.getAll("craftable").map((v) => v.trim().toLowerCase()));
  const next = new URLSearchParams(params);
  next.delete("craftable");
  // Yes and No together matched everything, so they add no word.
  if (values.has("yes") !== values.has("no")) {
    const word = values.has("yes") ? "is:craftable" : "not:craftable";
    next.set("q", [params.get("q")?.trim(), word].filter(Boolean).join(" "));
  }
  return next;
}

export function readSearchState(raw: URLSearchParams) {
  const params = withLegacyCraftableInQuery(raw) ?? raw;
  const filters: WeaponFilters = {};
  for (const [key] of FILTERS) {
    const values = [...new Set(params.getAll(key).filter(Boolean))];
    if (values.length)
      filters[key] = key === "perkCombo" ? values.slice(0, 2) : values;
  }
  if (params.get("adept") === "true") filters.adept = true;
  if (params.get("adept") === "false") filters.adept = false;
  const ammoGen = readAmmoGen(params.get("ammoGen"));
  if (ammoGen != null) filters.ammoGenAbove = ammoGen;
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
