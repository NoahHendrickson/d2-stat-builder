import type { ArmorPiece } from "../armory/normalize";
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
 * DIM subclass carrier, and displayed totals. Save and Edit only differ in
 * where `data` came from (optimizer build vs existing row).
 */
export function commitLoadout(
  data: SavedLoadoutData,
  manifest: Manifest,
  values: {
    placement?: ModPlacement;
    desiredStatMods?: number[];
    subclass?: DimLoadoutItem | null;
    stats?: EditorTotals;
  },
  mods?: ModsSection,
): SavedLoadoutData {
  let next = data;
  if (values.placement !== undefined) {
    next = {
      ...data,
      loadout: {
        ...data.loadout,
        parameters: {
          ...data.loadout.parameters,
          mods: mods
            ? modsFromEditor(mods, values.placement, values.desiredStatMods)
            : data.loadout.parameters.mods,
        },
      },
      modPlacement: Object.keys(values.placement).length > 0 ? values.placement : undefined,
    };
  }
  return withEditorTotals(
    withLoadoutSubclass(next, values.subclass, manifest),
    values.stats,
  );
}
