import type {
  DestinyColor,
  DestinyProfileResponse,
} from "bungie-api-ts/destiny2";
import type { Manifest } from "@/lib/manifest/load";
import {
  equippedSubclassForCharacter,
  type EquippedSubclass,
} from "./equipped-subclass";
import { normalizeArmory, type ArmorPiece } from "./normalize";

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
}

export interface Armory {
  pieces: ArmorPiece[];
  characters: ArmoryCharacter[];
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
    return {
      id: c.characterId,
      classType: c.classType,
      light: c.light,
      emblemBackgroundPath: c.emblemBackgroundPath,
      emblemColor: c.emblemColor,
      dateLastPlayed: c.dateLastPlayed,
      ...(equippedSubclass ? { equippedSubclass } : {}),
    };
  });

  return { pieces, characters };
}
