import type {
  DestinyColor,
  DestinyProfileResponse,
} from "bungie-api-ts/destiny2";
import { takeEarlyResponse } from "@/lib/early-fetch";
import { HELD_PROFILE_HEADER, encodeHeldProfile, isNewerMint } from "./profile-mint";
import type { Manifest } from "@/lib/manifest/load";
import {
  equippedSubclassForCharacter,
  subclassItemsForCharacter,
  type EquippedSubclass,
  type SubclassItem,
} from "./equipped-subclass";
import { abilitySockets } from "@/lib/loadouts/subclass";
import { normalizeArmory, type ArmorPiece } from "./normalize";
import { normalizeWeapons, type LoadoutWeapon } from "./weapons";
import { artifactUnlocksForCharacter } from "./artifact";
import { artifactsForCharacter, type OwnedArtifact } from "./artifact-items";
import type { DimArtifactUnlocks } from "@/lib/dim/loadout-link";

export interface ArmoryCharacter {
  id: string;
  classType: number;
  light: number;
  /** Equipped emblem's wide nameplate banner (relative Bungie image path). */
  emblemBackgroundPath: string;
  /** Equipped emblem's accent color — used as the tab's fallback fill. */
  emblemColor?: DestinyColor;
  /** ISO timestamp; picks the emblem when a class has more than one character. */
  dateLastPlayed: string;
  /** Equipped subclass + fragment plugs from live sockets; omitted if none. */
  equippedSubclass?: EquippedSubclass;
  /** Currently unlocked seasonal-artifact perks (dim-api shape); omitted if unavailable. */
  artifactUnlocks?: DimArtifactUnlocks;
  /** The character's artifacts (Artifacts 2.0), equipped first, with their live perks. */
  artifacts?: OwnedArtifact[];
  /** The character's subclass items with live fragment sockets (for applying loadouts). */
  subclassItems: SubclassItem[];
}

export interface Armory {
  pieces: ArmorPiece[];
  /**
   * Every owned weapon, for saved loadouts that carry weapons. Absent on an armory
   * cached before weapons were tracked; the live profile fills it in.
   */
  weapons?: LoadoutWeapon[];
  characters: ArmoryCharacter[];
  /**
   * Plug hashes the player can socket right now (profile + character plug sets,
   * component 310: `canInsert && enabled`). Lets the mod picker prefer the variant
   * that will actually insert — e.g. the artifact-discounted copy of a mod over the
   * full-cost one. Omitted when Bungie sends no plug-set data.
   */
  insertablePlugs?: ReadonlySet<number>;
}

/** Union of every `canInsert && enabled` plug across the profile and character plug sets. */
export function insertablePlugsFromProfile(
  profile: Pick<DestinyProfileResponse, "profilePlugSets" | "characterPlugSets">,
): Set<number> | undefined {
  const sets = [
    profile.profilePlugSets?.data,
    ...Object.values(profile.characterPlugSets?.data ?? {}),
  ];
  if (sets.every((s) => !s)) return undefined;
  const out = new Set<number>();
  for (const set of sets) {
    for (const plugs of Object.values(set?.plugs ?? {})) {
      for (const p of plugs) if (p.canInsert && p.enabled) out.add(p.plugItemHash);
    }
  }
  return out;
}

/** A failed armory fetch, carrying the proxy's HTTP status (401 = session expired). */
export class ArmoryError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ArmoryError";
  }
}

/**
 * Fetch the player's raw profile from our server proxy (needs no manifest). With a
 * profile already held, its minted stamps go along in a header, and a 304 means Bungie
 * has nothing newer (see isNewerMint): `held` is returned, no body transferred.
 */
export async function fetchProfile(
  held?: DestinyProfileResponse,
): Promise<DestinyProfileResponse> {
  const stamps = encodeHeldProfile(held);
  const res =
    (await takeEarlyResponse("profile")) ??
    (await fetch("/api/bungie/profile", {
      cache: "no-store",
      headers: stamps ? { [HELD_PROFILE_HEADER]: stamps } : {},
    }));
  if (res.status === 304) {
    if (held && stamps) return held;
    throw new ArmoryError(res.status, "Profile proxy answered 304 to a request without stamps");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ArmoryError(
      res.status,
      body?.error ?? `Profile request failed: ${res.status}`,
    );
  }
  return (await res.json()) as DestinyProfileResponse;
}

/**
 * The profile to keep after a fetch: `next`, unless Bungie minted it no later than the
 * one already held (the proxy answers such a fetch with a 304, but a response that
 * raced an older poll can still arrive in full). Keeping the old object spares
 * everything derived from it.
 */
export function newerProfile(
  prev: DestinyProfileResponse | undefined,
  next: DestinyProfileResponse,
): DestinyProfileResponse {
  return !prev || isNewerMint(prev, next) ? next : prev;
}

const derived = new WeakMap<DestinyProfileResponse, WeakMap<Manifest, Armory>>();

/**
 * Normalize a profile against a manifest. Memoized on both identities: every
 * `useArmory` subscriber derives from the same (profile, manifest) pair, and only
 * the first pays for normalization.
 */
export function deriveArmory(
  profile: DestinyProfileResponse,
  manifest: Manifest,
): Armory {
  let byManifest = derived.get(profile);
  if (!byManifest) {
    byManifest = new WeakMap();
    derived.set(profile, byManifest);
  }
  let armory = byManifest.get(manifest);
  if (!armory) {
    armory = buildArmory(profile, manifest);
    byManifest.set(manifest, armory);
  }
  return armory;
}

/** Normalize the armor + characters of a raw profile. */
export function buildArmory(
  profile: DestinyProfileResponse,
  manifest: Manifest,
): Armory {
  const pieces = normalizeArmory(profile, manifest);
  const characters: ArmoryCharacter[] = Object.values(
    profile.characters?.data ?? {},
  ).map((c) => {
    const equippedSubclass = equippedSubclassForCharacter(
      profile,
      c.characterId,
    );
    const artifactUnlocks = artifactUnlocksForCharacter(
      profile,
      c.characterId,
      manifest,
    );
    return {
      id: c.characterId,
      classType: c.classType,
      light: c.light,
      emblemBackgroundPath: c.emblemBackgroundPath,
      emblemColor: c.emblemColor,
      dateLastPlayed: c.dateLastPlayed,
      ...(equippedSubclass ? { equippedSubclass } : {}),
      ...(artifactUnlocks ? { artifactUnlocks } : {}),
      artifacts: artifactsForCharacter(profile, c.characterId, manifest),
      subclassItems: subclassItemsForCharacter(profile, c.characterId, (hash) => [
        ...abilitySockets(manifest, hash).keys(),
      ]),
    };
  });

  const insertablePlugs = insertablePlugsFromProfile(profile);
  return {
    pieces,
    weapons: normalizeWeapons(profile, manifest),
    characters,
    ...(insertablePlugs ? { insertablePlugs } : {}),
  };
}
