import type {
  DestinyColor,
  DestinyProfileResponse,
} from "bungie-api-ts/destiny2";
import type { Manifest } from "@/lib/manifest/load";
import {
  equippedSubclassForCharacter,
  subclassItemsForCharacter,
  type EquippedSubclass,
  type SubclassItem,
} from "./equipped-subclass";
import { abilitySocketIndex } from "@/lib/loadouts/subclass";
import { ABILITY_KINDS } from "@/lib/dim/subclasses";
import { normalizeArmory, type ArmorPiece } from "./normalize";
import { artifactUnlocksForCharacter } from "./artifact";
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
  /** The character's subclass items with live fragment sockets (for applying loadouts). */
  subclassItems: SubclassItem[];
}

export interface Armory {
  pieces: ArmorPiece[];
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

/** Fetch the player's profile from our server proxy and normalize the armor. */
export async function fetchArmory(manifest: Manifest): Promise<Armory> {
  const res = await fetch("/api/bungie/profile", { cache: "no-store" });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ArmoryError(
      res.status,
      body?.error ?? `Profile request failed: ${res.status}`,
    );
  }

  const profile = (await res.json()) as DestinyProfileResponse;
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
      subclassItems: subclassItemsForCharacter(profile, c.characterId, (hash) =>
        ABILITY_KINDS.flatMap((kind) => {
          const index = abilitySocketIndex(manifest, hash, kind);
          return index === undefined ? [] : [index];
        }),
      ),
    };
  });

  const insertablePlugs = insertablePlugsFromProfile(profile);
  return { pieces, characters, ...(insertablePlugs ? { insertablePlugs } : {}) };
}
