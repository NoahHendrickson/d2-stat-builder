// The socket half of the apply-loadout contract. The client sends the state each item
// should END in (its targets); the route reads every targeted item's live sockets right
// before inserting and works out the inserts from those (`planFromLive`).
//
// The client used to send the inserts themselves, diffed against the profile the page
// held, which can be minutes old. A socket that profile showed as already right was
// never sent, and a mod really on the armor but missing from it was never removed, so
// its energy blocked inserts that should have fit (NoahHendrickson/d2-conflux-feedback#9).
//
// The client still decides WHERE each mod goes (`planLoadoutPlugs` needs the manifest);
// the server only diffs and orders, with the same helpers the client planner uses.
// Runtime imports are relative so the module runs under vitest.
import { planArtifactPlugs, type ArtifactPerkSocket } from "../armory/artifact-items";
import type { PlugRequest } from "../bungie/equip-server";
import { baselineEnergy, clearsLeftover } from "./energy";
import {
  diffArmorSockets,
  planSubclassGroups,
  type ApplyPlan,
  type PlanPiece,
  type PlugInfo,
  type SubclassPlugGroup,
} from "./apply-plan";
import type { ArtifactApplyPlan } from "./artifact-apply";

export interface ArmorSocketTarget {
  index: number;
  /** The loadout's plug for this socket. Absent: the loadout leaves the socket unfilled. */
  plug?: number;
  /**
   * The socket's empty plug. An unfilled socket that holds a plug costing energy is reset
   * to it (see `clearsLeftover`); without one the socket is left alone.
   */
  empty?: number;
  /** The plug the client's copy of the profile shows. Used only when the live read fails. */
  current?: number;
}

export interface ArmorTarget {
  kind: "armor";
  itemInstanceId: string;
  /** Every mod socket the planner manages on the piece. */
  sockets: ArmorSocketTarget[];
}

/** A subclass socket group: which plugs it should hold, wherever they sit in the group. */
export interface SubclassGroupTarget extends Omit<SubclassPlugGroup, "current"> {
  /** The client's copy of the group's plugs. Used only when the live read fails. */
  current?: Record<number, number>;
}

export interface SubclassTarget {
  kind: "subclass";
  itemInstanceId: string;
  groups: SubclassGroupTarget[];
}

export interface ArtifactSocketTarget {
  index: number;
  empty: number;
  /** The perk the socket should end with. Absent: it keeps what it holds (unless that perk moves). */
  plug?: number;
  /** The client's copy of the socket's perk. Used only when the live read fails. */
  current?: number;
}

export interface ArtifactTarget {
  kind: "artifact";
  itemInstanceId: string;
  /** Every perk socket on the artifact. */
  sockets: ArtifactSocketTarget[];
}

export type ItemTarget = ArmorTarget | SubclassTarget | ArtifactTarget;

export interface ApplyTargets {
  /** Armor first, then the subclass, then the artifact: the order the inserts run in. */
  items: ItemTarget[];
  /**
   * Armor energy per plug hash, for every plug with a cost that a targeted armor socket
   * can hold. The server has no manifest, and it needs these to clear a leftover it only
   * finds on the live piece and to run inserts that free energy first. Absent = free.
   */
  costs: Record<number, number>;
}

/** One socket as Bungie reports it (DestinyItemSocketState). */
export interface LiveSocket {
  plugHash?: number;
  isVisible?: boolean;
  isEnabled?: boolean;
}

/** One item as read from Bungie right before inserting. */
export interface LiveItem {
  sockets: LiveSocket[];
  energy?: { capacity: number; used: number };
}

/** An insert the server will make, with what the socket holds before it. */
export interface PlannedPlug extends PlugRequest {
  current?: number;
  /** The insert empties the socket: a leftover mod is removed, or a perk is freed to move. */
  clear?: true;
}

export interface LivePlan {
  /** In the order they run. */
  plugs: PlannedPlug[];
  /** Target plugs already in their sockets. */
  inPlace: PlugRequest[];
  /** Items planned from the client's copy because Bungie didn't return them. */
  fromSnapshot: string[];
  /** Armor pieces whose target needs more energy than the piece has. */
  overEnergy: string[];
}

/** A live plug, or undefined for an empty / hidden / locked socket (equipped-subclass's rule). */
function livePlug(socket: LiveSocket | undefined): number | undefined {
  if (!socket?.plugHash || socket.isVisible === false || socket.isEnabled === false) return undefined;
  return socket.plugHash;
}

/**
 * The inserts that bring every target item to its target, from each item's live sockets
 * (`live` returns undefined for an item Bungie didn't return: that item falls back to the
 * client's copy). Armor runs every piece's energy-freeing inserts before any that use
 * energy, then the subclass, then the artifact, the same order the client planner used.
 */
