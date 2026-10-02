import type {
  DestinyColor,
  DestinyItemComponent,
  DestinyProfileResponse,
} from "bungie-api-ts/destiny2";
import type { Manifest } from "@/lib/manifest/load";
import { parseArchetypeDescription } from "@/lib/armory/archetypes";
import { itemWatermark } from "@/lib/armory/normalize";
import {
  ARMOR_ARCHETYPE_PLUG_CATEGORY,
  STAT_HASHES,
  STAT_ORDER,
  type StatKey,
} from "@/lib/armory/stats";
import { ACCOUNT_ROWS, BUCKETS, VAULT_ROW_HASHES } from "./buckets";
import { maxPower } from "./max-power";

/** One item anywhere on the account, drawn as a tile by the manager. */
export interface InventoryItem {
  /** Stable React key: the instance id, else hash + owner + position (stacks). */
  key: string;
  instanceId?: string;
  itemHash: number;
  name: string;
  icon?: string;
  watermark?: string;
  /** e.g. "Hand Cannon", "Helmet", "Consumable". */
  typeName: string;
  itemType: number;
  /** DestinyClass: 0 Titan, 1 Hunter, 2 Warlock, 3 any. */
  classType: number;
  /** TierType: 6 exotic, 5 legendary, … */
  tierType: number;
  /** Where it belongs (definition bucket) — vault and postmaster items report their own. */
  bucketHash: number;
  quantity: number;
  power?: number;
  /** Armor 3.0 / weapon gear tier (1–5). */
  gearTier?: number;
  /** Weapon element icon (relative Bungie image path). */
  damageIcon?: string;
  /** Weapon element, lower case ("solar", "kinetic", …), for search. */
  element?: string;
  /**
   * Live stats (component 304) by lower-case name without spaces ("range",
   * "aimassistance", "weapons", …); armor also gets "total". For search.
   */
  stats?: Record<string, number>;
  /** Weapon ammo: 1 primary, 2 special, 3 heavy. */
  ammoType?: number;
  /** Champion the weapon stuns: 1 barrier (shield piercing), 2 overload (disruption), 3 unstoppable (stagger). */
  breakerType?: number;
  /** Icon of that champion type (relative Bungie image path). */
  breakerIcon?: string;
  /** Armor 3.0 archetype plug ("Gunner", …) and its primary stat's icon (no shield frame). */
  archetype?: { name: string; icon?: string };
  locked: boolean;
  masterworked: boolean;
  crafted: boolean;
  /** Has a crafting pattern, crafted or not (only set when true). */
  craftable?: boolean;
  /** Enhanced by the player (the game's diamond overlay). */
  enhanced: boolean;
  /** Deepsight resonance (ItemState.HighlightedObjective): extract its pattern. */
  deepsight: boolean;
  /** TransferStatuses bitmask: 0 can transfer; 1 equipped, 2 not transferable, 4 no room. */
  transferStatus: number;
}

export interface ManagerCharacter {
  id: string;
  classType: number;
  light: number;
  emblemBackgroundPath: string;
  /** Square emblem icon (relative Bungie image path), for compact character buttons. */
  emblemPath: string;
  emblemColor?: DestinyColor;
  dateLastPlayed: string;
  /** The character's six armor stat totals (component 200). */
  stats: Partial<Record<StatKey, number>>;
  /** Highest gear power it could equip from the whole account (see max-power.ts). */
  maxPower?: number;
  /** Equipped item per bucket hash. */
  equipped: Record<number, InventoryItem>;
  /** Unequipped items per bucket hash (postmaster excluded). */
  inventory: Record<number, InventoryItem[]>;
  postmaster: InventoryItem[];
}

