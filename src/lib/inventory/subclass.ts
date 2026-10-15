import type { DestinyProfileResponse } from "bungie-api-ts/destiny2";
import type { Subclass } from "@/lib/armory/fragments";
import { subclassItemsForCharacter } from "@/lib/armory/equipped-subclass";
import { ABILITY_KINDS, type AbilityKind } from "@/lib/dim/subclasses";
import { abilitySocketIndex } from "@/lib/loadouts/subclass";
import type { Manifest } from "@/lib/manifest/load";

/** What a character's equipped subclass is set up with, as plug hashes in socket order. */
export interface SubclassSetup {
  itemHash: number;
  subclass: Subclass;
  /** The plug in each ability socket the subclass has (Super, class ability, jump, melee, grenade). */
  abilities: { kind: AbilityKind; hash: number }[];
  aspects: number[];
  fragments: number[];
}

/**
 * The equipped subclass's live plugs (component 305), or undefined with none equipped.
 * Sockets still holding their empty plug ("Empty Fragment Socket") are left out.
 */
export function equippedSubclassSetup(
  profile: DestinyProfileResponse,
  characterId: string,
  manifest: Manifest,
): SubclassSetup | undefined {
  /** Each subclass's ability socket indexes, and the ability each holds. */
  const kindsOf = new Map<number, Map<number, AbilityKind>>();
  const abilityKinds = (itemHash: number) => {
    let kinds = kindsOf.get(itemHash);
    if (!kinds) {
      kinds = new Map();
      for (const kind of ABILITY_KINDS) {
        const index = abilitySocketIndex(manifest, itemHash, kind);
        if (index !== undefined) kinds.set(index, kind);
      }
      kindsOf.set(itemHash, kinds);
    }
    return kinds;
  };
  const equipped = subclassItemsForCharacter(profile, characterId, (itemHash) => [
    ...abilityKinds(itemHash).keys(),
  ]).find((s) => s.equipped);
  if (!equipped) return undefined;
  const kinds = abilityKinds(equipped.itemHash);

  const entries =
    manifest.def("DestinyInventoryItemDefinition", equipped.itemHash)?.sockets?.socketEntries ?? [];
  const filled = (sockets: Record<number, number>) =>
    Object.entries(sockets).flatMap(([index, hash]) =>
      entries[Number(index)]?.singleInitialItemHash === hash ? [] : [hash],
    );
  return {
    itemHash: equipped.itemHash,
    subclass: equipped.subclass,
    abilities: Object.entries(equipped.abilitySockets)
      .flatMap(([index, hash]) => {
        const kind = kinds.get(Number(index));
        return kind ? [{ kind, hash }] : [];
      })
      .sort((a, b) => ABILITY_KINDS.indexOf(a.kind) - ABILITY_KINDS.indexOf(b.kind)),
    aspects: filled(equipped.aspectSockets),
    fragments: filled(equipped.fragmentSockets),
  };
}
