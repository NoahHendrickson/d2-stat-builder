// Plan the socket-plug half of applying a loadout: which mod / tuning / artifice /
// fragment plug goes into which socket of which item. Pure and unit-tested; the
// caller feeds it live piece data (sockets, energy, current plugs) and manifest-derived
// plug facts, and hands the resulting actions to the server route.
//
// Works from the dim-api flat `parameters.mods` list (the loadout's source of truth)
// plus the user's optional socket-by-socket `modPlacement`: explicit placements are
// honored first, everything left is auto-placed. So it applies equally to loadouts
// saved from the builder, edited in the mod picker, and imported.
// Runtime imports are relative so the module runs under vitest.
import type { ArmorSocketKind } from "../armory/stats";
import { baselineEnergy } from "./energy";

export interface PlanSocket {
  index: number;
  kind: ArmorSocketKind;
  /** Currently socketed plug. */
  current?: number;
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
  /** Plugs that couldn't be placed, with the reason. */
  skipped: string[];
  /**
   * The `modHashes` entries behind `skipped` (multiset, loadout order). Editors that
   * rebuild `parameters.mods` from `assigned` must append these so a mod that merely
   * doesn't fit the player's CURRENT armor isn't silently dropped from the loadout.
   */
  unplaced: number[];
  /** Final plug per (piece, socket) the plan arrives at — for previews. */
  placement: Record<string, Record<number, number>>;
  /** Only the sockets this plan assigned a loadout mod to (new or already correct). */
  assigned: Record<string, Record<number, number>>;
}

export interface SubclassPlan {
  instanceId: string;
  /** Current plug hash per fragment socket index. */
  fragmentSockets: Record<number, number>;
  socketStart: number;
  socketCount: number;
  desiredFragments: number[];
  /** Abilities (Super first), then aspects, then fragments. Absent for legacy fragment-only callers. */
  groups?: SubclassPlugGroup[];
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
  /** socket index → plug the plan will leave there (current until changed). */
  plugs: Map<number, number | undefined>;
  /** Sockets already given a plug by this plan (or locked as already correct). */
  taken: Set<number>;
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
  const unplaced: number[] = [];
  const cost = (h: number | undefined) => (h === undefined ? 0 : (plugInfo(h)?.cost ?? 0));

  const states = new Map<string, PieceState>();
  for (const piece of input.pieces) {
    const plugsMap = new Map<number, number | undefined>();
    for (const s of piece.sockets) plugsMap.set(s.index, s.current);
    states.set(piece.instanceId, {
      piece,
      plugs: plugsMap,
      taken: new Set(),
      baseUsed: baselineEnergy(piece.energy, plugsMap.values(), cost),
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

  const assigned: Record<string, Record<number, number>> = {};
  const place = (st: PieceState, socket: PlanSocket, hash: number, info: PlugInfo) => {
    const label = `${info.name} → ${st.piece.name}`;
    const action = { itemInstanceId: st.piece.instanceId, socketIndex: socket.index, plugItemHash: hash, label };
    st.taken.add(socket.index);
    (assigned[st.piece.instanceId] ??= {})[socket.index] = hash;
    if (st.plugs.get(socket.index) === hash) {
      alreadyApplied.push(label);
      inPlace.push(action);
      return;
    }
    st.plugs.set(socket.index, hash);
    plugs.push(action);
  };

  // Mods still to place (multiset, in loadout order).
  const remaining: { hash: number; info: PlugInfo }[] = [];
  for (const hash of input.modHashes) {
    const info = plugInfo(hash);
    if (!info) {
      skipped.push(`Unknown mod #${hash}`);
      unplaced.push(hash);
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

  // --- Pass 2: lock in mods already sitting in a matching socket.
  for (const entry of [...remaining]) {
    for (const st of states.values()) {
      const socket = st.piece.sockets.find(
        (s) => !st.taken.has(s.index) && s.current === entry.hash && s.kind === entry.info.kind,
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
      skipped.push(`${entry.info.name}: ${skipReason(entry.info)}`);
      unplaced.push(entry.hash);
      continue;
    }
    // Tuning: keep flexible exotics for last so a directional lands on its exact roll.
    const flex = (c: { st: PieceState }) =>
      entry.info.kind === "tuning" && c.st.piece.flexibleTuning ? 1 : 0;
    candidates.sort((a, b) => flex(a) - flex(b) || freeEnergy(b.st) - freeEnergy(a.st));
    place(candidates[0].st, candidates[0].socket, entry.hash, entry.info);
  }

  // --- Fragments: keep ones already socketed; put the rest into sockets holding
  // fragments the loadout doesn't want (or nothing), lowest index first.
  if (input.subclass) {
    const sc = input.subclass;
    const groups = sc.groups ?? [{ kind: "fragment" as const, start: sc.socketStart, count: sc.socketCount, current: sc.fragmentSockets, desired: sc.desiredFragments }];
    for (const group of groups) {
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

  const placement: Record<string, Record<number, number>> = {};
  for (const st of states.values()) {
    const row: Record<number, number> = {};
    for (const [idx, hash] of st.plugs) if (hash !== undefined) row[idx] = hash;
    placement[st.piece.instanceId] = row;
  }

  return { plugs, alreadyApplied, inPlace, skipped, unplaced, placement, assigned };
}
