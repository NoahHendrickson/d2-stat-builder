// Farming mode (DIM's): while the player farms on one character, keep a slot open in
// each of its gear buckets so new drops land there instead of in the postmaster. Plans
// which items go to the vault; the manager runs the plans after each profile refresh.
import type { ManagerInventory } from "./build";
import { CHARACTER_SLOTS, MOVABLE_BUCKETS, applyMoves, locate } from "./moves";
import { keepScore, planSmartMove, type MoveStep, type SmartContext } from "./smart-moves";

/** TransferStatuses.NotTransferrable */
const NOT_TRANSFERRABLE = 2;
/** A pass never plans more than this many moves (a full vault can't take more anyway). */
const MAX_MOVES = 30;

/**
 * The moves (each a smart plan: vault space first when needed) that leave `free` open
 * slots in every gear bucket of `characterId`, least wanted items first.
 */
export function farmingPlans(
  inventory: ManagerInventory,
  characterId: string,
  ctx: SmartContext,
  free = 1,
): MoveStep[][] {
  const plans: MoveStep[][] = [];
  const context = { ...ctx, spare: characterId };
  let sim = inventory;
  for (const bucket of MOVABLE_BUCKETS) {
    for (;;) {
      if (plans.length >= MAX_MOVES) return plans;
      const c = sim.characters.find((ch) => ch.id === characterId);
      if (!c) return plans;
      const list = c.inventory[bucket] ?? [];
      if (list.length <= CHARACTER_SLOTS - free) break;
      const candidates = list.filter((i) => i.instanceId && !(i.transferStatus & NOT_TRANSFERRABLE));
      if (candidates.length === 0) break;
      const pick = candidates.reduce((a, b) => (keepScore(b, c, context) < keepScore(a, c, context) ? b : a));
      const plan = planSmartMove(sim, pick, locate(sim, pick.key)!.place, { kind: "vault" }, context);
      if (!plan.ok) break;
      plans.push(plan.steps);
      sim = applyMoves(
        sim,
        plan.steps.map((s) => ({ id: -1, itemKey: s.item.key, to: s.to, status: "pending" as const, at: 0 })),
      );
    }
  }
  return plans;
}