export interface ManagerInventory {
  /** Most recently played first, as in the game's character select. */
  characters: ManagerCharacter[];
  /** Vault items per definition bucket; buckets without a row of their own share OTHER_BUCKET. */
  vault: Record<number, InventoryItem[]>;
  vaultCount: number;
  vaultCapacity?: number;
  postmasterCapacity?: number;
  /** Account-wide consumables and modifications, per bucket. */
  account: Record<number, InventoryItem[]>;
  /** Slot count of each account-wide bucket, when the manifest knows it. */
  accountCapacity: Record<number, number>;
  /** Glimmer, Bright Dust, … (component 103), in Bungie's order. */
  currencies: Currency[];
}

export interface Currency {
  itemHash: number;
  name: string;
  icon?: string;
  quantity: number;
}

/** Champion names by BreakerType, as the game's mod names put them. */
export const BREAKER_NAMES: Record<number, string> = { 1: "Anti-Barrier", 2: "Overload", 3: "Unstoppable" };

/** Vault items whose bucket has no row of its own (materials, emblems, …). */
export const OTHER_BUCKET = 0;

const ITEM_TYPE_ARMOR = 2;
const ITEM_TYPE_WEAPON = 3;
/** ItemState flags. */
const ITEM_STATE_LOCKED = 1;
const ITEM_STATE_MASTERWORK = 4;
const ITEM_STATE_CRAFTED = 8;
const ITEM_STATE_HIGHLIGHTED_OBJECTIVE = 16;
const ITEM_STATE_ENHANCED = 32;

/**
 * Since Monument of Triumph (2026) every weapon stuns a champion, set by its frame
 * (Area Denial grenade launchers overload, Precision frames pierce barriers, …) or, for
 * exotics, by a hand-picked perk. The API marks it with a hidden sandbox perk on that
 * plug, named "[Disruption] Overload", "[Shield-Piercing] Barrier", or "[Stagger]
 * Unstoppable". Maps each word to its BreakerType.
 */
const CHAMPION_PERK = /^\[(Shield-Piercing|Disruption|Stagger)\]/;
const BREAKER_TYPE_BY_WORD: Record<string, number> = { "Shield-Piercing": 1, Disruption: 2, Stagger: 3 };

/** Per manifest: plug hash → the breaker definition hash its perks grant (0: none). */
const plugBreakers = new WeakMap<Manifest, Map<number, number>>();

function plugBreaker(manifest: Manifest, plugHash: number): number {
  let cache = plugBreakers.get(manifest);
  if (!cache) {
    cache = new Map();
    plugBreakers.set(manifest, cache);
  }
  const known = cache.get(plugHash);
  if (known !== undefined) return known;

  let found = 0;
  const def = manifest.def("DestinyInventoryItemDefinition", plugHash);
  if (def?.breakerTypeHash) found = def.breakerTypeHash;
  for (const { perkHash } of found ? [] : (def?.perks ?? [])) {
    const name = manifest.def("DestinySandboxPerkDefinition", perkHash)?.displayProperties?.name ?? "";
    const word = CHAMPION_PERK.exec(name)?.[1];
    if (!word) continue;
    const type = BREAKER_TYPE_BY_WORD[word];
    const breaker = Object.values(manifest.all("DestinyBreakerTypeDefinition")).find(
      (b) => b.enumValue === type,
    );
    if (breaker) {
      found = breaker.hash;
      break;
    }
  }
  cache.set(plugHash, found);
  return found;
}

/**
 * The champion a weapon stuns (a DestinyBreakerTypeDefinition hash): the instance's or
 * definition's own breaker (older exotics like Thunderlord), else the first plugged
 * perk that grants one (the frame, or an exotic's intrinsic). Artifact-granted stuns
 * aren't on the item and aren't shown.
 */
function breakerHash(
  item: DestinyItemComponent,
  profile: DestinyProfileResponse,
  manifest: Manifest,
  instanceBreaker: number | undefined,
  defBreaker: number | undefined,
): number | undefined {
  if (instanceBreaker) return instanceBreaker;
  if (defBreaker) return defBreaker;
  if (!item.itemInstanceId) return undefined;
  for (const socket of profile.itemComponents?.sockets?.data?.[item.itemInstanceId]?.sockets ?? []) {
    if (!socket.plugHash || !socket.isEnabled) continue;
    const hash = plugBreaker(manifest, socket.plugHash);
    if (hash) return hash;
  }
  return undefined;
}

