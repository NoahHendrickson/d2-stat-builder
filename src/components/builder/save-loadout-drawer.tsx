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
import { modsSectionForPieces } from "@/lib/loadouts/commit";
import { loadoutArtifactRef, loadoutWeaponRefs } from "@/lib/loadouts/weapons";
import type { SavedLoadout } from "@/lib/loadouts/types";
import { modsFromEditor, type ModsSection } from "@/lib/loadouts/mod-placement";
import { loadoutSubclass } from "@/lib/loadouts/subclass";
import type { Manifest } from "@/lib/manifest/load";

/** Where a Save writes: a new loadout, or over the linked one (Update loadout). */
export type SaveTarget = { kind: "new" } | { kind: "update"; loadout: SavedLoadout };

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
  /**
   * What the drawer opened for. Updating starts the form from that loadout (notes, and
   * the weapons, artifact, subclass and other mods `makeDimLoadout` merges in) and also
   * offers Save as new.
   */
  target: SaveTarget;
  /** The DIM loadout to save as `target` (an update merges the build into it). */
  makeDimLoadout: (name: string, notes: string | undefined, target: SaveTarget) => DimLoadout;
  /** The save in flight, if any: its button gets the spinner, and both are disabled. */
  pending: SaveTarget["kind"] | null;
  /** The DIM loadout with the picker's mods applied, the rest of the form, and where to. */
  onSubmit: (dim: DimLoadout, values: LoadoutDetailsValues, target: SaveTarget) => void;
}

const NEW: SaveTarget = { kind: "new" };

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
 * A new loadout's weapons and artifact start empty, as on a loadout made in Edit: the
 * build is armor. Updating starts from the saved loadout's weapons, artifact, subclass
 * and other mods; the build's own mods are seated first, so the stat mods that reach
 * its targets get the energy and the kept mods fit around them.
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
  target,
  makeDimLoadout,
  pending,
  onSubmit,
}: SaveLoadoutDrawerProps) {
  const updating = target.kind === "update" ? target.loadout : undefined;
  const [picker] = useState((): Picker => {
    const dim = makeDimLoadout(defaultName, undefined, target);
    return {
      // An updated loadout keeps its weapons and artifact; a new build has none.
      weapons: loadoutWeaponRefs(manifest, dim),
      artifact: loadoutArtifactRef(manifest, dim),
      mods: modsSectionForPieces(
        pieces,
        dim.parameters.mods,
        manifest,
        insertablePlugs,
        undefined,
        updating ? makeDimLoadout(defaultName, undefined, NEW).parameters.mods : undefined,
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
  // Save as new from an update gets the build's own DIM loadout (its own id, no copy of
  // the saved one's extras); the form's weapons, subclass, artifact and mods still apply.
  const finish = (as: SaveTarget) => (values: LoadoutDetailsValues) => {
    const dim = makeDimLoadout(values.name, values.notes || undefined, as);
    if (values.placement)
      dim.parameters.mods = modsFromEditor(picker.mods, values.placement, values.desiredStatMods);
    onSubmit(dim, values, as);
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
      initialNotes={updating?.loadout.notes}
      secondaryAction={
        updating
          ? { label: "Save as new", onSubmit: finish(NEW), busy: pending === "new" }
          : undefined
      }
      mods={picker.mods}
      subclass={picker.subclass}
      weapons={weapons}
      artifact={artifact}
      busy={pending !== null}
      onSubmit={finish(target)}
    />
  );
}
