// Farm list rules for weapons: which picks make an entry, and which owned copies match one. Reads the
// raw profile (sockets and reusable plugs by hash), so the drop watcher never needs the
// manifest. Pure — runtime imports stay relative so the module runs under vitest.
import type { DestinyProfileResponse } from "bungie-api-ts/destiny2";
import { CLASS_NAMES } from "../armory/stats";
import { BUCKETS } from "../inventory/buckets";
import type { PickSlot, Roll } from "../weapons/pick-slots";
import type { PerkRef, WeaponSummary } from "../weapons/types";
import { weaponVersionFamilyName } from "../weapons/weapon-variants";
import { assignDrops } from "./assign-drops";
import { FARM_LIST_SCHEMA_VERSION, isFarmDone, type FarmColumn, type FarmEntry, type FarmPerk, type WeaponFarmData, type WeaponFarmEntry } from "./types";

/** `ItemState.Crafted`: a shaped copy, whose perks the player chose. */
const CRAFTED = 8;

/** The left and right perk columns: a weapon's first two Trait columns, by index. */
export function traitColumns(weapon: Pick<WeaponSummary, "columns">): [number, number] | null {
  const traits = weapon.columns.flatMap((c, i) => (c.kind === "Trait" ? [i] : []));
  return traits.length >= 2 ? [traits[0]!, traits[1]!] : null;
}

/**
 * Whether weapon search offers an entry for this weapon at all: random-rolled (not
 * craftable, since a craftable one can just be shaped with the perks), with a left and
 * a right column, at least one of them a choice.
 */
export function canFarm(weapon: Pick<WeaponSummary, "columns" | "craftable">): boolean {
  if (weapon.craftable) return false;
  const traits = traitColumns(weapon);
  return traits !== null && traits.some((i) => weapon.columns[i]!.perkIndices.length > 1);
}

/** The pick in a trait column, or its only perk when there's nothing to pick. */
function traitPick(weapon: Pick<WeaponSummary, "columns">, picked: Roll, column: number) {
  const indices = weapon.columns[column]!.perkIndices;
  return picked[column] ?? (indices.length === 1 ? indices[0] : undefined);
}

const perkHashes = (perk: PerkRef) => [perk.hash, ...(perk.alternateHashes ?? [])];

function farmPerk(perk: PerkRef, kind: string, slot?: FarmColumn): FarmPerk {
  return {
    kind,
    name: perk.name,
    ...(perk.icon ? { icon: perk.icon } : {}),
    ...(slot ? { slot } : {}),
    hashes: perkHashes(perk),
  };
}

/**
 * Each perk slot's Farm list column: the frame, the origin trait, then the component
 * columns in order (barrel, then magazine, whatever the type calls them).
 */
function columnSlots(weapon: Pick<WeaponSummary, "columns">, traits: readonly number[]): Map<number, FarmColumn> {
  const out = new Map<number, FarmColumn>();
  let components = 0;
  weapon.columns.forEach((column, i) => {
    if (traits.includes(i)) return;
    if (column.kind === "Intrinsic") out.set(i, "frame");
    else if (column.kind === "Origin Trait") out.set(i, "origin");
    else if (column.kind === "Trait") out.set(i, "other");
    else out.set(i, (["barrel", "magazine"] as const)[components++] ?? "other");
  });
  return out;
}

/**
 * The entry the current picks make, or null until both traits are picked. Other perk
 * columns and the masterwork come along as extras; mods don't (they swap freely).
 * `versions` is every weapon the catalog knows, superseded ones included: the entry
 * matches each same-name version (adept too) that can roll both traits.
 */