/** The archetype plugged into an Armor 3.0 piece, if it has one. */
function archetype(
  profile: DestinyProfileResponse,
  manifest: Manifest,
  instanceId: string,
): InventoryItem["archetype"] {
  for (const socket of profile.itemComponents?.sockets?.data?.[instanceId]?.sockets ?? []) {
    if (!socket.plugHash) continue;
    const def = manifest.def("DestinyInventoryItemDefinition", socket.plugHash);
    if (def?.plug?.plugCategoryIdentifier !== ARMOR_ARCHETYPE_PLUG_CATEGORY) continue;
    const name = def.displayProperties?.name;
    if (!name) return undefined;
    // Bungie's archetype icon is the primary stat's glyph inside a shield; the stat's
    // own icon is the same glyph without the frame.
    const primary = parseArchetypeDescription(def.displayProperties.description ?? "")?.primary;
    const icon =
      (primary !== undefined
        ? manifest.def("DestinyStatDefinition", STAT_HASHES[STAT_ORDER[primary]])?.displayProperties?.icon
        : undefined) || def.displayProperties.icon;
    return { name, ...(icon ? { icon } : {}) };
  }
  return undefined;
}

function buildItem(
  item: DestinyItemComponent,
  key: string,
  profile: DestinyProfileResponse,
  manifest: Manifest,
): InventoryItem {
  const def = manifest.def("DestinyInventoryItemDefinition", item.itemHash);
  const instance = item.itemInstanceId
    ? profile.itemComponents?.instances?.data?.[item.itemInstanceId]
    : undefined;
  const power = instance?.primaryStat?.value;
  const gearTier = instance?.gearTier;
  const damageType =
    def?.itemType === ITEM_TYPE_WEAPON && instance?.damageTypeHash
      ? manifest.def("DestinyDamageTypeDefinition", instance.damageTypeHash)?.displayProperties
      : undefined;
  const damageIcon = damageType?.icon || undefined;
  const element = damageType?.name?.toLowerCase() || undefined;
  const stats = item.itemInstanceId ? itemStats(profile, manifest, item.itemInstanceId, def?.itemType) : undefined;
  const watermark = def ? itemWatermark(def, item.versionNumber) : undefined;
  const state = item.state ?? 0;
  const isWeapon = def?.itemType === ITEM_TYPE_WEAPON;
  const breaker = isWeapon
    ? manifest.def(
        "DestinyBreakerTypeDefinition",
        breakerHash(item, profile, manifest, instance?.breakerTypeHash, def?.breakerTypeHash),
      )
    : undefined;
  const ammoType = isWeapon ? def?.equippingBlock?.ammoType : undefined;
  const armorArchetype =
    def?.itemType === ITEM_TYPE_ARMOR && item.itemInstanceId
      ? archetype(profile, manifest, item.itemInstanceId)
      : undefined;

  return {
    key,
    ...(item.itemInstanceId ? { instanceId: item.itemInstanceId } : {}),
    itemHash: item.itemHash,
    name: def?.displayProperties?.name || "Unknown item",
    ...(def?.displayProperties?.icon ? { icon: def.displayProperties.icon } : {}),
    ...(watermark ? { watermark } : {}),
    typeName: def?.itemTypeDisplayName ?? "",
    itemType: def?.itemType ?? 0,
    classType: def?.classType ?? 3,
    tierType: def?.inventory?.tierType ?? 0,
    bucketHash: def?.inventory?.bucketTypeHash ?? item.bucketHash,
    quantity: item.quantity ?? 1,
    ...(typeof power === "number" && power > 0 ? { power } : {}),
    ...(typeof gearTier === "number" && gearTier >= 1 && gearTier <= 5 ? { gearTier } : {}),
    ...(damageIcon ? { damageIcon } : {}),
    ...(element ? { element } : {}),
    ...(stats ? { stats } : {}),
    ...(ammoType ? { ammoType } : {}),
    ...(breaker
      ? {
          breakerType: breaker.enumValue,
          ...(breaker.displayProperties?.icon ? { breakerIcon: breaker.displayProperties.icon } : {}),
        }
      : {}),
    ...(armorArchetype ? { archetype: armorArchetype } : {}),
    locked: (state & ITEM_STATE_LOCKED) !== 0,
    masterworked: (state & ITEM_STATE_MASTERWORK) !== 0,
    crafted: (state & ITEM_STATE_CRAFTED) !== 0,
    ...(def?.inventory?.recipeItemHash ? { craftable: true } : {}),
    enhanced: (state & ITEM_STATE_ENHANCED) !== 0,
    deepsight: (state & ITEM_STATE_HIGHLIGHTED_OBJECTIVE) !== 0,
    transferStatus: item.transferStatus ?? 0,
  };
}


