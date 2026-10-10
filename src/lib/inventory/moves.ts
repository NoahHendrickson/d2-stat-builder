// Pure move logic for the inventory manager: where an item is, whether a move can work,
// and how the inventory looks once pending moves are applied on top of the last profile.
import { CLASS_NAMES } from "@/lib/armory/stats";
import type { Landing } from "@/lib/bungie/move-plan";
import { ACCOUNT_ROWS, CHARACTER_GROUPS, VAULT_ROW_HASHES } from "./buckets";
import {
  OTHER_BUCKET,
  compareItems,
  compareVaultItems,
  type InventoryItem,
  type ManagerCharacter,
  type ManagerInventory,
} from "./build";

export type { Landing } from "@/lib/bungie/move-plan";

/** Where an item sits in a `ManagerInventory`. */
export type Place =
  | { kind: "vault" }
  | { kind: "character"; characterId: string; equipped: boolean }
  | { kind: "postmaster"; characterId: string }
  | { kind: "account" };

/** A move the client has asked for, laid over the profile until the profile catches up. */
export interface MoveOp {
  id: number;
  itemKey: string;
  to: Landing;
  status: "pending" | "done";
  /** Date.now() when requested; done ops older than OP_TTL_MS are dropped regardless. */
  at: number;
}

/** A finished op the profile still doesn't reflect is dropped after this (stale / moved elsewhere). */
export const OP_TTL_MS = 2 * 60_000;
/** Unequipped slots per character bucket (10 including the equipped item). */
export const CHARACTER_SLOTS = 9;

/** Buckets whose items the manager moves: weapons, armor, ghost, sparrow, ship. */
export const MOVABLE_BUCKETS: ReadonlySet<number> = new Set(
  CHARACTER_GROUPS.flatMap((g) => g.rows.map((r) => r.hash)),
);
const ACCOUNT_BUCKETS: ReadonlySet<number> = new Set(ACCOUNT_ROWS.map((r) => r.hash));

export function locate(
  inv: ManagerInventory,
  key: string,
): { item: InventoryItem; place: Place } | undefined {
  for (const c of inv.characters) {
    for (const item of Object.values(c.equipped)) {
      if (item.key === key) return { item, place: { kind: "character", characterId: c.id, equipped: true } };
    }
    for (const list of Object.values(c.inventory)) {
      const item = list.find((i) => i.key === key);
      if (item) return { item, place: { kind: "character", characterId: c.id, equipped: false } };
    }
    const item = c.postmaster.find((i) => i.key === key);
    if (item) return { item, place: { kind: "postmaster", characterId: c.id } };
  }
  for (const list of Object.values(inv.vault)) {
    const item = list.find((i) => i.key === key);
    if (item) return { item, place: { kind: "vault" } };
  }
  for (const list of Object.values(inv.account)) {
    const item = list.find((i) => i.key === key);
    if (item) return { item, place: { kind: "account" } };
  }
  return undefined;
}

/** True when the item already sits where `to` would put it. */
export function isAt(place: Place, to: Landing): boolean {
  if (to.kind === "vault") return place.kind === "vault";
  return (
    place.kind === "character" &&
    place.characterId === to.characterId &&
    place.equipped === Boolean(to.equipped)
  );
}

export const characterName = (c: ManagerCharacter) => CLASS_NAMES[c.classType] ?? "Guardian";

/**
 * Why `item` can't go to `to` right now, or null when it can. Checks what the manager
 * knows locally (slot space, vault space, class, equipped state); Bungie has the final
 * word and its refusals come back as errors.
 */
