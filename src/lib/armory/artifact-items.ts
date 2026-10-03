// Artifacts 2.0 (Monument of Triumph): every artifact is an equippable item in the
// artifact slot, and its seven perks are plugs in its sockets — two that take the first
// column's perks, three that also take the second's, two that take any. One more socket
// holds "Reset Artifact" and is left alone. A loadout keeps the artifact as an item ref
// with `socketOverrides` (socket index → perk), the dim-api shape DIM uses too.
//
// Runtime imports are relative so the module runs under vitest.
import type { DestinyProfileResponse } from "bungie-api-ts/destiny2";

export const ARTIFACT_BUCKET = 1506418338;

/** The manifest access this module needs (keeps tests free of a full Manifest). */
export interface ArtifactDefLookup {
  def(
    table: "DestinyInventoryItemDefinition",
    hash: number | undefined | null,
  ):
    | {
        inventory?: { bucketTypeHash?: number };
        sockets?: {
          socketEntries: {
            socketTypeHash?: number;
            singleInitialItemHash: number;
            reusablePlugSetHash?: number;
          }[];
        };
      }
    | undefined;
  def(
    table: "DestinySocketTypeDefinition",
    hash: number | undefined | null,
  ): { plugWhitelist?: { categoryIdentifier: string }[] } | undefined;
  def(
    table: "DestinyPlugSetDefinition",
    hash: number | undefined | null,
  ): { reusablePlugItems: { plugItemHash: number }[] } | undefined;
}

export function isArtifactHash(manifest: ArtifactDefLookup, hash: number): boolean {
  return (
    manifest.def("DestinyInventoryItemDefinition", hash)?.inventory?.bucketTypeHash ===
    ARTIFACT_BUCKET
  );
}

export interface ArtifactPerkSocket {
  index: number;
  /** Perks the socket takes, in plug-set order; the empty plug is left out. */
  options: number[];
  emptyHash: number;
}

/** An artifact's perk sockets, from its definition (the reset socket is left out). */
export function artifactPerkSockets(
  manifest: ArtifactDefLookup,
  itemHash: number,
): ArtifactPerkSocket[] {
  const entries =
    manifest.def("DestinyInventoryItemDefinition", itemHash)?.sockets?.socketEntries ?? [];
  const out: ArtifactPerkSocket[] = [];
  entries.forEach((entry, index) => {
    const whitelist =
      manifest.def("DestinySocketTypeDefinition", entry.socketTypeHash)?.plugWhitelist ?? [];
    const kinds = whitelist.map((w) => w.categoryIdentifier);
    if (!kinds.includes("artifact_perks") || kinds.includes("artifact_reset")) return;
    const plugs =
      manifest.def("DestinyPlugSetDefinition", entry.reusablePlugSetHash)?.reusablePlugItems ?? [];
    out.push({
      index,
      options: plugs.map((p) => p.plugItemHash).filter((h) => h !== entry.singleInitialItemHash),
      emptyHash: entry.singleInitialItemHash,
    });
  });
  return out;
}

/**
 * The perks in columns, as the game shows them: each new socket pool adds a column of
 * the perks it takes that earlier pools don't.
 */
export function artifactPerkColumns(sockets: readonly ArtifactPerkSocket[]): number[][] {
  const seen = new Set<number>();
  const columns: number[][] = [];
  for (const socket of sockets) {
    const fresh = socket.options.filter((h) => !seen.has(h));
    if (fresh.length === 0) continue;
    for (const h of fresh) seen.add(h);
    columns.push(fresh);
  }
  return columns;
}

/**
 * Put each picked perk in a socket that takes it, or null when they can't all fit (too
 * many from a later column). Perks already in a socket that takes them stay put when
 * that still leaves room for the rest, so applying moves as little as possible.
 *
 * The pools nest (a later socket takes everything an earlier one does), so placing the
 * most constrained perk first, into the narrowest free socket, always finds a fit when
 * one exists.
 */
