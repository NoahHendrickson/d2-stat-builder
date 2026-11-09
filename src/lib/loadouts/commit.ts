import type { ArmorPiece } from "../armory/normalize";
import type { DimLoadoutItem } from "../dim/loadout-link";
import type { Manifest } from "../manifest/load";
import { planLoadoutPlugs, planWithPriority } from "./apply-plan";
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
import { isLoadoutArtifactRef, isLoadoutWeaponRef, withLoadoutWeapons } from "./weapons";
import { LOADOUT_SCHEMA_VERSION, type ModPlacement, type SavedLoadoutData } from "./types";

/**
 * Plan the live pieces into a picker section (Save and Edit both start here).
 * `priorityMods` (a subset of `modHashes`) are seated first; see `planWithPriority`.
 */
export function modsSectionForPieces(
  pieces: ArmorPiece[],
  modHashes: number[],
  manifest: Manifest,
  insertablePlugs?: ReadonlySet<number>,
  placements?: ModPlacement,
  priorityMods?: number[],
): ModsSection {
  const input = {
    pieces: planPiecesFromArmor(pieces, manifest),
    modHashes,
    plugInfo: plugInfoFromManifest(manifest),
    ...(placements ? { placements } : {}),
  };
  const plan = priorityMods ? planWithPriority(input, priorityMods) : planLoadoutPlugs(input);
  return modsSectionFromPlan(pieces, getModCatalog(manifest), plan, insertablePlugs);
}

/** The editor's whole form applied to `base`: its name and notes, then everything else. */
export function commitEditedLoadout(
  base: SavedLoadoutData,
  { name, notes, ...values }: { name: string; notes: string } & EditorCommitValues,
  manifest: Manifest,
  mods?: ModsSection,
): SavedLoadoutData {
  const { loadout, optimizer, builder, modPlacement, setOnly } = base;
  const next: SavedLoadoutData = {
    version: LOADOUT_SCHEMA_VERSION,
    loadout: {
      ...loadout,
      name,
      ...(notes ? { notes } : { notes: undefined }),
    },
    ...(optimizer ? { optimizer } : {}),
    ...(builder ? { builder } : {}),
    ...(modPlacement && Object.keys(modPlacement).length > 0 ? { modPlacement } : {}),
    ...(setOnly ? { setOnly } : {}),
  };
  return commitLoadout(next, manifest, values, mods);
}

/** What the editor's form contributes besides the name and notes. */
export interface EditorCommitValues {
  placement?: ModPlacement;
  desiredStatMods?: number[];
  subclass?: DimLoadoutItem | null;
  /** Absent when the editor showed no Weapons row: the saved refs are kept. */
  weapons?: DimLoadoutItem[];
  /** Absent when the editor showed no artifact slot; null removes it. */
  artifact?: DimLoadoutItem | null;
  stats?: EditorTotals;
}

/**
 * Apply the editor form onto a saved-loadout payload: mods from the picker,
 * DIM subclass carrier, weapons, artifact, and displayed totals. Save and Edit
 * only differ in where `data` came from (optimizer build vs existing row).
 */
export function commitLoadout(
  data: SavedLoadoutData,
  manifest: Manifest,
  values: EditorCommitValues,
  mods?: ModsSection,
): SavedLoadoutData {
  let next = data;
  if (values.weapons) {
    next = {
      ...next,
      loadout: withLoadoutWeapons(
        next.loadout,
        values.weapons,
        (ref) => isLoadoutWeaponRef(manifest, ref),
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
        (ref) => isLoadoutArtifactRef(manifest, ref),
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
