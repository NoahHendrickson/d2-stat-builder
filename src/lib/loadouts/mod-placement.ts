// The mod picker's data model: what the Save / Edit dialogs show, and how their
// socket-by-socket choices turn back into the dim-api flat `parameters.mods` list.
// Runtime imports are relative so the module runs under vitest.
import type { ArmorPiece, ArmorSocket } from "../armory/normalize";
import type { ModOptionCatalog } from "./mod-options";
import type { ModPlacement } from "./types";
import type { ApplyPlan, UnplacedMod } from "./apply-plan";

/** When present, a details dialog also shows the socket-by-socket mod picker. */
export interface ModsSection {
  /** Live pieces in slot order (every piece must be resolved). */
  pieces: ArmorPiece[];
  catalog: ModOptionCatalog;
  /** Sockets pre-chosen for the user — the planner's `assigned`. */
  initial: ModPlacement;
  /**
   * Loadout mods the planner could NOT place on these pieces right now (energy, roll,
   * missing socket…), each with why. They stay in the loadout when it is saved — see
   * `modsFromEditor`.
   */
  unplaced: UnplacedMod[];
  /** Plugs the player can socket right now (`Armory.insertablePlugs`), if known. */
  insertable?: ReadonlySet<number>;
  /**
   * General/stat mods the loadout wants (optimizer assignment). Auto-placed onto
   * leftover energy after armor mods; copies that don't fit stay here so they are
   * not dropped from the loadout.
   */
  desiredStatMods?: number[];
}

/** A `ModsSection` seeded from an apply plan over `pieces`. */
export function modsSectionFromPlan(
  pieces: ArmorPiece[],
  catalog: ModOptionCatalog,
  plan: ApplyPlan,
  insertable?: ReadonlySet<number>,
): ModsSection {
  const desiredStatMods = collectDesiredStatMods(pieces, catalog, plan);
  return {
    pieces,
    catalog,
    initial: plan.assigned,
    unplaced: plan.unplaced,
    ...(desiredStatMods.length > 0 ? { desiredStatMods } : {}),
    ...(insertable ? { insertable } : {}),
  };
}

