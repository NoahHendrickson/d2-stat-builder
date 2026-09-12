import type { Manifest } from "../manifest/load";
import { memoByManifest } from "../manifest/memo";
import { buildFragmentStats, type Subclass } from "../armory/fragments";
import type { StatArray } from "../armory/stats";
import {
  ABILITY_KINDS, ABILITY_PLUG_CATEGORY_SUFFIX, ASPECT_SOCKET_COUNT, FRAGMENT_SOCKET_COUNT,
  FRAGMENT_SOCKET_START, SUBCLASS_ITEM_HASHES, SUPER_SOCKET_CATEGORY_HASH, SUPER_SOCKET_COUNT,
  aspectSocketStart, subclassFromItemHash, type AbilityKind,
} from "../dim/subclasses";
import type { DimLoadout, DimLoadoutItem } from "../dim/loadout-link";
import type { SavedLoadoutData } from "./types";

export interface SubclassPlugOption {
  hash: number;
  name: string;
  icon?: string;
  description: string;
  fragmentSlots: number;
  stats: StatArray;
  plugCategory?: string;
}

export interface SubclassSocketOptions {
  start: number;
  count: number;
  emptyHash?: number;
  options: SubclassPlugOption[];
}

/** Manifest slice the socket-index lookups / resolve need — inventory items + socket types. */
export interface SuperSocketLookup {
  def(
    table: "DestinyInventoryItemDefinition" | "DestinySocketTypeDefinition",
    hash: number | undefined | null,
  ): {
    sockets?: { socketEntries: { socketTypeHash?: number; singleInitialItemHash?: number; reusablePlugItems?: { plugItemHash: number }[] }[] };
    socketCategoryHash?: number;
    plugWhitelist?: { categoryIdentifier: string }[];
    plug?: { plugCategoryIdentifier?: string };
  } | undefined;
}

/**
 * Index of the socket for `kind` on this subclass item, or undefined if the def has
 * none. Matches the socket type's plug whitelist first (always present on live data),
 * then the plugs the socket lists, by plug-category suffix.
 */
export function abilitySocketIndex(manifest: SuperSocketLookup, itemHash: number, kind: AbilityKind): number | undefined {
  if (kind === "super") return superSocketIndex(manifest, itemHash);
  const suffix = `.${ABILITY_PLUG_CATEGORY_SUFFIX[kind]}`;
  const entries = manifest.def("DestinyInventoryItemDefinition", itemHash)?.sockets?.socketEntries ?? [];
  for (let i = 0; i < entries.length; i++) {
    const type = manifest.def("DestinySocketTypeDefinition", entries[i].socketTypeHash);
    if (type?.plugWhitelist?.some((w) => w.categoryIdentifier.endsWith(suffix))) return i;
  }
  for (let i = 0; i < entries.length; i++) {
    const hashes = [
      entries[i].singleInitialItemHash,
      ...(entries[i].reusablePlugItems?.map((p) => p.plugItemHash) ?? []),
    ];
    if (hashes.some((h) => {
      const cat = manifest.def("DestinyInventoryItemDefinition", h)?.plug?.plugCategoryIdentifier ?? "";
      return cat.endsWith(suffix);
    })) return i;
  }
  return undefined;
}

/** Index of the Super socket on this subclass item, or undefined if the def has none. */
export function superSocketIndex(manifest: SuperSocketLookup, itemHash: number): number | undefined {
  const entries = manifest.def("DestinyInventoryItemDefinition", itemHash)?.sockets?.socketEntries ?? [];
  for (let i = 0; i < entries.length; i++) {
    const type = manifest.def("DestinySocketTypeDefinition", entries[i].socketTypeHash);
    if (type?.socketCategoryHash === SUPER_SOCKET_CATEGORY_HASH) return i;
  }
  for (let i = 0; i < entries.length; i++) {
    const hashes = [
      entries[i].singleInitialItemHash,
      ...(entries[i].reusablePlugItems?.map((p) => p.plugItemHash) ?? []),
    ];
    if (hashes.some((h) => {
      const cat = manifest.def("DestinyInventoryItemDefinition", h)?.plug?.plugCategoryIdentifier ?? "";
      return cat.includes("supers");
    })) return i;
  }
  return undefined;
}

/** Use the subclass's actual plug sets, so Prismatic variants stay class-correct. */
function computeSubclassOptions(
  manifest: Manifest,
  classType: number,
  subclass: Subclass,
) {
  const itemHash = SUBCLASS_ITEM_HASHES[subclass][classType];
  const def = manifest.def("DestinyInventoryItemDefinition", itemHash);
  const group = (start: number, count: number, includeInitial = false): SubclassSocketOptions => {
    const socket = def?.sockets?.socketEntries[start];
    const plugs = [
      ...(socket?.reusablePlugItems ?? []),
      ...(manifest.def("DestinyPlugSetDefinition", socket?.reusablePlugSetHash)?.reusablePlugItems ?? []),
    ];
    const hashes = [...new Set(plugs.map((p) => p.plugItemHash))];
    const options = hashes.flatMap((hash): SubclassPlugOption[] => {
      const plug = manifest.def("DestinyInventoryItemDefinition", hash);
      if (!plug || (!includeInitial && hash === socket?.singleInitialItemHash)) return [];
      const description = plug.perks?.map((p) =>
        manifest.def("DestinySandboxPerkDefinition", p.perkHash)?.displayProperties?.description,
      ).filter(Boolean).join("\n") || plug.displayProperties.description;
      return [{
        hash, name: plug.displayProperties.name, icon: plug.displayProperties.icon,
        description,
        fragmentSlots: plug.investmentStats?.find((s) => s.statTypeHash === 2223994109)?.value ?? 0,
        stats: buildFragmentStats(plug.investmentStats, classType).stats,
        plugCategory: plug.plug?.plugCategoryIdentifier,
      }];
    }).sort((a, b) => a.name.localeCompare(b.name));
    return {
      start, count,
      emptyHash: includeInitial ? undefined : socket?.singleInitialItemHash,
      options,
    };
  };
  // Abilities are one socket each and optional: no override = keep the in-game choice,
  // so the socket's initial plug is a regular option and there is no "empty" plug.
  const abilities = Object.fromEntries(ABILITY_KINDS.map((kind) => {
    const start = abilitySocketIndex(manifest, itemHash, kind);
    return [kind, start !== undefined ? group(start, SUPER_SOCKET_COUNT, true) : { start: 0, count: 0, options: [] }];
  })) as Record<AbilityKind, SubclassSocketOptions>;
  return {
    itemHash, name: def?.displayProperties.name ?? subclass,
    abilities,
    aspects: group(aspectSocketStart(subclass), ASPECT_SOCKET_COUNT),
    fragments: group(FRAGMENT_SOCKET_START[subclass], FRAGMENT_SOCKET_COUNT),
  };
}