export function moveProblem(
  inv: ManagerInventory,
  item: InventoryItem,
  place: Place,
  to: Landing,
): string | null {
  if (isAt(place, to)) return "Already there";
  if (place.kind === "account") return "Account-wide items stay where they are";

  const target = to.kind === "character" ? inv.characters.find((c) => c.id === to.characterId) : undefined;
  if (to.kind === "character" && !target) return "That character is gone — refresh your gear";

  if (place.kind === "postmaster") {
    const home = to.kind === "character" && to.characterId === place.characterId && !to.equipped;
    if (!item.instanceId && !home) return "Pull it onto its own character first";
    if (!home && !MOVABLE_BUCKETS.has(item.bucketHash)) return "Pull it onto its own character first";
  } else {
    if (!MOVABLE_BUCKETS.has(item.bucketHash) || !item.instanceId) return "This item can't be moved here";
    if (place.kind === "character" && place.equipped) {
      return "Equipped — equip something else in that slot first";
    }
    // TransferStatuses.NotTransferrable: fine to equip where it is, can't leave the character.
    const leaves = !(place.kind === "character" && to.kind === "character" && to.characterId === place.characterId);
    if (leaves && item.transferStatus & 2) return "This item can't be transferred";
  }

  if (to.kind === "character" && target) {
    if (to.equipped) {
      if (!MOVABLE_BUCKETS.has(item.bucketHash)) return "This item can't be equipped";
      if (item.classType !== 3 && item.classType !== target.classType) {
        return `${CLASS_NAMES[item.classType] ?? "Another class's"} gear can't be equipped by a ${characterName(target)}`;
      }
    }
    const arriving = !(place.kind === "character" && place.characterId === target.id);
    const lands =
      place.kind === "postmaster" && !MOVABLE_BUCKETS.has(item.bucketHash) ? undefined : item.bucketHash;
    if (arriving && lands !== undefined && (target.inventory[lands]?.length ?? 0) >= CHARACTER_SLOTS) {
      return `No room on your ${characterName(target)} — that slot is full`;
    }
  }

  // Leaving a character for anywhere but itself hops through the vault.
  const viaVault =
    to.kind === "vault" ||
    ((place.kind === "character" || place.kind === "postmaster") &&
      to.kind === "character" &&
      to.characterId !== place.characterId);
  if (viaVault && place.kind !== "vault" && inv.vaultCapacity && inv.vaultCount >= inv.vaultCapacity) {
    return "Vault is full";
  }
  return null;
}

/**
 * The inventory with `ops` applied, in order. Every op is "put this item there", so
 * applying one the profile already reflects changes nothing; ops for items that no
 * longer exist are skipped.
 */
export function applyMoves(inv: ManagerInventory, ops: readonly MoveOp[]): ManagerInventory {
  if (ops.length === 0) return inv;
  const next: ManagerInventory = {
    ...inv,
    characters: inv.characters.map((c) => ({
      ...c,
      equipped: { ...c.equipped },
      inventory: Object.fromEntries(Object.entries(c.inventory).map(([k, v]) => [k, [...v]])),
      postmaster: [...c.postmaster],
    })),
    vault: Object.fromEntries(Object.entries(inv.vault).map(([k, v]) => [k, [...v]])),
    account: Object.fromEntries(Object.entries(inv.account).map(([k, v]) => [k, [...v]])),
  };

  for (const op of ops) {
    const found = locate(next, op.itemKey);
    if (!found || isAt(found.place, op.to)) continue;
    const { item, place } = found;
    remove(next, item, place);
    place_(next, item, place, op.to);
  }
  return next;
}

function remove(inv: ManagerInventory, item: InventoryItem, place: Place) {
  const without = (list: InventoryItem[] | undefined) => list?.filter((i) => i.key !== item.key) ?? [];
  if (place.kind === "vault") {
    for (const k of Object.keys(inv.vault)) inv.vault[Number(k)] = without(inv.vault[Number(k)]);
    inv.vaultCount--;
    return;
  }
  if (place.kind === "account") return;
  const c = inv.characters.find((ch) => ch.id === place.characterId);
  if (!c) return;
  if (place.kind === "postmaster") c.postmaster = without(c.postmaster);
  else if (place.equipped) delete c.equipped[item.bucketHash];
  else c.inventory[item.bucketHash] = without(c.inventory[item.bucketHash]);
}

function place_(inv: ManagerInventory, item: InventoryItem, from: Place, to: Landing) {
  if (to.kind === "vault") {
    const row = VAULT_ROW_HASHES.has(item.bucketHash) ? item.bucketHash : OTHER_BUCKET;
    inv.vault[row] = [...(inv.vault[row] ?? []), item].sort(compareVaultItems);
    inv.vaultCount++;
    return;
  }
  const c = inv.characters.find((ch) => ch.id === to.characterId);
  if (!c) return;
  // Pulled consumables and mods land in the account-wide inventories.
  if (from.kind === "postmaster" && ACCOUNT_BUCKETS.has(item.bucketHash)) {
    inv.account[item.bucketHash] = [...(inv.account[item.bucketHash] ?? []), item].sort(compareItems);
    return;
  }
  const bucket = item.bucketHash;
  if (to.equipped) {
    const previous = c.equipped[bucket];
    if (previous) c.inventory[bucket] = [...(c.inventory[bucket] ?? []), previous];
    c.equipped[bucket] = item;
  } else {
    c.inventory[bucket] = [...(c.inventory[bucket] ?? []), item];
  }
  c.inventory[bucket]?.sort(compareItems);
}