export function assignArtifactPerks(
  sockets: readonly ArtifactPerkSocket[],
  picks: readonly number[],
  current: Readonly<Record<number, number>> = {},
): Record<number, number> | null {
  const place = (keep: boolean): Record<number, number> | null => {
    const out: Record<number, number> = {};
    const free = new Set(sockets.map((s) => s.index));
    let rest = [...new Set(picks)];
    if (keep) {
      for (const s of sockets) {
        const hash = current[s.index];
        if (hash !== undefined && rest.includes(hash) && s.options.includes(hash)) {
          out[s.index] = hash;
          free.delete(s.index);
          rest = rest.filter((h) => h !== hash);
        }
      }
    }
    const fits = (hash: number) => sockets.filter((s) => free.has(s.index) && s.options.includes(hash));
    rest.sort((a, b) => fits(a).length - fits(b).length);
    for (const hash of rest) {
      const [target] = fits(hash).sort((a, b) => a.options.length - b.options.length);
      if (!target) return null;
      out[target.index] = hash;
      free.delete(target.index);
    }
    return out;
  };
  return place(true) ?? place(false);
}

/** One artifact a character owns. */
export interface OwnedArtifact {
  instanceId: string;
  itemHash: number;
  equipped: boolean;
  /** Live perk per perk-socket index; empty sockets are absent. */
  perks: Record<number, number>;
  /**
   * Perks the player can't socket yet (component 310 says so). Absent when Bungie sent
   * no plug data for the artifact.
   */
  locked?: number[];
}

/** The character's artifacts (equipped first), with their live perks. */
export function artifactsForCharacter(
  profile: DestinyProfileResponse,
  characterId: string,
  manifest: ArtifactDefLookup,
): OwnedArtifact[] {
  const out: OwnedArtifact[] = [];
  const collect = (
    items: { itemHash: number; itemInstanceId?: string; bucketHash: number }[] | undefined,
    equipped: boolean,
  ) => {
    for (const item of items ?? []) {
      if (item.bucketHash !== ARTIFACT_BUCKET || !item.itemInstanceId) continue;
      if (!isArtifactHash(manifest, item.itemHash)) continue;
      const live = profile.itemComponents?.sockets?.data?.[item.itemInstanceId]?.sockets ?? [];
      const reusable = profile.itemComponents?.reusablePlugs?.data?.[item.itemInstanceId]?.plugs;
      const perks: Record<number, number> = {};
      const locked = new Set<number>();
      for (const socket of artifactPerkSockets(manifest, item.itemHash)) {
        const plug = live[socket.index]?.plugHash;
        if (plug && plug !== socket.emptyHash) perks[socket.index] = plug;
        for (const p of reusable?.[socket.index] ?? []) {
          if (!p.canInsert || !p.enabled) locked.add(p.plugItemHash);
        }
      }
      // A perk one socket can't take may still go in another; locked means none can.
      // One already socketed isn't locked either (`canInsert` can be false elsewhere
      // just because a perk can't sit in two sockets).
      for (const plugs of Object.values(reusable ?? {})) {
        for (const p of plugs) if (p.canInsert && p.enabled) locked.delete(p.plugItemHash);
      }
      for (const hash of Object.values(perks)) locked.delete(hash);
      out.push({
        instanceId: item.itemInstanceId,
        itemHash: item.itemHash,
        equipped,
        perks,
        ...(reusable ? { locked: [...locked] } : {}),
      });
    }
  };
  collect(profile.characterEquipment?.data?.[characterId]?.items, true);
  collect(profile.characterInventories?.data?.[characterId]?.items, false);
  return out;
}

export interface ArtifactPlugStep {
  socketIndex: number;
  plugItemHash: number;
  /** True for an empty plug that frees a perk so it can move to another socket. */
  clear?: boolean;
}

/**
 * The socket inserts that turn `current` into `target`: first empty every socket whose
 * perk is wanted in a different one (a perk can't sit in two sockets), then insert.
 * Sockets the target leaves unset keep whatever they hold.
 */
export function planArtifactPlugs(
  sockets: readonly ArtifactPerkSocket[],
  target: Readonly<Record<number, number>>,
  current: Readonly<Record<number, number>>,
): { steps: ArtifactPlugStep[]; inPlace: ArtifactPlugStep[] } {
  const wanted = new Set(Object.values(target));
  const steps: ArtifactPlugStep[] = [];
  const inPlace: ArtifactPlugStep[] = [];
  for (const s of sockets) {
    const now = current[s.index];
    if (now !== undefined && now !== target[s.index] && wanted.has(now)) {
      steps.push({ socketIndex: s.index, plugItemHash: s.emptyHash, clear: true });
    }
  }
  for (const s of sockets) {
    const hash = target[s.index];
    if (hash === undefined) continue;
    if (current[s.index] === hash) inPlace.push({ socketIndex: s.index, plugItemHash: hash });
    else steps.push({ socketIndex: s.index, plugItemHash: hash });
  }
  return { steps, inPlace };
}
