"use client";

import { useMemo } from "react";
import type { Armory } from "@/lib/armory/fetch";
import type { ArmorPiece } from "@/lib/armory/normalize";
import type { LoadoutWeapon } from "@/lib/armory/weapons";
import { lastPlayedCharacter } from "@/lib/bungie/equip-client";
import type { Manifest } from "@/lib/manifest/load";
import { modsSectionForPieces } from "@/lib/loadouts/commit";
import type { ModsSection } from "@/lib/loadouts/mod-placement";
import { resolveLoadout } from "@/lib/loadouts/resolve";
import { loadoutSubclass } from "@/lib/loadouts/subclass";
import type { SavedLoadoutData } from "@/lib/loadouts/types";
import { loadoutArtifactRef, loadoutWeaponRefs } from "@/lib/loadouts/weapons";

/** The editor's mod picker for a loadout; available when every piece is still in the armory. */
export function editorModsFor(
  data: SavedLoadoutData,
  pieceMap: ReadonlyMap<string, ArmorPiece>,
  weaponMap: ReadonlyMap<string, LoadoutWeapon>,
  manifest: Manifest,
  insertablePlugs: Armory["insertablePlugs"],
): ModsSection | undefined {
  const resolved = resolveLoadout(data.loadout, pieceMap, manifest, weaponMap);
  if (resolved.armor.length === 0 || resolved.missing) return undefined;
  return modsSectionForPieces(
    resolved.armor.map((a) => a.piece!),
    data.loadout.parameters.mods,
    manifest,
    insertablePlugs,
    data.modPlacement,
  );
}

/** The editor drawer's subclass, weapon and artifact sections for the loadout being edited. */
export function useLoadoutEditorSections(
  data: SavedLoadoutData | undefined,
  armory: Armory,
  pieceMap: ReadonlyMap<string, ArmorPiece>,
  manifest: Manifest,
) {
  const weapons = useMemo(() => {
    // Without the weapon list (an armory cached before weapons were tracked) the pickers
    // would be empty and a save would look like "remove every weapon" — so no section.
    if (!data || !armory.weapons) return undefined;
    return {
      manifest,
      owned: armory.weapons,
      initial: loadoutWeaponRefs(manifest, data.loadout),
    };
  }, [data, armory.weapons, manifest]);

  const artifact = useMemo(() => {
    if (!data) return undefined;
    const { loadout } = data;
    const classType =
      loadout.classType < 3
        ? loadout.classType
        : loadout.equipped.map((ref) => pieceMap.get(ref.id ?? "")).find(Boolean)?.classType;
    const owned = lastPlayedCharacter(armory.characters, classType)?.artifacts;
    // No artifacts read (stale cache, no profile data): no section, so a save can't
    // read as "remove the artifact".
    if (!owned?.length) return undefined;
    return {
      manifest,
      owned,
      initial: loadoutArtifactRef(manifest, loadout),
    };
  }, [data, armory.characters, pieceMap, manifest]);

  const subclass = useMemo(() => {
    if (!data || data.loadout.classType >= 3) return undefined;
    return {
      manifest,
      classType: data.loadout.classType,
      initial: loadoutSubclass(data.loadout),
    };
  }, [data, manifest]);

  return { weapons, artifact, subclass };
}