/** Done ops the profile now reflects (or that are too old to trust) — safe to forget. */
export function settledOps(base: ManagerInventory, ops: readonly MoveOp[], now: number): Set<number> {
  const out = new Set<number>();
  for (const op of ops) {
    if (op.status !== "done") continue;
    const found = locate(base, op.itemKey);
    if (!found || isAt(found.place, op.to) || now - op.at > OP_TTL_MS) out.add(op.id);
  }
  return out;
}

export interface MoveOption {
  label: string;
  to: Landing;
  /** Why it can't happen right now; the option is shown disabled. */
  problem: string | null;
}

/** Why a move can't happen, or null; the manager passes its smart-move check. */
export type MoveCheck = (item: InventoryItem, place: Place, to: Landing) => string | null;

/**
 * The tap menu's choices for an item: pull, send to each character or the vault, equip.
 * `check` decides which are blocked (default: the plain move, no making room).
 */
export function moveOptions(
  inv: ManagerInventory,
  item: InventoryItem,
  place: Place,
  check: MoveCheck = (i, p, to) => moveProblem(inv, i, p, to),
): MoveOption[] {
  const out: { label: string; to: Landing }[] = [];
  if (place.kind === "account") return [];

  if (place.kind === "postmaster") {
    const owner = inv.characters.find((c) => c.id === place.characterId);
    if (owner) {
      out.push({ label: `Pull to ${characterName(owner)}`, to: { kind: "character", characterId: owner.id } });
    }
  }
  if (!MOVABLE_BUCKETS.has(item.bucketHash) || !item.instanceId) return withProblems(item, place, out, check);

  for (const c of inv.characters) {
    const name = characterName(c);
    const home = place.kind !== "vault" && place.characterId === c.id;
    const equippedHere = home && place.kind === "character" && place.equipped;
    if (!equippedHere && (item.classType === 3 || item.classType === c.classType)) {
      out.push({ label: `Equip on ${name}`, to: { kind: "character", characterId: c.id, equipped: true } });
    }
    if (!home) out.push({ label: `Send to ${name}`, to: { kind: "character", characterId: c.id } });
  }
  if (place.kind !== "vault") out.push({ label: "Send to vault", to: { kind: "vault" } });
  return withProblems(item, place, out, check);
}

function withProblems(
  item: InventoryItem,
  place: Place,
  options: { label: string; to: Landing }[],
  check: MoveCheck,
): MoveOption[] {
  return options.map((o) => ({ ...o, problem: check(item, place, o.to) }));
}

/**
 * The inventory with `fn` applied to every item. Lists and characters with no changed
 * item keep their identity, so memoized rows don't re-render.
 */
export function mapItems(
  inv: ManagerInventory,
  fn: (item: InventoryItem) => InventoryItem,
): ManagerInventory {
  let changed = false;
  const list = (items: InventoryItem[]) => {
    let out: InventoryItem[] | undefined;
    items.forEach((item, i) => {
      const next = fn(item);
      if (next !== item) (out ??= [...items])[i] = next;
    });
    if (out) changed = true;
    return out ?? items;
  };
  const record = (r: Record<number, InventoryItem[]>) => {
    let out: Record<number, InventoryItem[]> | undefined;
    for (const [k, items] of Object.entries(r)) {
      const next = list(items);
      if (next !== items) (out ??= { ...r })[Number(k)] = next;
    }
    return out ?? r;
  };

  const characters = inv.characters.map((c) => {
    let equipped: Record<number, InventoryItem> | undefined;
    for (const [k, item] of Object.entries(c.equipped)) {
      const next = fn(item);
      if (next !== item) (equipped ??= { ...c.equipped })[Number(k)] = next;
    }
    if (equipped) changed = true;
    const inventory = record(c.inventory);
    const postmaster = list(c.postmaster);
    return equipped || inventory !== c.inventory || postmaster !== c.postmaster
      ? { ...c, equipped: equipped ?? c.equipped, inventory, postmaster }
      : c;
  });
  const vault = record(inv.vault);
  const account = record(inv.account);
  return changed ? { ...inv, characters, vault, account } : inv;
}