/** Assigned general plugs in piece/socket order, then unplaced hashes that are stat mods. */
function collectDesiredStatMods(
  pieces: ArmorPiece[],
  catalog: ModOptionCatalog,
  plan: ApplyPlan,
): number[] {
  const out: number[] = [];
  for (const p of pieces) {
    for (const s of p.armorSockets ?? []) {
      if (s.kind !== "general") continue;
      const hash = plan.assigned[p.instanceId]?.[s.index];
      if (hash !== undefined) out.push(hash);
    }
  }
  for (const { hash } of plan.unplaced) {
    if (catalog.kind(hash) === "general") out.push(hash);
  }
  return out;
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

/**
 * One click on a single-slot exclusive group (stat mod, tuning): select `hash`,
 * replacing whatever is already chosen in these sockets. A second click on the
 * same mod clears it.
 */
export function toggleExclusiveMod(
  chosen: Record<number, number> | undefined,
  sockets: readonly ArmorSocket[],
  hash: number,
): Record<number, number> {
  const next: Record<number, number> = { ...(chosen ?? {}) };
  const already = sockets.some((s) => next[s.index] === hash);
  for (const s of sockets) delete next[s.index];
  if (!already && sockets[0]) next[sockets[0].index] = hash;
  return next;
}

/**
 * Energy the loadout's chosen mods would use on this piece. Vault plugs and live
 * `energy.used` do not count — unchosen sockets are empty as far as the editor is
 * concerned. Capacity still comes from the piece. `excludeKind` skips that socket
 * group (armor-mod clicks ignore the auto-assigned stat mod, which may move).
 */
export function pieceEnergyUsed(
  piece: ArmorPiece,
  chosen: Record<number, number> | undefined,
  costOf: (hash: number) => number,
  excludeKind?: ArmorSocket["kind"],
): number {
  let used = 0;
  for (const s of piece.armorSockets ?? []) {
    if (excludeKind && s.kind === excludeKind) continue;
    const hash = chosen?.[s.index];
    if (hash) used += costOf(hash);
  }
  return used;
}

function generalSocket(piece: ArmorPiece): ArmorSocket | undefined {
  return piece.armorSockets?.find((s) => s.kind === "general");
}

/**
 * Place `statHashes` onto leftover energy after the rest of `placement` (armor /
 * tuning / artifice stay put). Costliest first, onto the piece with the most free
 * energy. General sockets are cleared and refilled; hashes that don't fit are
 * returned in `unplaced` (original order).
 */
export function placeStatMods(
  pieces: ArmorPiece[],
  placement: ModPlacement,
  statHashes: readonly number[],
  costOf: (hash: number) => number,
): { placement: ModPlacement; unplaced: number[] } {
  const next: ModPlacement = {};
  for (const p of pieces) {
    const chosen = placement[p.instanceId];
    if (!chosen) continue;
    const kept: Record<number, number> = {};
    for (const s of p.armorSockets ?? []) {
      if (s.kind === "general") continue;
      const hash = chosen[s.index];
      if (hash !== undefined) kept[s.index] = hash;
    }
    if (Object.keys(kept).length > 0) next[p.instanceId] = kept;
  }

  const pending = [...statHashes];
  const unplaced: number[] = [];
  const ranked = pending
    .map((hash, i) => ({ hash, i, cost: costOf(hash) }))
    .sort((a, b) => b.cost - a.cost || a.i - b.i);

  const freeEnergy = (p: ArmorPiece) => {
    const cap = p.energy?.capacity ?? Number.POSITIVE_INFINITY;
    return cap - pieceEnergyUsed(p, next[p.instanceId], costOf);
  };

  for (const { hash, cost } of ranked) {
    const candidates = pieces.filter((p) => {
      const g = generalSocket(p);
      if (!g || next[p.instanceId]?.[g.index] !== undefined) return false;
      return freeEnergy(p) >= cost;
    });
    candidates.sort((a, b) => freeEnergy(b) - freeEnergy(a));
    const pick = candidates[0];
    const g = pick ? generalSocket(pick) : undefined;
    if (!pick || !g) {
      unplaced.push(hash);
      continue;
    }
    next[pick.instanceId] = { ...(next[pick.instanceId] ?? {}), [g.index]: hash };
  }
  // Keep unplaced in wishlist order, not cost order.
  unplaced.sort((a, b) => pending.indexOf(a) - pending.indexOf(b));
  return { placement: next, unplaced };
}

/**
 * Slot one copy of a stat mod by hand: the empty general socket on the piece with the
 * most energy to spare, or null when no piece has an empty one with `cost` free. Unlike
 * `placeStatMods`, nothing already chosen is cleared or moved.
 */
export function slotStatMod(
  pieces: ArmorPiece[],
  placement: ModPlacement,
  hash: number,
  costOf: (hash: number) => number,
): ModPlacement | null {
  const cost = costOf(hash);
  let pick: { instanceId: string; index: number; free: number } | undefined;
  for (const p of pieces) {
    const g = generalSocket(p);
    if (!g || placement[p.instanceId]?.[g.index] !== undefined) continue;
    const cap = p.energy?.capacity ?? Number.POSITIVE_INFINITY;
    const free = cap - pieceEnergyUsed(p, placement[p.instanceId], costOf);
    if (free < cost) continue;
    if (!pick || free > pick.free) pick = { instanceId: p.instanceId, index: g.index, free };
  }
  if (!pick) return null;
  return {
    ...placement,
    [pick.instanceId]: { ...(placement[pick.instanceId] ?? {}), [pick.index]: hash },
  };
}

/** Re-place `section.desiredStatMods` onto leftover energy in `placement`. */
export function placementWithStatMods(
  section: ModsSection,
  placement: ModPlacement,
): ModPlacement {
  const desired = section.desiredStatMods ?? [];
  if (desired.length === 0) return placement;
  const costOf = (h: number) => section.catalog.option(h)?.cost ?? 0;
  return placeStatMods(section.pieces, placement, desired, costOf).placement;
}

export interface ModEditorState {
  placement: ModPlacement;
  desiredStatMods: number[];
}

/** Explicit stat edits change the wishlist; automatic energy rebalancing does not. */
export function updateEditorPiece(
  section: ModsSection,
  state: ModEditorState,
  instanceId: string,
  chosen: Record<number, number>,
): ModEditorState {
  const before = state.placement[instanceId];
  const placement = { ...state.placement };
  if (Object.keys(chosen).length === 0) delete placement[instanceId];
  else placement[instanceId] = chosen;
  const general = (section.pieces.find((p) => p.instanceId === instanceId)?.armorSockets ?? [])
    .filter((s) => s.kind === "general");
  const changed = general.filter((s) => before?.[s.index] !== chosen[s.index]);
  if (changed.length === 0) {
    return {
      ...state,
      placement: placementWithStatMods({ ...section, desiredStatMods: state.desiredStatMods }, placement),
    };
  }

  const desiredStatMods = [...state.desiredStatMods];
  for (const socket of changed) {
    const old = before?.[socket.index];
    const i = old === undefined ? -1 : desiredStatMods.indexOf(old);
    if (i >= 0) desiredStatMods.splice(i, 1);
  }
  // A new selection may fill an existing unplaced copy. Only add copies beyond
  // those already wanted, including when the same hash occupies several pieces.
  const remaining = [...desiredStatMods];
  for (const p of section.pieces) {
    for (const socket of p.armorSockets ?? []) {
      if (socket.kind !== "general") continue;
      const hash = placement[p.instanceId]?.[socket.index];
      if (hash === undefined) continue;
      const i = remaining.indexOf(hash);
      if (i >= 0) remaining.splice(i, 1);
      else desiredStatMods.push(hash);
    }
  }
  return { placement, desiredStatMods };
}

/** Per desired hash: whether a copy is currently in a general socket (multiset). */
export function statModSlotted(
  desired: readonly number[],
  placement: ModPlacement,
  pieces: ArmorPiece[],
): boolean[] {
  const placed: number[] = [];
  for (const p of pieces) {
    for (const s of p.armorSockets ?? []) {
      if (s.kind !== "general") continue;
      const hash = placement[p.instanceId]?.[s.index];
      if (hash !== undefined) placed.push(hash);
    }
  }
  return desired.map((hash) => {
    const i = placed.indexOf(hash);
    if (i < 0) return false;
    placed.splice(i, 1);
    return true;
  });
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
export function modsFromEditor(
  section: ModsSection,
  placement: ModPlacement,
  desiredStatMods = section.desiredStatMods,
): number[] {
  const placed = placementToMods(placement, section.pieces);
  // Stat copies are accounted for by the current wishlist, including explicit
  // replacements/removals after an initially unplaced mod was manually slotted.
  const leftover = section.unplaced
    .filter((u) => !section.desiredStatMods?.includes(u.hash))
    .map((u) => u.hash);
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
  const result = [...placed, ...leftover];
  const stillWanted = [...(desiredStatMods ?? [])];
  for (const hash of result) {
    const i = stillWanted.indexOf(hash);
    if (i >= 0) stillWanted.splice(i, 1);
  }
  return [...result, ...stillWanted];
}
