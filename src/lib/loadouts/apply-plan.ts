// Plan the socket-plug half of applying a loadout: which mod / tuning / artifice /
// fragment plug goes into which socket of which item. Pure and unit-tested; the
// caller feeds it live piece data (sockets, energy, current plugs) and manifest-derived
// plug facts, and hands the resulting actions to the server route.
//
// Works from the dim-api flat `parameters.mods` list (the loadout's source of truth),
// so it applies equally to loadouts saved from the builder and to imported ones.
// Runtime imports are relative so the module runs under vitest.
import type { ArmorModSockets } from "../armory/normalize";

export interface PlanPiece {
  instanceId: string;
  name: string;
  /** Socket indices for the general / tuning / artifice mod sockets, when present. */
  modSockets?: ArmorModSockets;
  /** Current plug hash per socket index (live sockets). */
  socketPlugs?: Record<number, number>;
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
  /** Plugs that couldn't be placed, with the reason. */
  skipped: string[];
}

export interface SubclassPlan {
  instanceId: string;
  /** Current plug hash per fragment socket index. */
  fragmentSockets: Record<number, number>;
  socketStart: number;
  socketCount: number;
  desiredFragments: number[];
}

export interface PlanInput {
  pieces: PlanPiece[];
  /** dim-api `parameters.mods` — general stat mods, tuning plugs, artifice mods. */
  modHashes: number[];
  plugInfo: (hash: number) => PlugInfo | undefined;
  subclass?: SubclassPlan;
}

function freeEnergy(piece: PlanPiece, socket: number, cost: (h: number) => number): number {
  if (!piece.energy) return Number.POSITIVE_INFINITY; // unknown → let Bungie decide
  const current = piece.socketPlugs?.[socket];
  return piece.energy.capacity - piece.energy.used + (current ? cost(current) : 0);
}

export function planLoadoutPlugs(input: PlanInput): ApplyPlan {
  const { pieces, plugInfo } = input;
  const plugs: PlugAction[] = [];
  const alreadyApplied: string[] = [];
  const skipped: string[] = [];
  const cost = (h: number) => plugInfo(h)?.cost ?? 0;

  const place = (piece: PlanPiece, socket: number, hash: number, name: string) => {
    const label = `${name} → ${piece.name}`;
    if (piece.socketPlugs?.[socket] === hash) alreadyApplied.push(label);
    else plugs.push({ itemInstanceId: piece.instanceId, socketIndex: socket, plugItemHash: hash, label });
  };

  const general: { hash: number; info: PlugInfo }[] = [];
  const directional: { hash: number; info: PlugInfo }[] = [];
  const balanced: { hash: number; info: PlugInfo }[] = [];
  const artifice: { hash: number; info: PlugInfo }[] = [];
  for (const hash of input.modHashes) {
    const info = plugInfo(hash);
    if (!info) {
      skipped.push(`Unknown mod #${hash}`);
      continue;
    }
    if (info.kind === "general") general.push({ hash, info });
    else if (info.kind === "tuning") (info.tunedPlus === undefined ? balanced : directional).push({ hash, info });
    else if (info.kind === "artifice") artifice.push({ hash, info });
    else skipped.push(`${info.name}: not an armor mod this app can apply`);
  }

  // --- General stat mods: one per piece, costliest first, onto the piece with the most
  // free energy (preferring a piece that already has that exact mod).
  const usedGeneral = new Set<string>();
  general.sort((a, b) => b.info.cost - a.info.cost);
  for (const { hash, info } of general) {
    const candidates = pieces.filter(
      (p) => p.modSockets?.general !== undefined && !usedGeneral.has(p.instanceId),
    );
    const already = candidates.find((p) => p.socketPlugs?.[p.modSockets!.general!] === hash);
    const fits = candidates
      .filter((p) => freeEnergy(p, p.modSockets!.general!, cost) >= info.cost)
      .sort(
        (a, b) =>
          freeEnergy(b, b.modSockets!.general!, cost) - freeEnergy(a, a.modSockets!.general!, cost),
      );
    const target = already ?? fits[0];
    if (!target) {
      skipped.push(
        candidates.length === 0
          ? `${info.name}: no free mod socket`
          : `${info.name}: not enough armor energy — remove other mods first`,
      );
      continue;
    }
    usedGeneral.add(target.instanceId);
    place(target, target.modSockets!.general!, hash, info.name);
  }

  // --- Tuning: directional plugs need a piece whose rolled tuned stat matches (exotics
  // are flexible); Balanced goes on any remaining tunable piece.
  const usedTuning = new Set<string>();
  const tunable = () =>
    pieces.filter((p) => p.modSockets?.tuning !== undefined && !usedTuning.has(p.instanceId));
  for (const { hash, info } of directional) {
    const exact = tunable().find((p) => p.tunedStat === info.tunedPlus && !p.flexibleTuning);
    const target = exact ?? tunable().find((p) => p.flexibleTuning);
    if (!target) {
      skipped.push(`${info.name}: no piece tuned for that stat`);
      continue;
    }
    usedTuning.add(target.instanceId);
    place(target, target.modSockets!.tuning!, hash, info.name);
  }
  for (const { hash, info } of balanced) {
    const target = tunable()[0];
    if (!target) {
      skipped.push(`${info.name}: no tunable piece left`);
      continue;
    }
    usedTuning.add(target.instanceId);
    place(target, target.modSockets!.tuning!, hash, info.name);
  }

  // --- Artifice: one +3 per artifice piece.
  const usedArtifice = new Set<string>();
  for (const { hash, info } of artifice) {
    const target = pieces.find(
      (p) => p.modSockets?.artifice !== undefined && !usedArtifice.has(p.instanceId),
    );
    if (!target) {
      skipped.push(`${info.name}: no artifice piece left`);
      continue;
    }
    usedArtifice.add(target.instanceId);
    place(target, target.modSockets!.artifice!, hash, info.name);
  }

  // --- Fragments: keep ones already socketed; put the rest into sockets holding
  // fragments the loadout doesn't want (or nothing), lowest index first.
  if (input.subclass) {
    const sc = input.subclass;
    const desired = [...new Set(sc.desiredFragments)];
    const indices = Array.from({ length: sc.socketCount }, (_, i) => sc.socketStart + i);
    const present = new Set(indices.map((i) => sc.fragmentSockets[i]).filter(Boolean));
    const free = indices.filter((i) => {
      const cur = sc.fragmentSockets[i];
      return !cur || !desired.includes(cur);
    });
    for (const hash of desired) {
      const name = plugInfo(hash)?.name ?? `Fragment #${hash}`;
      if (present.has(hash)) {
        alreadyApplied.push(`${name} → subclass`);
        continue;
      }
      const socket = free.shift();
      if (socket === undefined) {
        skipped.push(`${name}: no fragment socket left`);
        continue;
      }
      plugs.push({
        itemInstanceId: sc.instanceId,
        socketIndex: socket,
        plugItemHash: hash,
        label: `${name} → subclass`,
      });
    }
  }

  return { plugs, alreadyApplied, skipped };
}
