"use client";

// How the manager orders items within a slot (a chain of sort keys, like DIM's sort
// settings) and how it groups each vault row. Kept in localStorage; bad data reads as
// the defaults.
import { useSyncExternalStore } from "react";
import { CLASS_NAMES } from "@/lib/armory/stats";
import { createValueStore } from "@/lib/value-store";
import type { Annotations, ItemTag } from "./annotations";
import type { InventoryItem } from "./build";

export const SORT_KEYS = [
  "rarity",
  "power",
  "name",
  "type",
  "tag",
  "masterwork",
  "tier",
  "element",
  "ammo",
] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export const SORT_LABELS: Record<SortKey, string> = {
  rarity: "Rarity",
  power: "Power",
  name: "Name",
  type: "Weapon or armor type",
  tag: "Tag",
  masterwork: "Masterworked first",
  tier: "Gear tier",
  element: "Element",
  ammo: "Ammo",
};

export const GROUP_KEYS = ["none", "class", "type", "rarity", "element", "ammo", "tier"] as const;
export type GroupKey = (typeof GROUP_KEYS)[number];

export const GROUP_LABELS: Record<GroupKey, string> = {
  none: "No grouping",
  class: "Class",
  type: "Type",
  rarity: "Rarity",
  element: "Element",
  ammo: "Ammo",
  tier: "Gear tier",
};

export interface ViewSettings {
  /** Sort keys in priority order; name always breaks the last tie. */
  sort: SortKey[];
  /** How each vault weapon row splits into groups. */
  weaponGroup: GroupKey;
  /** How each vault armor row splits into groups. */
  armorGroup: GroupKey;
}

export const DEFAULT_VIEW: ViewSettings = {
  sort: ["rarity", "power", "name"],
  weaponGroup: "type",
  armorGroup: "class",
};

const STORAGE_KEY = "stat-builder:manager-view:v1";
const TAG_ORDER: Record<ItemTag | "none", number> = {
  favorite: 0,
  keep: 1,
  none: 2,
  infuse: 3,
  junk: 4,
  archive: 5,
};
const ELEMENT_ORDER = ["kinetic", "arc", "solar", "void", "stasis", "strand", "prismatic"];
const TIER_NAMES: Record<number, string> = { 6: "Exotic", 5: "Legendary", 4: "Rare", 3: "Uncommon", 2: "Common" };
const AMMO_NAMES: Record<number, string> = { 1: "Primary", 2: "Special", 3: "Heavy" };

export function parseViewSettings(raw: string | null): ViewSettings {
  if (!raw) return DEFAULT_VIEW;
  try {
    // vaultGroup: the one setting for every row, before weapons and armor split.
    const v = JSON.parse(raw) as Partial<Record<keyof ViewSettings | "vaultGroup", unknown>>;
    const sort = Array.isArray(v.sort)
      ? [...new Set(v.sort.filter((k): k is SortKey => (SORT_KEYS as readonly unknown[]).includes(k)))]
      : DEFAULT_VIEW.sort;
    const group = (value: unknown, fallback: GroupKey) =>
      (GROUP_KEYS as readonly unknown[]).includes(value) ? (value as GroupKey) : fallback;
    return {
      sort,
      weaponGroup: group(v.weaponGroup, DEFAULT_VIEW.weaponGroup),
      armorGroup: group(v.armorGroup, group(v.vaultGroup, DEFAULT_VIEW.armorGroup)),
    };
  } catch {
    return DEFAULT_VIEW;
  }
}

export const viewSettings = createValueStore<ViewSettings>(DEFAULT_VIEW);

/** Read the saved settings (call once the page is in the browser). */
export function loadViewSettings() {
  try {
    viewSettings.set(parseViewSettings(localStorage.getItem(STORAGE_KEY)));
  } catch {
    // Keep the defaults.
  }
}

export function setViewSettings(next: ViewSettings) {
  viewSettings.set(next);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Blocked storage: the setting holds for this session.
  }
}

export function useViewSettings(): ViewSettings {
  return useSyncExternalStore(viewSettings.subscribe, viewSettings.get, () => DEFAULT_VIEW);
}

