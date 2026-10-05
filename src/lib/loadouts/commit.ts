import { isArtifactHash } from "../armory/artifact-items";
import type { ArmorPiece } from "../armory/normalize";
import { weaponSlotOfHash } from "../armory/weapons";
import type { DimLoadoutItem } from "../dim/loadout-link";
import type { Manifest } from "../manifest/load";
import { planLoadoutPlugs } from "./apply-plan";
import { withEditorTotals, type EditorTotals } from "./editor-stats";
import {
  modsFromEditor,
  modsSectionFromPlan,
  type ModsSection,
} from "./mod-placement";
import { getModCatalog } from "./mod-options";
import { planPiecesFromArmor } from "./plan-pieces";
import { plugInfoFromManifest } from "./plug-info";
import { withLoadoutSubclass } from "./subclass";
import { withLoadoutWeapons } from "./weapons";
import type { ModPlacement, SavedLoadoutData } from "./types";

/** Plan the live pieces into a picker section (Save and Edit both start here). */
export function modsSectionForPieces(
  pieces: ArmorPiece[],
  modHashes: number[],
  manifest: Manifest,
  insertablePlugs?: ReadonlySet<number>,
  placements?: ModPlacement,
): ModsSection {
  const plan = planLoadoutPlugs({
    pieces: planPiecesFromArmor(pieces, manifest),
    modHashes,
    plugInfo: plugInfoFromManifest(manifest),
    ...(placements ? { placements } : {}),
  });
  return modsSectionFromPlan(pieces, getModCatalog(manifest), plan, insertablePlugs);
}

/**
 * Apply the editor form onto a saved-loadout payload: mods from the picker,
 * DIM subclass carrier, weapons, artifact, and displayed totals. Save and Edit
 * only differ in where `data` came from (optimizer build vs existing row).
 */
export function commitLoadout(
  data: SavedLoadoutData,
  manifest: Manifest,
  values: {
    placement?: ModPlacement;
    desiredStatMods?: number[];
    subclass?: DimLoadoutItem | null;
    /** Absent when the editor showed no Weapons row: the saved refs are kept. */
    weapons?: DimLoadoutItem[];
    /** Absent when the editor showed no artifact slot; null removes it. */
    artifact?: DimLoadoutItem | null;
    stats?: EditorTotals;
  },
  mods?: ModsSection,
): SavedLoadoutData {
  let next = data;
  if (values.weapons) {
    next = {
      ...next,
      loadout: withLoadoutWeapons(
        next.loadout,
        values.weapons,
        (ref) => weaponSlotOfHash(manifest, ref.hash) !== undefined,
      ),
    };
  }
  // Same swap for the artifact: it rides in `equipped` too.
  if (values.artifact !== undefined) {
    next = {
      ...next,
      loadout: withLoadoutWeapons(
        next.loadout,
        values.artifact ? [values.artifact] : [],
        (ref) => isArtifactHash(manifest, ref.hash),
      ),
    };
  }
  if (values.placement !== undefined) {
    next = {
      ...next,
      loadout: {
        ...next.loadout,
        parameters: {
          ...next.loadout.parameters,
          mods: mods
            ? modsFromEditor(mods, values.placement, values.desiredStatMods)
            : next.loadout.parameters.mods,
        },
      },
    };
    if (Object.keys(values.placement).length > 0) {
      next.modPlacement = values.placement;
    } else {
      delete next.modPlacement;
    }
  }
  return withEditorTotals(
    withLoadoutSubclass(next, values.subclass, manifest),
    values.stats,
  );
}
