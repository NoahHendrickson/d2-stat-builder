// Plan the socket-plug half of applying a loadout: which mod / tuning / artifice /
// fragment plug goes into which socket of which item. Pure and unit-tested; the
// caller feeds it live piece data (sockets, energy, current plugs) and manifest-derived
// plug facts, and hands the resulting actions to the server route.
//
// Works from the dim-api flat `parameters.mods` list (the loadout's source of truth)
// plus the user's optional socket-by-socket `modPlacement`: explicit placements are
// honored first, everything left is auto-placed. So it applies equally to loadouts
// saved from the builder, edited in the mod picker, and imported.
//
// The loadout is applied exactly: an energy-costing leftover in a socket the loadout
// doesn't fill is reset to its empty plug (see `clearsLeftover`), so it neither stays on
// the armor nor holds the energy the loadout's own mods need — even when some of the
// loadout's mods can't be placed. The one carve-out: 0-cost plugs (tuning, artifice)
// stay when the loadout doesn't list them, since they carry stats, not energy. The plan
// decides each socket's final plug first; the actions are the diff from what's socketed.
// Runtime imports are relative so the module runs under vitest.
import type { ArmorSocketKind } from "../armory/stats";
import { baselineEnergy, clearsLeftover } from "./energy";

export interface PlanSocket {
  index: number;
  kind: ArmorSocketKind;
  /** Currently socketed plug. */
  current?: number;
  /**
   * The socket's initial plug from its definition ("Empty Mod Socket" for mod sockets).
   * Undefined when the definition doesn't name one, so the socket is never cleared.
   */
  empty?: number;
  /** Plug hashes this socket accepts (its plug set). Undefined = judge by kind only. */
  accepts?: ReadonlySet<number>;
}

export interface PlanPiece {
  instanceId: string;
  name: string;
  sockets: PlanSocket[];
  energy?: { capacity: number; used: number };
  /** Rolled tuned stat (directional +5 target); undefined when not tunable. */
  tunedStat?: number;
  /** Exotic Tier-5 pieces expose a directional for every stat. */
  flexibleTuning?: boolean;
}

export type PlugKind = "general" | "tuning" | "artifice" | "other";

export interface PlugInfo {
  kind: PlugKind;
  name: string;
  /** Armor energy the plug costs (0 for tuning / artifice). */
  cost: number;
  /** Directional tuning: the +5 stat index. Undefined for Balanced Tuning. */
  tunedPlus?: number;
}

export interface PlugAction {
  itemInstanceId: string;
  socketIndex: number;
  plugItemHash: number;
  /** "Minor Grenade Mod → Helmet name" — for progress + error messages. */
  label: string;
}

export interface ApplyPlan {
  plugs: PlugAction[];
  /** Plugs that are already socketed exactly where they'd go. */
  alreadyApplied: string[];
  /** Same as `alreadyApplied`, as actions — so the progress grid can show them. */
  inPlace: PlugAction[];
  /** Everything that couldn't be placed (armor mods and subclass plugs), as "Name: reason" lines. */
  skipped: string[];
  /**
   * The `modHashes` entries that couldn't be placed (multiset, loadout order), each with
   * its reason. Editors that rebuild `parameters.mods` from `assigned` must append these
   * so a mod that merely doesn't fit the player's CURRENT armor isn't silently dropped.
   */
  unplaced: UnplacedMod[];
  /** Final plug per (piece, socket) the plan arrives at — for previews. Empty plugs are left out. */
  placement: Record<string, Record<number, number>>;
  /** Only the sockets this plan assigned a loadout mod to (new or already correct). */
  assigned: Record<string, Record<number, number>>;
}

export interface UnplacedMod {
  hash: number;
  reason: string;
}

export interface SubclassPlan {
  instanceId: string;
  /** Abilities (Super first), then aspects, then fragments. */
  groups: SubclassPlugGroup[];
}

export interface SubclassPlugGroup {
  kind: "super" | "ability" | "aspect" | "fragment";
  start: number;
  count: number;
  current: Record<number, number>;
  desired: number[];
  emptyHash?: number;
  clearUnused?: boolean;
}

export interface PlanInput {
  pieces: PlanPiece[];
  /** dim-api `parameters.mods` — every armor mod the loadout wants socketed. */
  modHashes: number[];
  plugInfo: (hash: number) => PlugInfo | undefined;
  /** Explicit socket choices (itemInstanceId → socketIndex → plug hash). */
  placements?: Record<string, Record<number, number>>;
  subclass?: SubclassPlan;
}

interface PieceState {
  piece: PlanPiece;
  /**
   * socket index → plug the plan leaves there: the loadout's mod where one is assigned,
   * otherwise the empty plug for a leftover that gets cleared, otherwise what's there now.
   */
  plugs: Map<number, number | undefined>;
  /** Sockets given a loadout mod by this plan (new or already correct) → its action label. */
  taken: Map<number, string>;
  /** Energy consumed by sockets we don't manage (baseline). */
  baseUsed: number;
}

