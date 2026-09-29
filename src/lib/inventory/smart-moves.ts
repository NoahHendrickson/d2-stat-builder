// Smart moves (DIM's name): when a move can't happen as asked, the other moves that
// make it work, in order. A full slot sends its least wanted item to the vault; a full
// vault sends one of its items to a character with room; an equipped item gets a
// replacement equipped first; equipping an exotic swaps out another equipped exotic.
// Planned against a simulated inventory (the moves laid over it one by one), so each
// step is checked against the state the steps before it leave behind.
import type { Annotations, ItemTag } from "./annotations";
import type { InventoryItem, ManagerCharacter, ManagerInventory } from "./build";
import {
  CHARACTER_SLOTS,
  MOVABLE_BUCKETS,
  applyMoves,
  characterName,
  locate,
  moveProblem,
  type Landing,
  type Place,
} from "./moves";
import { BUCKETS } from "./buckets";

export interface MoveStep {
  item: InventoryItem;
  place: Place;
  to: Landing;
}

export type SmartPlan = { ok: true; steps: MoveStep[] } | { ok: false; problem: string };

export interface SmartContext {
  annotations: Annotations;
  /** Items the player moved themselves lately; moved out of the way only as a last resort. */
  recent?: ReadonlySet<string>;
  /** Items never moved to make room (a bulk move's items already placed). */
  pinned?: ReadonlySet<string>;
  /** A character never used to take vault items (farming keeps its slots open). */
  spare?: string;
}

const TIER_EXOTIC = 6;
const ANY_CLASS = 3;
/** TransferStatuses.NotTransferrable */
const NOT_TRANSFERRABLE = 2;
const WEAPON_BUCKETS = new Set<number>([BUCKETS.kinetic, BUCKETS.energy, BUCKETS.power]);
const ARMOR_BUCKETS = new Set<number>([
  BUCKETS.helmet,
  BUCKETS.arms,
  BUCKETS.chest,
  BUCKETS.legs,
  BUCKETS.classItem,
]);

/** Lower goes to the vault first: junk and fuel before untagged, favorites last. */
const TAG_KEEPNESS: Record<ItemTag | "none", number> = {
  junk: 0,
  infuse: 1,
  archive: 2,
  none: 3,
  keep: 5,
  favorite: 6,
};

class PlanError extends Error {}

/**
 * How much `c` wants to keep `item` in its inventory; the lowest goes to the vault
 * first. Gear another class can't use leaves first, then junk before fuel before
 * untagged before keepers, items the player just moved last; lower rarity, then lower
 * power, break ties.
 */
export function keepScore(item: InventoryItem, c: ManagerCharacter, ctx: SmartContext): number {
  const tag = item.instanceId ? ctx.annotations[item.instanceId]?.tag : undefined;
  return (
    (usableBy(item, c) ? 1_000_000 : 0) +
    (ctx.recent?.has(item.key) ? 500_000 : 0) +
    TAG_KEEPNESS[tag ?? "none"] * 100_000 +
    item.tierType * 10_000 +
    (item.power ?? 0)
  );
}

const usableBy = (item: InventoryItem, c: ManagerCharacter) =>
  item.classType === ANY_CLASS || item.classType === c.classType;

const exoticGroup = (bucket: number) =>
  WEAPON_BUCKETS.has(bucket) ? WEAPON_BUCKETS : ARMOR_BUCKETS.has(bucket) ? ARMOR_BUCKETS : undefined;

/** The other exotic `c` has equipped in `bucket`'s group (weapons or armor), if any. */
function equippedExoticBesides(c: ManagerCharacter, bucket: number): InventoryItem | undefined {
  const group = exoticGroup(bucket);
  if (!group) return undefined;
  for (const b of group) {
    if (b === bucket) continue;
    const eq = c.equipped[b];
    if (eq?.tierType === TIER_EXOTIC) return eq;
  }
  return undefined;
}