/** An instance's stats by search name; armor adds "total" (the six Armor 3.0 stats). */
function itemStats(
  profile: DestinyProfileResponse,
  manifest: Manifest,
  instanceId: string,
  itemType: number | undefined,
): Record<string, number> | undefined {
  const live = profile.itemComponents?.stats?.data?.[instanceId]?.stats;
  if (!live) return undefined;
  const out: Record<string, number> = {};
  for (const stat of Object.values(live)) {
    const name = manifest.def("DestinyStatDefinition", stat.statHash)?.displayProperties?.name;
    if (name) out[name.toLowerCase().replace(/[^a-z0-9]+/g, "")] = stat.value;
  }
  if (itemType === ITEM_TYPE_ARMOR) {
    out.total = STAT_ORDER.reduce((sum, key) => sum + (live[STAT_HASHES[key]]?.value ?? 0), 0);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Exotics first, then higher power, then name — the order a player scans a slot in. */
export function compareItems(a: InventoryItem, b: InventoryItem): number {
  return (
    b.tierType - a.tierType ||
    (b.power ?? 0) - (a.power ?? 0) ||
    a.name.localeCompare(b.name)
  );
}

/** Vault armor also groups by class, so each class's pieces sit together. */
export function compareVaultItems(a: InventoryItem, b: InventoryItem): number {
  return a.classType - b.classType || compareItems(a, b);
}

function push(map: Record<number, InventoryItem[]>, bucket: number, item: InventoryItem) {
  (map[bucket] ??= []).push(item);
}

function sortAll(map: Record<number, InventoryItem[]>, compare = compareItems) {
  for (const list of Object.values(map)) list.sort(compare);
}

const derived = new WeakMap<DestinyProfileResponse, WeakMap<Manifest, ManagerInventory>>();

/**
 * buildInventory, memoized on both identities (like deriveArmory): the Manager page
 * remounts after the router drops it from its recent routes, and an unchanged profile
 * and manifest shouldn't be laid out, sorted, and power-ranked again. A refetch brings
 * a new profile object, so it always gets a fresh build.
 */
export function deriveInventory(
  profile: DestinyProfileResponse,
  manifest: Manifest,
): ManagerInventory {
  let byManifest = derived.get(profile);
  if (!byManifest) {
    byManifest = new WeakMap();
    derived.set(profile, byManifest);
  }
  let inventory = byManifest.get(manifest);
  if (!inventory) {
    inventory = buildInventory(profile, manifest);
    byManifest.set(manifest, inventory);
  }
  return inventory;
}

/** Lay a GetProfile response out as the manager draws it: characters, vault, account. */
export function buildInventory(
  profile: DestinyProfileResponse,
  manifest: Manifest,
): ManagerInventory {
  const itemKey = (item: DestinyItemComponent, owner: string, index: number) =>
    item.itemInstanceId ?? `${item.itemHash}:${owner}:${index}`;

  const characters: ManagerCharacter[] = Object.values(profile.characters?.data ?? {})
    .map((c) => {
      const equipped: Record<number, InventoryItem> = {};
      profile.characterEquipment?.data?.[c.characterId]?.items.forEach((item, i) => {
        equipped[item.bucketHash] = buildItem(
          item,
          itemKey(item, c.characterId, i),
          profile,
          manifest,
        );
      });

      const inventory: Record<number, InventoryItem[]> = {};
      const postmaster: InventoryItem[] = [];
      profile.characterInventories?.data?.[c.characterId]?.items.forEach((item, i) => {
        const built = buildItem(item, itemKey(item, c.characterId, i), profile, manifest);
        if (item.bucketHash === BUCKETS.postmaster) postmaster.push(built);
        else push(inventory, item.bucketHash, built);
      });
      sortAll(inventory);

      return {
        id: c.characterId,
        classType: c.classType,
        light: c.light,
        emblemBackgroundPath: c.emblemBackgroundPath,
        emblemPath: c.emblemPath,
        ...(c.emblemColor ? { emblemColor: c.emblemColor } : {}),
        dateLastPlayed: c.dateLastPlayed,
        stats: characterStats(c.stats),
        equipped,
        inventory,
        postmaster,
      };
    })
    .sort((a, b) => b.dateLastPlayed.localeCompare(a.dateLastPlayed));

  const vault: Record<number, InventoryItem[]> = {};
  const account: Record<number, InventoryItem[]> = {};
  let vaultCount = 0;
  profile.profileInventory?.data?.items.forEach((item, i) => {
    if (item.bucketHash === BUCKETS.vault) {
      const built = buildItem(item, itemKey(item, "vault", i), profile, manifest);
      push(vault, VAULT_ROW_HASHES.has(built.bucketHash) ? built.bucketHash : OTHER_BUCKET, built);
      vaultCount++;
    } else {
      // Account-wide consumables and mods keep their live bucket.
      const built = buildItem(item, itemKey(item, "account", i), profile, manifest);
      push(account, item.bucketHash, built);
    }
  });
  sortAll(vault, compareVaultItems);
  sortAll(account);

  const bucketCount = (hash: number) =>
    manifest.def("DestinyInventoryBucketDefinition", hash)?.itemCount || undefined;
  const vaultCapacity = bucketCount(BUCKETS.vault);
  const postmasterCapacity = bucketCount(BUCKETS.postmaster);
  const accountCapacity: Record<number, number> = {};
  for (const row of ACCOUNT_ROWS) {
    const count = bucketCount(row.hash);
    if (count) accountCapacity[row.hash] = count;
  }

  // Max power looks at everything a character could equip (not the postmaster).
  const gear = [
    ...characters.flatMap((c) => [...Object.values(c.equipped), ...Object.values(c.inventory).flat()]),
    ...Object.values(vault).flat(),
  ];
  for (const c of characters) {
    const max = maxPower(gear, c.classType);
    if (max !== undefined) c.maxPower = max;
  }

  const currencies: Currency[] = (profile.profileCurrencies?.data?.items ?? []).flatMap((item) => {
    const def = manifest.def("DestinyInventoryItemDefinition", item.itemHash);
    if (!def?.displayProperties?.name) return [];
    return [
      {
        itemHash: item.itemHash,
        name: def.displayProperties.name,
        ...(def.displayProperties.icon ? { icon: def.displayProperties.icon } : {}),
        quantity: item.quantity,
      },
    ];
  });

  return {
    characters,
    vault,
    vaultCount,
    ...(vaultCapacity ? { vaultCapacity } : {}),
    ...(postmasterCapacity ? { postmasterCapacity } : {}),
    account,
    accountCapacity,
    currencies,
  };
}

function characterStats(stats: Record<number, number> | undefined): Partial<Record<StatKey, number>> {
  const out: Partial<Record<StatKey, number>> = {};
  for (const key of STAT_ORDER) {
    const value = stats?.[STAT_HASHES[key]];
    if (typeof value === "number") out[key] = value;
  }
  return out;
}