const GROUP_LABEL: Record<SubclassPlugGroup["kind"], string> = {
  super: "Super", ability: "Ability", aspect: "Aspect", fragment: "Fragment",
};

export function planLoadoutPlugs(input: PlanInput): ApplyPlan {
  const { plugInfo } = input;
  const plugs: PlugAction[] = [];
  const inPlace: PlugAction[] = [];
  const alreadyApplied: string[] = [];
  const skipped: string[] = [];
  const unplaced: UnplacedMod[] = [];
  const cost = (h: number | undefined) => (h === undefined ? 0 : (plugInfo(h)?.cost ?? 0));

  // Every socket starts at the plug it ends with if the loadout doesn't fill it.
  const unfilled = (s: PlanSocket) => (clearsLeftover(s.current, s.empty, cost) ? s.empty : s.current);
  const states = new Map<string, PieceState>();
  for (const piece of input.pieces) {
    states.set(piece.instanceId, {
      piece,
      plugs: new Map(piece.sockets.map((s) => [s.index, unfilled(s)])),
      taken: new Map(),
      baseUsed: baselineEnergy(piece.energy, piece.sockets.map((s) => s.current), cost),
    });
  }

  const energyUsed = (st: PieceState) => {
    let used = st.baseUsed;
    for (const h of st.plugs.values()) used += cost(h);
    return used;
  };
  const capacity = (st: PieceState) => st.piece.energy?.capacity ?? Number.POSITIVE_INFINITY;
  const freeEnergy = (st: PieceState) => capacity(st) - energyUsed(st);

  /** Can `hash` go into this socket now (kind, plug set, tuning roll, energy)? */
  const fits = (st: PieceState, socket: PlanSocket, hash: number, info: PlugInfo) => {
    if (st.taken.has(socket.index)) return false;
    if (socket.kind !== info.kind) return false;
    if (socket.accepts && !socket.accepts.has(hash)) return false;
    if (info.kind === "tuning" && info.tunedPlus !== undefined) {
      if (!(st.piece.tunedStat === info.tunedPlus || st.piece.flexibleTuning)) return false;
    }
    const after = energyUsed(st) - cost(st.plugs.get(socket.index)) + info.cost;
    return after <= capacity(st);
  };

  const place = (st: PieceState, socket: PlanSocket, hash: number, info: PlugInfo) => {
    st.taken.set(socket.index, `${info.name} → ${st.piece.name}`);
    st.plugs.set(socket.index, hash);
  };

  // Mods still to place (multiset, in loadout order).
  const remaining: { hash: number; info: PlugInfo }[] = [];
  for (const hash of input.modHashes) {
    const info = plugInfo(hash);
    if (!info) {
      skipped.push(`Unknown mod #${hash}`);
      unplaced.push({ hash, reason: "unknown mod" });
    } else remaining.push({ hash, info });
  }
  const takeRemaining = (hash: number) => {
    const i = remaining.findIndex((r) => r.hash === hash);
    return i >= 0 ? remaining.splice(i, 1)[0] : undefined;
  };

  // --- Pass 1: explicit placements the user chose in the mod picker.
  for (const [instanceId, sockets] of Object.entries(input.placements ?? {})) {
    const st = states.get(instanceId);
    if (!st) continue;
    for (const [idx, hash] of Object.entries(sockets)) {
      const socket = st.piece.sockets.find((s) => s.index === Number(idx));
      if (!socket) continue;
      const entry = remaining.find((r) => r.hash === hash);
      if (!entry) continue; // placement for a mod the loadout no longer lists
      if (fits(st, socket, hash, entry.info)) {
        takeRemaining(hash);
        place(st, socket, hash, entry.info);
      }
      // Otherwise leave it for auto-placement (which reports a reason if nothing fits).
    }
  }

  // --- Pass 2: lock in mods already sitting in a matching socket, while they still fit
  // (explicit placements may have spent the energy); the rest fall through to pass 3.
  for (const entry of [...remaining]) {
    for (const st of states.values()) {
      const socket = st.piece.sockets.find(
        (s) => s.current === entry.hash && fits(st, s, entry.hash, entry.info),
      );
      if (socket) {
        takeRemaining(entry.hash);
        place(st, socket, entry.hash, entry.info);
        break;
      }
    }
  }

  // --- Pass 3: auto-place the rest, most-constrained first (fewest candidate
  // sockets), then costliest; each onto the piece with the most free energy.
  const candidatesFor = (hash: number, info: PlugInfo) => {
    const out: { st: PieceState; socket: PlanSocket }[] = [];
    for (const st of states.values()) {
      for (const socket of st.piece.sockets) {
        if (fits(st, socket, hash, info)) out.push({ st, socket });
      }
    }
    return out;
  };
  const skipReason = (info: PlugInfo) => {
    switch (info.kind) {
      case "general":
        return "no free mod socket with enough energy — remove other mods first";
      case "tuning":
        return info.tunedPlus === undefined ? "no tunable piece left" : "no piece tuned for that stat";
      case "artifice":
        return "no artifice piece left";
      default:
        return "no socket on this armor takes it (or not enough energy)";
    }
  };
  // Directional tuning is pickier than Balanced (it needs a specific roll), so on a
  // candidate-count tie it goes first and Balanced takes what's left.
  const specificity = (info: PlugInfo) =>
    info.kind === "tuning" && info.tunedPlus !== undefined ? 1 : 0;
  while (remaining.length > 0) {
    const ranked = remaining
      .map((entry) => ({ entry, candidates: candidatesFor(entry.hash, entry.info) }))
      .sort(
        (a, b) =>
          a.candidates.length - b.candidates.length ||
          specificity(b.entry.info) - specificity(a.entry.info) ||
          b.entry.info.cost - a.entry.info.cost,
      );
    const { entry, candidates } = ranked[0];
    takeRemaining(entry.hash);
    if (candidates.length === 0) {
      const reason = skipReason(entry.info);
      skipped.push(`${entry.info.name}: ${reason}`);
      unplaced.push({ hash: entry.hash, reason });
      continue;
    }
    // Tuning: keep flexible exotics for last so a directional lands on its exact roll.
    const flex = (c: { st: PieceState }) =>
      entry.info.kind === "tuning" && c.st.piece.flexibleTuning ? 1 : 0;
    candidates.sort((a, b) => flex(a) - flex(b) || freeEnergy(b.st) - freeEnergy(a.st));
    place(candidates[0].st, candidates[0].socket, entry.hash, entry.info);
  }

  // --- Armor actions: diff each socket's current plug against the plan's. Actions that
  // free energy (clears, cheaper swaps) run before ones that use it, so the piece's live
  // energy only dips from where it starts and then climbs to where it ends — never over.
  const freeing: PlugAction[] = [];
  const using: PlugAction[] = [];
  const assigned: Record<string, Record<number, number>> = {};
  const placement: Record<string, Record<number, number>> = {};
  for (const st of states.values()) {
    const { instanceId, name } = st.piece;
    const row: Record<number, number> = (placement[instanceId] = {});
    for (const socket of st.piece.sockets) {
      const { current } = socket;
      const desired = st.plugs.get(socket.index);
      const label = st.taken.get(socket.index);
      if (desired !== undefined && desired !== socket.empty) row[socket.index] = desired;
      if (label !== undefined && desired !== undefined) (assigned[instanceId] ??= {})[socket.index] = desired;
      if (desired === undefined) continue;
      const action: PlugAction = {
        itemInstanceId: instanceId,
        socketIndex: socket.index,
        plugItemHash: desired,
        label: label ?? `Remove ${plugInfo(current!)?.name ?? `mod #${current}`} → ${name}`,
      };
      if (desired === current) {
        if (label === undefined) continue;
        alreadyApplied.push(label);
        inPlace.push(action);
      } else (cost(desired) <= cost(current) ? freeing : using).push(action);
    }
  }
  plugs.push(...freeing, ...using);

  // --- Fragments: keep ones already socketed; put the rest into sockets holding
  // fragments the loadout doesn't want (or nothing), lowest index first.
  if (input.subclass) {
    const sc = input.subclass;
    for (const group of sc.groups) {
      const desired = [...new Set(group.desired)];
      const indices = Array.from({ length: group.count }, (_, i) => group.start + i);
      const present = new Set(indices.map((i) => group.current[i]).filter(Boolean));
      const free = indices.filter((i) => {
        const cur = group.current[i];
        return !cur || !desired.includes(cur);
      });
      for (const hash of desired) {
        const name = plugInfo(hash)?.name ?? `${GROUP_LABEL[group.kind]} #${hash}`;
        const label = `${name} → subclass`;
        if (present.has(hash)) {
          alreadyApplied.push(label);
          const socketIndex = indices.find((i) => group.current[i] === hash);
          if (socketIndex !== undefined) {
            inPlace.push({ itemInstanceId: sc.instanceId, socketIndex, plugItemHash: hash, label });
          }
          continue;
        }
        const socket = free.shift();
        if (socket === undefined) {
          skipped.push(`${name}: no ${group.kind} socket left`);
          continue;
        }
        plugs.push({
          itemInstanceId: sc.instanceId,
          socketIndex: socket,
          plugItemHash: hash,
          label: `${name} → subclass`,
        });
      }
      // Only clear known live sockets; invisible slots may be locked. Keep desired
      // plugs in their current positions to avoid duplicate-plug failures on swaps.
      if (group.clearUnused && group.emptyHash !== undefined) {
        for (const socketIndex of free) {
          const current = group.current[socketIndex];
          if (!current || current === group.emptyHash) continue;
          plugs.push({ itemInstanceId: sc.instanceId, socketIndex, plugItemHash: group.emptyHash, label: `Clear ${group.kind} → subclass` });
        }
      }
    }
  }

  return { plugs, alreadyApplied, inPlace, skipped, unplaced, placement, assigned };
}
