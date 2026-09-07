// The mod picker's data model: what the Save / Edit dialogs show, and how their
// socket-by-socket choices turn back into the dim-api flat `parameters.mods` list.
// Runtime imports are relative so the module runs under vitest.
import type { ArmorPiece, ArmorSocket } from "../armory/normalize";
import type { ModOptionCatalog } from "./mod-options";
import type { ModPlacement } from "./types";
import type { ApplyPlan } from "./apply-plan";
import { baselineEnergy } from "./energy";

/** When present, a details dialog also shows the socket-by-socket mod picker. */
export interface ModsSection {
  /** Live pieces in slot order (every piece must be resolved). */
  pieces: ArmorPiece[];
  catalog: ModOptionCatalog;
  /** Sockets pre-chosen for the user — the planner's `assigned`. */
  initial: ModPlacement;
  /**
   * Loadout mods the planner could NOT place on these pieces right now (energy, roll,
   * missing socket…). They stay in the loadout when it is saved — see `modsFromEditor`.
   */
  unplaced: number[];
  /** Human-readable reasons for `unplaced`, shown in the dialog. */
  skipped: string[];
  /** Plugs the player can socket right now (`Armory.insertablePlugs`), if known. */
  insertable?: ReadonlySet<number>;
}

/** A `ModsSection` seeded from an apply plan over `pieces`. */
export function modsSectionFromPlan(
  pieces: ArmorPiece[],
  catalog: ModOptionCatalog,
  plan: ApplyPlan,
  insertable?: ReadonlySet<number>,
): ModsSection {
  return {
    pieces,
    catalog,
    initial: plan.assigned,
    unplaced: plan.unplaced,
    skipped: plan.skipped,
    ...(insertable ? { insertable } : {}),
  };
}

/** How many of `sockets` (one kind on one piece) currently hold `hash`. */
export function chosenCount(
  chosen: Record<number, number> | undefined,
  sockets: readonly ArmorSocket[],
  hash: number,
): number {
  return sockets.filter((s) => chosen?.[s.index] === hash).length;
}

/**
 * One click on a mod in a stacked grid (all same-kind sockets of a piece share one
 * grid): put another copy in the next free socket; once the mod is at its limit —
 * `maxStack` copies, or no socket left — the click clears every copy instead.
 * Returns the piece's next chosen map (other mods untouched).
 */
export function cycleModStack(
  chosen: Record<number, number> | undefined,
  sockets: readonly ArmorSocket[],
  hash: number,
  maxStack: number,
): Record<number, number> {
  const next: Record<number, number> = { ...(chosen ?? {}) };
  const count = chosenCount(chosen, sockets, hash);
  const free = sockets.find((s) => next[s.index] === undefined);
  if (count >= maxStack || !free) {
    for (const s of sockets) if (next[s.index] === hash) delete next[s.index];
    return next;
  }
  next[free.index] = hash;
  return next;
}

/** Energy a piece would use with the editor's choices (unchosen sockets keep their current plug). */
export function pieceEnergyUsed(
  piece: ArmorPiece,
  chosen: Record<number, number> | undefined,
  costOf: (hash: number) => number,
): number {
  const sockets = piece.armorSockets ?? [];
  let after = 0;
  for (const s of sockets) {
    const next = chosen?.[s.index] ?? s.plugHash;
    after += next ? costOf(next) : 0;
  }
  return baselineEnergy(piece.energy, sockets.map((s) => s.plugHash), costOf) + after;
}

/** Flatten editor choices to the dim-api mods list (loadout order: piece, then socket). */
export function placementToMods(placement: ModPlacement, pieces: ArmorPiece[]): number[] {
  const out: number[] = [];
  for (const p of pieces) {
    const sockets = placement[p.instanceId];
    if (!sockets) continue;
    for (const s of p.armorSockets ?? []) {
      const hash = sockets[s.index];
      if (hash !== undefined) out.push(hash);
    }
  }
  return out;
}

/**
 * The loadout's `parameters.mods` after the user finishes in the picker: every chosen
 * socket's mod, plus the mods the planner couldn't place (kept, not dropped — the
 * loadout is a wish list, and the player's armor may fit them later). If the user hand-
 * placed one of those unplaced mods, it moves from the unplaced list into a socket
 * rather than being counted twice.
 */
export function modsFromEditor(section: ModsSection, placement: ModPlacement): number[] {
  const placed = placementToMods(placement, section.pieces);
  const leftover = [...section.unplaced];
  const before = placementToMods(section.initial, section.pieces);
  for (const hash of placed) {
    const i = before.indexOf(hash);
    if (i >= 0) {
      before.splice(i, 1); // was pre-chosen — not a new placement
      continue;
    }
    const j = leftover.indexOf(hash);
    if (j >= 0) leftover.splice(j, 1);
  }
  return [...placed, ...leftover];
}