export function farmWeaponFromPicks(
  weapon: WeaponSummary,
  perks: readonly PerkRef[],
  versions: readonly WeaponSummary[],
  slots: readonly PickSlot[],
  picked: Roll,
): WeaponFarmData | null {
  if (!canFarm(weapon)) return null;
  const columns = traitColumns(weapon)!;
  const [left, right] = columns.map((c) => {
    const index = traitPick(weapon, picked, c);
    return index === undefined ? undefined : perks[index];
  });
  if (!left || !right) return null;
  const traits: [FarmPerk, FarmPerk] = [farmPerk(left, "Trait"), farmPerk(right, "Trait")];

  const extras: FarmPerk[] = [];
  const columnSlot = columnSlots(weapon, columns);
  for (const slot of slots) {
    if (slot.kind === "mod" || columns.includes(slot.key)) continue;
    const perk = picked[slot.key] === undefined ? undefined : perks[picked[slot.key]!];
    if (!perk) continue;
    if (slot.kind === "masterwork") extras.push(farmPerk(perk, "Masterwork", "masterwork"));
    else extras.push(farmPerk(perk, slot.label, columnSlot.get(slot.key) ?? "other"));
  }

  const family = weaponVersionFamilyName(weapon.name);
  const rolls = (version: WeaponSummary, trait: FarmPerk) =>
    version.columns.some((c) =>
      c.perkIndices.some((i) => perks[i] !== undefined && trait.hashes.includes(perks[i]!.hash)),
    );
  const weaponHashes = [
    weapon.hash,
    ...versions
      .filter(
        (v) =>
          v.hash !== weapon.hash &&
          weaponVersionFamilyName(v.name) === family &&
          traits.every((t) => rolls(v, t)),
      )
      .map((v) => v.hash),
  ];

  return {
    kind: "weapon",
    version: FARM_LIST_SCHEMA_VERSION,
    weaponHash: weapon.hash,
    weaponName: weapon.name,
    ...(weapon.icon ? { weaponIcon: weapon.icon } : {}),
    weaponHashes,
    traits,
    extras,
    ignoredInstanceIds: [],
  };
}

/**
 * The extras a copy has to have too: everything picked but the masterwork, which swaps
 * freely in-game (and takes the manifest to read), so it's only shown against the drop.
 */
export function requiredExtras(entry: Pick<WeaponFarmData, "extras">): FarmPerk[] {
  return entry.extras.filter((perk) => perk.slot !== "masterwork" && perk.kind !== "Masterwork");
}

/** Identifies a roll's picks: the traits (either order) and the required extras. */
export function farmWeaponPicksKey(entry: Pick<WeaponFarmData, "traits" | "extras">): string {
  const hashes = (perks: readonly FarmPerk[]) => perks.map((p) => p.hashes[0]).sort().join(",");
  return `${hashes(entry.traits)}|${hashes(requiredExtras(entry))}`;
}

/** The same weapon and the same picks: a different barrel is a different roll to hunt. */
export function sameFarmWeapon(
  a: Pick<WeaponFarmData, "weaponHashes" | "traits" | "extras">,
  b: Pick<WeaponFarmData, "weaponHashes" | "traits" | "extras">,
) {
  return farmWeaponPicksKey(a) === farmWeaponPicksKey(b) && a.weaponHashes.some((h) => b.weaponHashes.includes(h));
}

/** Where a copy is: the vault, the postmaster, or on (or in) a character. */
export type CopyPlace =
  | { kind: "vault" }
  | { kind: "postmaster"; characterId: string }
  | { kind: "character"; characterId: string };

export interface OwnedCopy {
  instanceId: string;
  itemHash: number;
  crafted: boolean;
  place: CopyPlace;
}

/** Every instanced item the profile holds, with where it is. */
export function ownedCopies(profile: DestinyProfileResponse): OwnedCopy[] {
  const out: OwnedCopy[] = [];
  const add = (
    items: readonly { itemHash: number; itemInstanceId?: string; state: number; bucketHash: number }[] | undefined,
    place: (bucketHash: number) => CopyPlace,
  ) => {
    for (const item of items ?? []) {
      if (!item.itemInstanceId) continue;
      out.push({
        instanceId: item.itemInstanceId,
        itemHash: item.itemHash,
        crafted: (item.state & CRAFTED) !== 0,
        place: place(item.bucketHash),
      });
    }
  };
  // Account-wide inventory is the vault (plus consumables and mods, which never match).
  add(profile.profileInventory?.data?.items, () => ({ kind: "vault" }));
  for (const [characterId, inv] of Object.entries(profile.characterInventories?.data ?? {}))
    add(inv.items, (bucket) =>
      bucket === BUCKETS.postmaster ? { kind: "postmaster", characterId } : { kind: "character", characterId },
    );
  for (const [characterId, inv] of Object.entries(profile.characterEquipment?.data ?? {}))
    add(inv.items, () => ({ kind: "character", characterId }));
  return out;
}

