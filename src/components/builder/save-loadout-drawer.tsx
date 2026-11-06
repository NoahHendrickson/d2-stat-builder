"use client";

import { useMemo, useState } from "react";
import type { ArmorPiece } from "@/lib/armory/normalize";
import type { OwnedArtifact } from "@/lib/armory/artifact-items";
import { useArmory } from "@/lib/armory/use-armory";
import {
  LoadoutEditorDrawer,
  type LoadoutDetailsValues,
} from "@/components/loadouts/loadout-editor-drawer";
import type { SubclassSection } from "@/components/loadouts/loadout-subclass-editor";
import type { WeaponsSection } from "@/components/loadouts/loadout-weapons-editor";
import type { ArtifactSection } from "@/components/loadouts/loadout-artifact-editor";
import type { DimLoadout, DimLoadoutItem } from "@/lib/dim/loadout-link";
import { weaponSlotOfHash } from "@/lib/armory/weapons";
import { isArtifactHash } from "@/lib/armory/artifact-items";
import { modsSectionForPieces } from "@/lib/loadouts/commit";
import { modsFromEditor, type ModsSection } from "@/lib/loadouts/mod-placement";
import { loadoutSubclass } from "@/lib/loadouts/subclass";
import type { Manifest } from "@/lib/manifest/load";

export interface SaveLoadoutDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Bumped on every Save click: the picker is rebuilt from the inputs as they are then. */
  session: number;
  /** The build's pieces, every one resolved against the live armory. */
  pieces: ArmorPiece[];
  manifest: Manifest;
  /** Plugs the player can socket now — picks which copy of a mod the picker shows. */
  insertablePlugs?: ReadonlySet<number>;
  buildClass?: number;
  defaultName: string;
  /** The builder's subclass item — the fallback when the DIM loadout carries none. */
  subclassItemHash?: number;
  /** The artifacts on the character the build is for; none read = no artifact slot. */
  artifacts?: readonly OwnedArtifact[];
  makeDimLoadout: (name: string, notes?: string) => DimLoadout;
  busy: boolean;
  /** The DIM loadout with the picker's mods applied, plus the rest of the form. */
  onSubmit: (dim: DimLoadout, values: LoadoutDetailsValues) => void;
  /**
   * Updating a saved loadout (opened from its Optimize) instead of saving a new one:
   * the form starts from its notes, and `makeDimLoadout` already carries its weapons,
   * artifact and subclass. `onSubmit` updates it; "Save as new" calls `onSaveAsNew`.
   */
  updating?: {
    notes: string;
    onSaveAsNew: (dim: DimLoadout, values: LoadoutDetailsValues) => void;
  };
}

interface Picker {
  weapons: DimLoadoutItem[];
  artifact?: DimLoadoutItem;
  mods: ModsSection;
  subclass?: SubclassSection;
}

/**
 * The results column's "Save as loadout" drawer — the lazy half of BuildActions, so the
 * editor and the mod planning it needs load on the first Save click, not with the page.
 *
 * Mod picker: the optimizer's stat mods / tuning / artifice are pre-placed exactly as
 * Apply would place them; the user adds other mods on top. Mods the planner can't place
 * on the live pieces — e.g. the class item's stat mod when the build uses a theoretical
 * (socket-less) exotic class item — are kept in the saved loadout, not dropped.
 *
 * Weapons and the artifact start empty, as on a loadout made in Edit: the build is armor.
 * Updating a saved loadout (`updating`) starts from that loadout's weapons, artifact,
 * subclass and other mods instead, which `makeDimLoadout` merged in.
 */
export function SaveLoadoutDrawer(props: SaveLoadoutDrawerProps) {
  // Keying remounts the picker for each Save click so it is built from the inputs as
  // they are then — no setState-during-render when `session` changes.
  return <SaveLoadoutDrawerSession key={props.session} {...props} />;
}

function SaveLoadoutDrawerSession({
  open,
  onOpenChange,
  session,
  pieces,
  manifest,
  insertablePlugs,
  buildClass,
  defaultName,
  subclassItemHash,
  artifacts,
  makeDimLoadout,
  busy,
  onSubmit,
  updating,
}: SaveLoadoutDrawerProps) {
  const [picker] = useState((): Picker => {
    const dim = makeDimLoadout(defaultName);
    return {
      // An updated loadout keeps its weapons and artifact; a new build has none.
      weapons: dim.equipped.filter((ref) => weaponSlotOfHash(manifest, ref.hash) !== undefined),
      artifact: dim.equipped.find((ref) => isArtifactHash(manifest, ref.hash)),
      mods: modsSectionForPieces(
        pieces,
        dim.parameters.mods,
        manifest,
        insertablePlugs,
      ),
      subclass:
        buildClass !== undefined && buildClass < 3
          ? {
              manifest,
              classType: buildClass,
              initial:
                loadoutSubclass(dim) ??
                (subclassItemHash ? { hash: subclassItemHash } : null),
            }
          : undefined,
    };
  });

  // Without the weapon list (an armory cached before weapons were tracked) the pickers
  // would be empty, so no Weapons row — same as Edit on the Loadouts page.
  const ownedWeapons = useArmory().data?.weapons;
  const weapons = useMemo(
    (): WeaponsSection | undefined =>
      ownedWeapons ? { manifest, owned: ownedWeapons, initial: picker.weapons } : undefined,
    [manifest, ownedWeapons, picker],
  );
  const artifact = useMemo(
    (): ArtifactSection | undefined =>
      artifacts?.length ? { manifest, owned: artifacts, initial: picker.artifact } : undefined,
    [manifest, artifacts, picker],
  );
  const finish =
    (handler: (dim: DimLoadout, values: LoadoutDetailsValues) => void) =>
    (values: LoadoutDetailsValues) => {
      const dim = makeDimLoadout(values.name, values.notes || undefined);
      if (values.placement)
        dim.parameters.mods = modsFromEditor(picker.mods, values.placement, values.desiredStatMods);
      handler(dim, values);
    };

  return (
    <LoadoutEditorDrawer
      open={open}
      onOpenChange={onOpenChange}
      formKey={session}
      title={updating ? "Update loadout" : "Save loadout"}
      description={
        updating
          ? "Replace this loadout's armor, stat mods, and builder targets with this build. Its weapons, artifact, subclass, and other mods stay unless you change them below."
          : "Save your armor and builder targets, and add weapons, an artifact, and your subclass, aspects, fragments, and mods below."
      }
      submitLabel={updating ? "Update loadout" : "Save"}
      initialName={defaultName}
      initialNotes={updating?.notes}
      secondaryAction={
        updating ? { label: "Save as new", onSubmit: finish(updating.onSaveAsNew) } : undefined
      }
      mods={picker.mods}
      subclass={picker.subclass}
      weapons={weapons}
      artifact={artifact}
      busy={busy}
      onSubmit={finish(onSubmit)}
    />
  );
}
