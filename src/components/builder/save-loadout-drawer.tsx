"use client";

import { useState } from "react";
import type { ArmorPiece } from "@/lib/armory/normalize";
import {
  LoadoutEditorDrawer,
  type LoadoutDetailsValues,
} from "@/components/loadouts/loadout-editor-drawer";
import type { SubclassSection } from "@/components/loadouts/loadout-subclass-editor";
import type { DimLoadout } from "@/lib/dim/loadout-link";
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
  makeDimLoadout: (name: string, notes?: string) => DimLoadout;
  busy: boolean;
  /** The DIM loadout with the picker's mods applied, plus the rest of the form. */
  onSubmit: (dim: DimLoadout, values: LoadoutDetailsValues) => void;
}

interface Picker {
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
  makeDimLoadout,
  busy,
  onSubmit,
}: SaveLoadoutDrawerProps) {
  const [picker] = useState((): Picker => {
    const dim = makeDimLoadout(defaultName);
    return {
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

  return (
    <LoadoutEditorDrawer
      open={open}
      onOpenChange={onOpenChange}
      formKey={session}
      title="Save loadout"
      description="Save your armor and builder targets, and customize your subclass, aspects, fragments, and mods below."
      submitLabel="Save"
      initialName={defaultName}
      mods={picker.mods}
      subclass={picker.subclass}
      busy={busy}
      onSubmit={(values) => {
        const dim = makeDimLoadout(values.name, values.notes || undefined);
        if (values.placement)
          dim.parameters.mods = modsFromEditor(picker.mods, values.placement, values.desiredStatMods);
        onSubmit(dim, values);
      }}
    />
  );
}