/** Each socket's plugs: the one in it now and every one it rolled with. */
function socketPlugs(profile: DestinyProfileResponse, instanceId: string): Set<number>[] {
  const sockets = profile.itemComponents?.sockets?.data?.[instanceId]?.sockets ?? [];
  const reusable = profile.itemComponents?.reusablePlugs?.data?.[instanceId]?.plugs ?? {};
  return sockets.map((socket, i) => {
    const plugs = new Set((reusable[i] ?? []).map((p) => p.plugItemHash));
    if (socket.plugHash) plugs.add(socket.plugHash);
    return plugs;
  });
}

/** Whether the copy rolled both traits, in two different sockets. */
export function hasTraits(profile: DestinyProfileResponse, instanceId: string, traits: WeaponFarmData["traits"]) {
  const sockets = socketPlugs(profile, instanceId);
  const has = (socket: Set<number>, perk: FarmPerk) => perk.hashes.some((h) => socket.has(h));
  return sockets.some(
    (a, i) => has(a, traits[0]) && sockets.some((b, j) => j !== i && has(b, traits[1])),
  );
}

/**
 * The copies of a listed weapon that rolled both traits and every required extra (a
 * picked barrel, magazine or origin trait), other than the ones the entry ignores.
 * Crafted copies don't count: the player chose those perks.
 */
export function matchingCopies(
  profile: DestinyProfileResponse,
  entry: Pick<WeaponFarmData, "weaponHashes" | "traits" | "extras" | "ignoredInstanceIds">,
  copies: readonly OwnedCopy[] = ownedCopies(profile),
): OwnedCopy[] {
  const hashes = new Set(entry.weaponHashes);
  const ignored = new Set(entry.ignoredInstanceIds);
  const extras = requiredExtras(entry);
  return copies.filter(
    (c) =>
      hashes.has(c.itemHash) &&
      !c.crafted &&
      !ignored.has(c.instanceId) &&
      hasTraits(profile, c.instanceId, entry.traits) &&
      extras.every((perk) => copyHasPerk(profile, c.instanceId, perk)),
  );
}

/** The waiting entries a profile now has a matching copy for, each with its copy (see assignDrops). */
export function newlyObtained(
  profile: DestinyProfileResponse,
  entries: readonly WeaponFarmEntry[],
): { entry: WeaponFarmEntry; copy: OwnedCopy }[] {
  if (entries.every((w) => w.obtained)) return [];
  const copies = ownedCopies(profile);
  return assignDrops(entries, (entry) => matchingCopies(profile, entry, copies));
}

/**
 * New drops whose copy has since been dismantled, never having been kept with Done. Only
 * a whole profile generated after the drop can say so: a partial or older one is just
 * missing the copy, and these get deleted.
 */
export function dismantledDrops<E extends FarmEntry>(profile: DestinyProfileResponse, entries: readonly E[]): E[] {
  if (!profile.profileInventory?.data || !profile.characterInventories?.data || !profile.characterEquipment?.data) return [];
  const minted = Date.parse(profile.responseMintedTimestamp);
  if (Number.isNaN(minted)) return [];
  const held = new Set(ownedCopies(profile).map((c) => c.instanceId));
  if (held.size === 0) return [];
  return entries.filter(
    (e) => e.obtained && !isFarmDone(e) && minted > e.obtained.at && !held.has(e.obtained.instanceId),
  );
}

/** "in your Vault", "on your Hunter", "at the Postmaster": where a copy is, for a sentence. */
export function placeLabel(profile: DestinyProfileResponse | undefined, place: CopyPlace): string {
  if (place.kind === "vault") return "in your Vault";
  const classType = profile?.characters?.data?.[place.characterId]?.classType;
  const name = classType === undefined ? undefined : CLASS_NAMES[classType];
  if (place.kind === "postmaster") return name ? `at your ${name}'s Postmaster` : "at the Postmaster";
  return name ? `on your ${name}` : "on a character";
}

/** Whether the copy rolled the perk in any socket (an extra, for the obtained card). */
export function copyHasPerk(profile: DestinyProfileResponse, instanceId: string, perk: FarmPerk): boolean {
  return socketPlugs(profile, instanceId).some((socket) => perk.hashes.some((h) => socket.has(h)));
}
