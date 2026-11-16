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
import type { DestinyItemSocketState } from "bungie-api-ts/destiny2";
import { planArtifactPlugs, type ArtifactPerkSocket } from "../armory/artifact-items";
import { visiblePlug } from "../armory/equipped-subclass";
import type { PlugRequest } from "../bungie/equip-server";
import { baselineEnergy, clearsLeftover } from "./energy";
import {
  diffArmorSockets,
  planSubclassGroups,
  type ApplyPlan,
  type PlanPiece,
  type PlugInfo,
  type SocketChange,
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

/** One socket as Bungie reports it. */
export type LiveSocket = Partial<Pick<DestinyItemSocketState, "plugHash" | "isVisible" | "isEnabled">>;

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
  /** Target plugs already in their live sockets. */
  inPlace: PlugRequest[];
  /**
   * Items planned from the client's copy because Bungie didn't return them. Their plugs
   * that copy shows in place are sent anyway: only Bungie's answer can confirm them.
   */
  fromSnapshot: string[];
  /** Armor pieces whose target needs more energy than the piece has. */
  overEnergy: string[];
}

/** One item's part of the plan. Everything in `freeing` runs before anything in `using`. */
interface ItemPlan {
  freeing: PlannedPlug[];
  using: PlannedPlug[];
  inPlace: PlugRequest[];
  overEnergy?: boolean;
}

type Cost = (hash: number | undefined) => number;

const planned = (
  itemInstanceId: string,
  socketIndex: number,
  plugItemHash: number,
  current: number | undefined,
  clear: boolean,
): PlannedPlug => ({
  itemInstanceId,
  socketIndex,
  plugItemHash,
  ...(current !== undefined ? { current } : {}),
  ...(clear ? { clear: true as const } : {}),
});

/** What the client's copy shows, as if Bungie had returned it (no energy: not known). */
function snapshotItem(target: ItemTarget): LiveItem {
  const sockets: LiveSocket[] = [];
  if (target.kind === "subclass") {
    for (const g of target.groups) {
      for (const [i, plugHash] of Object.entries(g.current ?? {})) sockets[Number(i)] = { plugHash };
    }
  } else {
    for (const s of target.sockets) if (s.current !== undefined) sockets[s.index] = { plugHash: s.current };
  }
  return { sockets };
}

function planArmor(target: ArmorTarget, item: LiveItem, cost: Cost): ItemPlan {
  const id = target.itemInstanceId;
  const states = target.sockets.map((s) => {
    const current = item.sockets[s.index]?.plugHash || undefined;
    const desired = s.plug ?? (clearsLeftover(current, s.empty, cost) ? s.empty : current);
    return { index: s.index, current, desired, assigned: s.plug !== undefined };
  });
  const changes = diffArmorSockets(states, cost);
  const send = (c: SocketChange) =>
    planned(id, c.index, c.desired, c.current, !states.find((s) => s.index === c.index)?.assigned);
  let overEnergy = false;
  if (item.energy) {
    const base = baselineEnergy(item.energy, states.map((s) => s.current), cost);
    overEnergy = states.reduce((n, s) => n + cost(s.desired), base) > item.energy.capacity;
  }
  return {
    freeing: changes.freeing.map(send),
    using: changes.using.map(send),
    inPlace: changes.inPlace.map((c) => ({ itemInstanceId: id, socketIndex: c.index, plugItemHash: c.desired })),
    overEnergy,
  };
}

function planSubclass(target: SubclassTarget, item: LiveItem): ItemPlan {
  const id = target.itemInstanceId;
  const groups = target.groups.map((g) => {
    const current: Record<number, number> = {};
    for (let i = g.start; i < g.start + g.count; i++) {
      const plug = visiblePlug(item.sockets[i]);
      if (plug) current[i] = plug;
    }
    return { ...g, current };
  });
  const empties = new Set(groups.flatMap((g) => (g.emptyHash !== undefined ? [g.emptyHash] : [])));
  const currentAt = (i: number) => visiblePlug(item.sockets[i]);
  // Labels are the client's job; the server only needs the sockets.
  const sc = planSubclassGroups({ instanceId: id, groups }, () => undefined);
  return {
    freeing: [],
    // In the group order the planner chose: abilities and aspects before fragments.
    using: sc.plugs.map((p) =>
      planned(id, p.socketIndex, p.plugItemHash, currentAt(p.socketIndex), empties.has(p.plugItemHash)),
    ),
    inPlace: sc.inPlace.map(({ socketIndex, plugItemHash }) => ({ itemInstanceId: id, socketIndex, plugItemHash })),
  };
}

function planArtifact(target: ArtifactTarget, item: LiveItem): ItemPlan {
  const id = target.itemInstanceId;
  const sockets: ArtifactPerkSocket[] = target.sockets.map((s) => ({ index: s.index, options: [], emptyHash: s.empty }));
  const want: Record<number, number> = {};
  // Any perk counts, whatever its visibility: the client's rule (`artifactsForCharacter`).
  const current: Record<number, number> = {};
  for (const s of target.sockets) {
    if (s.plug !== undefined) want[s.index] = s.plug;
    const now = item.sockets[s.index]?.plugHash;
    if (now && now !== s.empty) current[s.index] = now;
  }
  const { steps, inPlace } = planArtifactPlugs(sockets, want, current);
  return {
    freeing: [],
    // Frees first, then inserts, as planArtifactPlugs ordered them.
    using: steps.map((s) => planned(id, s.socketIndex, s.plugItemHash, current[s.socketIndex], !!s.clear)),
    inPlace: inPlace.map(({ socketIndex, plugItemHash }) => ({ itemInstanceId: id, socketIndex, plugItemHash })),
  };
}

/**
 * The inserts that bring every target item to its target, from each item's live sockets
 * (`live` returns undefined for an item Bungie didn't return: it is planned from the
 * client's copy instead). Every piece's energy-freeing inserts run before any that use
 * energy, then the rest in item order (armor, subclass, artifact): the order the client
 * planner used.
 */
export function planFromLive(
  targets: ApplyTargets,
  live: (itemInstanceId: string) => LiveItem | undefined,
): LivePlan {
  const cost: Cost = (h) => (h === undefined ? 0 : (targets.costs[h] ?? 0));
  const out: LivePlan & { using: PlannedPlug[] } = { plugs: [], using: [], inPlace: [], fromSnapshot: [], overEnergy: [] };
  for (const target of targets.items) {
    const read = live(target.itemInstanceId);
    const item = read ?? snapshotItem(target);
    const plan =
      target.kind === "armor"
        ? planArmor(target, item, cost)
        : target.kind === "subclass"
          ? planSubclass(target, item)
          : planArtifact(target, item);
    out.plugs.push(...plan.freeing);
    out.using.push(...plan.using);
    if (plan.overEnergy) out.overEnergy.push(target.itemInstanceId);
    if (read) out.inPlace.push(...plan.inPlace);
    else {
      out.fromSnapshot.push(target.itemInstanceId);
      out.using.push(...plan.inPlace);
    }
  }
  const { using, ...plan } = out;
  return { ...plan, plugs: [...plan.plugs, ...using] };
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