export function planSmartMove(
  inventory: ManagerInventory,
  item: InventoryItem,
  place: Place,
  to: Landing,
  ctx: SmartContext,
): SmartPlan {
  // Nothing smart to do: the move works as asked (Bungie refuses a second equipped
  // exotic, which moveProblem doesn't check).
  const direct = moveProblem(inventory, item, place, to);
  const targetChar =
    to.kind === "character" ? inventory.characters.find((c) => c.id === to.characterId) : undefined;
  const exoticClash =
    to.kind === "character" &&
    to.equipped &&
    item.tierType === TIER_EXOTIC &&
    targetChar !== undefined &&
    equippedExoticBesides(targetChar, item.bucketHash) !== undefined;
  if (direct === null && !exoticClash) return { ok: true, steps: [{ item, place, to }] };
  if (direct === "Already there") return { ok: false, problem: direct };

  let sim = inventory;
  const steps: MoveStep[] = [];
  const busy = new Set<string>([item.key]);
  const tagOf = (i: InventoryItem) => (i.instanceId ? ctx.annotations[i.instanceId]?.tag : undefined);

  const character = (id: string) => sim.characters.find((c) => c.id === id)!;
  const vaultFree = () => (sim.vaultCapacity ?? Infinity) - sim.vaultCount;
  const push = (step: MoveStep) => {
    const problem = moveProblem(sim, step.item, step.place, step.to);
    if (problem) throw new PlanError(problem);
    steps.push(step);
    busy.add(step.item.key);
    sim = applyMoves(sim, [{ id: -1, itemKey: step.item.key, to: step.to, status: "pending", at: 0 }]);
  };
  const where = (i: InventoryItem): Place => locate(sim, i.key)!.place;
  const movable = (i: InventoryItem) =>
    !busy.has(i.key) &&
    !ctx.pinned?.has(i.key) &&
    Boolean(i.instanceId) &&
    !(i.transferStatus & NOT_TRANSFERRABLE);

  /** Send vault items to characters with room until the vault has `needed` free slots. */
  const makeVaultSpace = (needed: number, avoid: { characterId: string; bucket: number }[]) => {
    while (vaultFree() < needed) {
      let best: { item: InventoryItem; c: ManagerCharacter; score: number } | undefined;
      for (const [bucketKey, list] of Object.entries(sim.vault)) {
        for (const candidate of list) {
          if (!movable(candidate) || !MOVABLE_BUCKETS.has(candidate.bucketHash)) continue;
          for (const c of sim.characters) {
            if (c.id === ctx.spare) continue;
            if (avoid.some((a) => a.characterId === c.id && a.bucket === candidate.bucketHash)) continue;
            const used = c.inventory[candidate.bucketHash]?.length ?? 0;
            if (used >= CHARACTER_SLOTS) continue;
            // Items the character can use and the player wants to keep go first; then
            // the emptiest slot.
            const score =
              (usableBy(candidate, c) ? 100 : 0) +
              TAG_KEEPNESS[tagOf(candidate) ?? "none"] * 10 +
              (CHARACTER_SLOTS - used);
            if (!best || score > best.score) best = { item: candidate, c, score };
          }
        }
        void bucketKey;
      }
      if (!best) throw new PlanError("Vault is full and no character has room to take something out of it");
      push({ item: best.item, place: { kind: "vault" }, to: { kind: "character", characterId: best.c.id } });
    }
  };

  /** Free one unequipped slot in `bucket` on `c` by sending its least wanted item to the vault. */
  const makeSlotSpace = (c: ManagerCharacter, bucket: number) => {
    if ((character(c.id).inventory[bucket]?.length ?? 0) < CHARACTER_SLOTS) return;
    const candidates = (character(c.id).inventory[bucket] ?? []).filter(movable);
    if (candidates.length === 0) {
      throw new PlanError(`No room on your ${characterName(c)} and nothing there can be moved out`);
    }
    const evict = candidates.reduce((a, b) => (keepScore(b, c, ctx) < keepScore(a, c, ctx) ? b : a));
    makeVaultSpace(1, [{ characterId: c.id, bucket }]);
    push({ item: evict, place: where(evict), to: { kind: "vault" } });
  };

  /**
   * Equip something else in `bucket` on `c` (so what's there can leave): the best item
   * already on the character, else one from the vault. `exoticOk` is false when another
   * slot keeps an exotic equipped.
   */
  const equipReplacement = (c: ManagerCharacter, bucket: number) => {
    const current = character(c.id).equipped[bucket];
    const exoticOk = !equippedExoticBesides(character(c.id), bucket);
    const fits = (i: InventoryItem) =>
      movable(i) && usableBy(i, c) && (exoticOk || i.tierType !== TIER_EXOTIC);
    const better = (a: InventoryItem, b: InventoryItem) => {
      const sameType = (i: InventoryItem) => (i.typeName === current?.typeName ? 1 : 0);
      const junk = (i: InventoryItem) => (tagOf(i) === "junk" ? 1 : 0);
      return junk(a) - junk(b) || sameType(b) - sameType(a) || (b.power ?? 0) - (a.power ?? 0);
    };
    let replacement = (character(c.id).inventory[bucket] ?? []).filter(fits).sort(better)[0];
    if (!replacement) {
      replacement = (sim.vault[bucket] ?? []).filter(fits).sort(better)[0];
      if (!replacement) {
        throw new PlanError(`Nothing else to equip in that slot on your ${characterName(c)}`);
      }
      push({ item: replacement, place: { kind: "vault" }, to: { kind: "character", characterId: c.id } });
    }
    push({
      item: replacement,
      place: where(replacement),
      to: { kind: "character", characterId: c.id, equipped: true },
    });
  };

  try {
    let from = place;
    const bucket = item.bucketHash;
    const staysOn = (id: string) => to.kind === "character" && to.characterId === id;

    // 1. Equipped: equip something else there first (unless it's only changing slot state).
    if (from.kind === "character" && from.equipped) {
      if (staysOn(from.characterId) && to.kind === "character" && to.equipped) {
        return { ok: false, problem: "Already there" };
      }
      equipReplacement(character(from.characterId), bucket);
      from = where(item);
    }

    // 2. Postmaster: the pull lands on its owner, which needs a free slot.
    if (from.kind === "postmaster" && MOVABLE_BUCKETS.has(bucket) && item.instanceId) {
      const owner = character(from.characterId);
      if ((owner.inventory[bucket]?.length ?? 0) >= CHARACTER_SLOTS) makeSlotSpace(owner, bucket);
    }

    // 3. Room on the target character, and in the vault for every hop through it.
    const target = to.kind === "character" ? character(to.characterId) : undefined;
    const arriving =
      target !== undefined && !(from.kind === "character" && from.characterId === target.id);
    if (target && arriving && MOVABLE_BUCKETS.has(bucket)) makeSlotSpace(target, bucket);
    const hops =
      from.kind !== "vault" &&
      (to.kind === "vault" ||
        (to.kind === "character" && "characterId" in from && from.characterId !== to.characterId));
    if (hops) {
      makeVaultSpace(1, target ? [{ characterId: target.id, bucket }] : []);
    }

    // 4. Equipping an exotic: take off the exotic equipped in another slot.
    if (target && to.kind === "character" && to.equipped && item.tierType === TIER_EXOTIC) {
      const other = equippedExoticBesides(character(target.id), bucket);
      if (other) equipReplacement(character(target.id), other.bucketHash);
    }

    const finalFrom = where(item);
    const problem = moveProblem(sim, item, finalFrom, to);
    if (problem) return { ok: false, problem };
    return { ok: true, steps: [...steps, { item, place: finalFrom, to }] };
  } catch (err) {
    if (err instanceof PlanError) return { ok: false, problem: err.message };
    throw err;
  }
}
