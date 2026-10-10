// The Bungie calls behind one inventory-manager move. Pure, so the route and its tests
// share one definition of "how does an item get from A to B".

/** Where an item is now. */
export type MoveSource =
  | { kind: "vault" }
  | { kind: "character"; characterId: string; equipped?: boolean }
  | { kind: "postmaster"; characterId: string };

/** Where it should end up. `equip` also equips it on arrival. */
export type MoveDestination =
  | { kind: "vault" }
  | { kind: "character"; characterId: string; equip?: boolean };

export interface MoveRequest {
  /** Instance id; "0" for a non-instanced stack (postmaster pulls only). */
  itemId: string;
  itemHash: number;
  stackSize: number;
  from: MoveSource;
  to: MoveDestination;
}

export type MoveStep =
  | { kind: "pull"; characterId: string }
  | { kind: "toVault"; characterId: string }
  | { kind: "fromVault"; characterId: string }
  | { kind: "equip"; characterId: string };

/** Where the item is after a step: the vault, or a character's inventory / equipped slot. */
export type Landing = { kind: "vault" } | { kind: "character"; characterId: string; equipped?: boolean };

export class MovePlanError extends Error {}

/**
 * The steps for a move, in order. Characters never trade directly: an item hops through
 * the vault. Postmaster items are pulled onto their owner first. Equipped items can't be
 * transferred at all (Bungie wants something else equipped first), so those are refused.
 */
export function planMove(req: MoveRequest): MoveStep[] {
  const { from, to } = req;
  const steps: MoveStep[] = [];

  let at: Landing;
  if (from.kind === "postmaster") {
    steps.push({ kind: "pull", characterId: from.characterId });
    at = { kind: "character", characterId: from.characterId };
    const stays = to.kind === "character" && to.characterId === from.characterId && !to.equip;
    if (req.itemId === "0" && !stays) {
      throw new MovePlanError("Stacks can only be pulled onto their own character");
    }
  } else if (from.kind === "character") {
    if (from.equipped) {
      const sameSlot = to.kind === "character" && to.characterId === from.characterId && to.equip;
      if (sameSlot) return [];
      throw new MovePlanError("Equipped — equip something else in that slot first");
    }
    at = { kind: "character", characterId: from.characterId };
  } else {
    at = { kind: "vault" };
  }

  if (to.kind === "vault") {
    if (at.kind === "character") steps.push({ kind: "toVault", characterId: at.characterId });
    return steps;
  }

  if (at.kind === "character" && at.characterId !== to.characterId) {
    steps.push({ kind: "toVault", characterId: at.characterId });
    at = { kind: "vault" };
  }
  if (at.kind === "vault") steps.push({ kind: "fromVault", characterId: to.characterId });
  if (to.equip) steps.push({ kind: "equip", characterId: to.characterId });
  return steps;
}

/** Where the item sits once `step` has succeeded. */
export function landingAfter(step: MoveStep): Landing {
  switch (step.kind) {
    case "toVault":
      return { kind: "vault" };
    case "equip":
      return { kind: "character", characterId: step.characterId, equipped: true };
    default:
      return { kind: "character", characterId: step.characterId };
  }
}