type Compare = (a: InventoryItem, b: InventoryItem) => number;

const elementRank = (i: InventoryItem) => {
  const at = i.element ? ELEMENT_ORDER.indexOf(i.element) : -1;
  return at < 0 ? ELEMENT_ORDER.length : at;
};

function comparer(key: SortKey, annotations: Annotations): Compare {
  switch (key) {
    case "rarity":
      return (a, b) => b.tierType - a.tierType;
    case "power":
      return (a, b) => (b.power ?? 0) - (a.power ?? 0);
    case "name":
      return (a, b) => a.name.localeCompare(b.name);
    case "type":
      return (a, b) => a.typeName.localeCompare(b.typeName);
    case "tag": {
      const rank = (i: InventoryItem) =>
        TAG_ORDER[(i.instanceId ? annotations[i.instanceId]?.tag : undefined) ?? "none"];
      return (a, b) => rank(a) - rank(b);
    }
    case "masterwork":
      return (a, b) => Number(b.masterworked) - Number(a.masterworked);
    case "tier":
      return (a, b) => (b.gearTier ?? 0) - (a.gearTier ?? 0);
    case "element":
      return (a, b) => elementRank(a) - elementRank(b);
    case "ammo":
      return (a, b) => (a.ammoType ?? 9) - (b.ammoType ?? 9);
  }
}

/** One comparator for the whole chain, with the name as the final tiebreak. */
export function itemComparator(sort: readonly SortKey[], annotations: Annotations): Compare {
  const chain = [...sort, ...(sort.includes("name") ? [] : (["name"] as const))].map((k) =>
    comparer(k, annotations),
  );
  return (a, b) => {
    for (const compare of chain) {
      const d = compare(a, b);
      if (d !== 0) return d;
    }
    return 0;
  };
}

export interface ItemGroup {
  key: string;
  /** Shown above the group; undefined when the row has only one group. */
  label?: string;
  items: InventoryItem[];
}

function groupOf(key: GroupKey, item: InventoryItem): { id: string; label: string; rank: number } {
  switch (key) {
    case "class":
      return item.classType === 3
        ? { id: "any", label: "Any class", rank: 3 }
        : { id: String(item.classType), label: CLASS_NAMES[item.classType] ?? "Unknown", rank: item.classType };
    case "type":
      return { id: item.typeName, label: item.typeName || "Other", rank: 0 };
    case "rarity":
      return { id: String(item.tierType), label: TIER_NAMES[item.tierType] ?? "Other", rank: -item.tierType };
    case "element":
      return {
        id: item.element ?? "none",
        label: item.element ? item.element[0]!.toUpperCase() + item.element.slice(1) : "No element",
        rank: elementRank(item),
      };
    case "ammo":
      return { id: String(item.ammoType ?? 0), label: AMMO_NAMES[item.ammoType ?? 0] ?? "No ammo", rank: item.ammoType ?? 9 };
    case "tier":
      return {
        id: String(item.gearTier ?? 0),
        label: item.gearTier ? `Tier ${item.gearTier}` : "No tier",
        rank: -(item.gearTier ?? 0),
      };
    case "none":
      return { id: "all", label: "", rank: 0 };
  }
}

/** Split a sorted row into groups (in a fixed order), each keeping the sort. */
export function groupItems(items: readonly InventoryItem[], key: GroupKey): ItemGroup[] {
  const groups = new Map<string, { label: string; rank: number; items: InventoryItem[] }>();
  for (const item of items) {
    const g = groupOf(key, item);
    const group = groups.get(g.id) ?? { label: g.label, rank: g.rank, items: [] };
    group.items.push(item);
    groups.set(g.id, group);
  }
  const out = [...groups.entries()]
    .sort(([ia, a], [ib, b]) => a.rank - b.rank || ia.localeCompare(ib))
    .map(([id, g]) => ({ key: id, label: g.label, items: g.items }));
  if (out.length <= 1) return out.map((g) => ({ key: g.key, items: g.items }));
  return out;
}