export function planFromLive(
  targets: ApplyTargets,
  live: (itemInstanceId: string) => LiveItem | undefined,
): LivePlan {
  const cost = (h: number | undefined) => (h === undefined ? 0 : (targets.costs[h] ?? 0));
  const freeing: PlannedPlug[] = [];
  const using: PlannedPlug[] = [];
  const rest: PlannedPlug[] = [];
  const inPlace: PlugRequest[] = [];
  const fromSnapshot: string[] = [];
  const overEnergy: string[] = [];

  for (const target of targets.items) {
    const itemInstanceId = target.itemInstanceId;
    const item = live(itemInstanceId);
    if (!item) fromSnapshot.push(itemInstanceId);
    const request = (socketIndex: number, plugItemHash: number): PlugRequest => ({
      itemInstanceId,
      socketIndex,
      plugItemHash,
    });

    if (target.kind === "armor") {
      const currentOf = (s: ArmorSocketTarget) =>
        item ? item.sockets[s.index]?.plugHash || undefined : s.current;
      const states = target.sockets.map((s) => {
        const current = currentOf(s);
        const desired = s.plug ?? (clearsLeftover(current, s.empty, cost) ? s.empty : current);
        return { index: s.index, current, desired, assigned: s.plug !== undefined };
      });
      const changes = diffArmorSockets(states, cost);
      const planned = (c: { index: number; current?: number; desired: number }): PlannedPlug => {
        const clear = target.sockets.find((s) => s.index === c.index)?.plug === undefined;
        return {
          ...request(c.index, c.desired),
          ...(c.current !== undefined ? { current: c.current } : {}),
          ...(clear ? { clear: true as const } : {}),
        };
      };
      freeing.push(...changes.freeing.map(planned));
      using.push(...changes.using.map(planned));
      inPlace.push(...changes.inPlace.map((c) => request(c.index, c.desired)));
      if (item?.energy) {
        const base = baselineEnergy(item.energy, states.map((s) => s.current), cost);
        const after = states.reduce((n, s) => n + cost(s.desired), base);
        if (after > item.energy.capacity) overEnergy.push(itemInstanceId);
      }
    } else if (target.kind === "subclass") {
      const groups = target.groups.map((g) => {
        const current: Record<number, number> = {};
        if (item) {
          for (let i = g.start; i < g.start + g.count; i++) {
            const plug = livePlug(item.sockets[i]);
            if (plug) current[i] = plug;
          }
        }
        return { ...g, current: item ? current : (g.current ?? {}) };
      });
      const empties = new Set(groups.flatMap((g) => (g.emptyHash !== undefined ? [g.emptyHash] : [])));
      const currentAt = (i: number) => groups.find((g) => i >= g.start && i < g.start + g.count)?.current[i];
      // Labels are the client's job; the server only needs the sockets.
      const sc = planSubclassGroups({ instanceId: itemInstanceId, groups }, () => undefined);
      for (const p of sc.plugs) {
        const current = currentAt(p.socketIndex);
        rest.push({
          ...request(p.socketIndex, p.plugItemHash),
          ...(current !== undefined ? { current } : {}),
          ...(empties.has(p.plugItemHash) ? { clear: true as const } : {}),
        });
      }
      inPlace.push(...sc.inPlace.map((p) => request(p.socketIndex, p.plugItemHash)));
    } else {
      const sockets: ArtifactPerkSocket[] = target.sockets.map((s) => ({
        index: s.index,
        options: [],
        emptyHash: s.empty,
      }));
      const want: Record<number, number> = {};
      const current: Record<number, number> = {};
      for (const s of target.sockets) {
        if (s.plug !== undefined) want[s.index] = s.plug;
        const now = item ? livePlug(item.sockets[s.index]) : s.current;
        if (now !== undefined && now !== s.empty) current[s.index] = now;
      }
      const { steps, inPlace: here } = planArtifactPlugs(sockets, want, current);
      for (const s of steps) {
        const now = current[s.socketIndex];
        rest.push({
          ...request(s.socketIndex, s.plugItemHash),
          ...(now !== undefined ? { current: now } : {}),
          ...(s.clear ? { clear: true as const } : {}),
        });
      }
      inPlace.push(...here.map((s) => request(s.socketIndex, s.plugItemHash)));
    }
  }

  return { plugs: [...freeing, ...using, ...rest], inPlace, fromSnapshot, overEnergy };
}

/**
 * The armor half of the targets, from the client planner's result: each managed socket
 * gets the loadout mod the plan assigned it, or nothing (unfilled).
 */
export function armorTargets(pieces: readonly PlanPiece[], plan: Pick<ApplyPlan, "assigned">): ArmorTarget[] {
  return pieces
    .filter((p) => p.sockets.length > 0)
    .map((p) => ({
      kind: "armor",
      itemInstanceId: p.instanceId,
      sockets: p.sockets.map((s) => {
        const plug = plan.assigned[p.instanceId]?.[s.index];
        return {
          index: s.index,
          ...(plug !== undefined ? { plug } : {}),
          ...(s.empty !== undefined ? { empty: s.empty } : {}),
          ...(s.current !== undefined ? { current: s.current } : {}),
        };
      }),
    }));
}

/**
 * Energy costs for `ApplyTargets.costs`: every plug with a cost that the pieces' managed
 * sockets hold now, are given, or accept — so a mod the client's copy doesn't show is
 * still priced when the server meets it on the live piece.
 */
export function plugCosts(
  pieces: readonly PlanPiece[],
  targets: readonly ArmorTarget[],
  plugInfo: (hash: number) => Pick<PlugInfo, "cost"> | undefined,
): Record<number, number> {
  const out: Record<number, number> = {};
  const add = (h: number | undefined) => {
    if (h === undefined || h in out) return;
    const c = plugInfo(h)?.cost ?? 0;
    if (c > 0) out[h] = c;
  };
  for (const p of pieces) {
    for (const s of p.sockets) {
      add(s.current);
      for (const h of s.accepts ?? []) add(h);
    }
  }
  for (const t of targets) for (const s of t.sockets) add(s.plug);
  return out;
}

/** The artifact target, from the client's artifact plan (none when it can't be planned). */
export function artifactTarget(plan: ArtifactApplyPlan | undefined): ArtifactTarget | undefined {
  if (!plan?.item || !plan.sockets || !plan.target) return undefined;
  const { item, target } = plan;
  return {
    kind: "artifact",
    itemInstanceId: item.instanceId,
    sockets: plan.sockets.map((s) => ({
      index: s.index,
      empty: s.emptyHash,
      ...(target[s.index] !== undefined ? { plug: target[s.index] } : {}),
      ...(item.perks[s.index] !== undefined ? { current: item.perks[s.index] } : {}),
    })),
  };
}