const subclassOptionsForManifest = memoByManifest((manifest: Manifest) => {
  const cache = new Map<string, ReturnType<typeof computeSubclassOptions>>();
  return (classType: number, subclass: Subclass) => {
    const key = `${classType}:${subclass}`;
    let value = cache.get(key);
    if (!value) {
      value = computeSubclassOptions(manifest, classType, subclass);
      cache.set(key, value);
    }
    return value;
  };
});

/** Use the subclass's actual plug sets, so Prismatic variants stay class-correct. */
export function subclassOptions(
  manifest: Manifest,
  classType: number,
  subclass: Subclass,
) {
  return subclassOptionsForManifest(manifest)(classType, subclass);
}

export type SubclassCatalog = ReturnType<typeof subclassOptions>;

export function loadoutSubclass(loadout: DimLoadout): DimLoadoutItem | null {
  return loadout.equipped.find((item) => subclassFromItemHash(item.hash)) ?? null;
}

/** The plugs `item` pins in a socket group (in socket order), ignoring the group's empty plug. */
export function selectedSubclassPlugs(
  item: DimLoadoutItem | null,
  group: Pick<SubclassSocketOptions, "start" | "count" | "emptyHash">,
): number[] {
  return Object.entries(item?.socketOverrides ?? {})
    .filter(([i, hash]) => Number(i) >= group.start && Number(i) < group.start + group.count && hash !== group.emptyHash)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, hash]) => hash);
}

export function subclassFragmentCapacity(item: DimLoadoutItem, aspects: SubclassSocketOptions): number {
  const specified = Object.keys(item.socketOverrides ?? {}).some((i) => Number(i) >= aspects.start && Number(i) < aspects.start + aspects.count);
  if (!specified) return FRAGMENT_SOCKET_COUNT;
  return selectedSubclassPlugs(item, aspects).reduce((sum, hash) =>
    sum + (aspects.options.find((o) => o.hash === hash)?.fragmentSlots ?? 0), 0);
}

export function subclassSelectionValid(section: { manifest: Manifest; classType: number }, item: DimLoadoutItem | null): boolean {
  if (!item) return true;
  const subclass = subclassFromItemHash(item.hash);
  if (!subclass) return false;
  const options = subclassOptions(section.manifest, section.classType, subclass);
  if (item.hash !== options.itemHash) return false;
  const aspects = selectedSubclassPlugs(item, options.aspects);
  const fragments = selectedSubclassPlugs(item, options.fragments);
  return aspects.length <= ASPECT_SOCKET_COUNT &&
    fragments.length <= subclassFragmentCapacity(item, options.aspects) &&
    [...Object.values(options.abilities), options.aspects, options.fragments].every((group) => {
      const selected = selectedSubclassPlugs(item, group);
      return new Set(selected).size === selected.length && selected.every((hash) => group.options.some((o) => o.hash === hash));
    });
}

/** Explicit empty plugs let DIM and Apply remove selections as well as add them. */
export function withSubclassPlugs(item: DimLoadoutItem, group: SubclassSocketOptions, hashes: number[]): DimLoadoutItem {
  const socketOverrides = { ...item.socketOverrides };
  for (let i = 0; i < group.count; i++) {
    const hash = hashes[i] ?? group.emptyHash;
    if (hash !== undefined) socketOverrides[group.start + i] = hash;
    else delete socketOverrides[group.start + i];
  }
  return { ...item, socketOverrides };
}

/**
 * Keep the DIM carrier and the builder snapshot in sync. Displayed stat totals are the
 * editor's job (`withEditorTotals`), not derived here.
 */
export function withLoadoutSubclass(data: SavedLoadoutData, item: DimLoadoutItem | null | undefined, manifest: Manifest): SavedLoadoutData {
  if (item === undefined) return data;
  const subclass = item ? subclassFromItemHash(item.hash) : undefined;
  const fragmentHashes = subclass && item
    ? selectedSubclassPlugs(item, subclassOptions(manifest, data.loadout.classType, subclass).fragments)
    : [];
  return {
    ...data,
    loadout: { ...data.loadout, equipped: [
      ...data.loadout.equipped.filter((ref) => !subclassFromItemHash(ref.hash)),
      ...(item ? [item] : []),
    ] },
    ...(data.builder ? { builder: {
      ...data.builder, activeSubclass: subclass ?? data.builder.activeSubclass, fragmentHashes,
    } } : {}),
  };
}
