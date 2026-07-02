import type { Manifest } from "@/lib/manifest/load";
import { STAT_HASH_TO_INDEX, TUNING_PLUG_CATEGORY } from "../armory/stats";

/**
 * General armor stat-mod plug category — the socketable +10 ("major") and +5
 * ("minor") stat mods. Same category DIM/D2ArmorPicker key on.
 */
const GENERAL_MOD_CATEGORY = "enhancements.v2_general";

const MAJOR_MOD_BONUS = 10;
const MINOR_MOD_BONUS = 5;

/** Plug hashes for one stat's general mods (undefined if the manifest scan missed it). */
export interface StatModHashes {
  major?: number;
  minor?: number;
}

/**
 * Per-stat (STAT_ORDER-indexed) plug hashes of the general +10/+5 stat mods,
 * scanned from the manifest: general-category plugs whose investment is a single
 * armor stat worth 10 or 5. Redacted defs are skipped so a deprecated duplicate
 * can't shadow the live mod.
 */
export function getStatModHashes(manifest: Manifest): StatModHashes[] {
  const out: StatModHashes[] = Array.from({ length: 6 }, () => ({}));
  const table = manifest.all("DestinyInventoryItemDefinition");
  for (const key in table) {
    const def = table[key];
    if (def.plug?.plugCategoryIdentifier !== GENERAL_MOD_CATEGORY) continue;
    if (def.redacted || !def.displayProperties?.name) continue;

    const inv = (def.investmentStats ?? []).filter(
      (s) => STAT_HASH_TO_INDEX[s.statTypeHash] !== undefined,
    );
    if (inv.length !== 1) continue;

    const idx = STAT_HASH_TO_INDEX[inv[0].statTypeHash];
    if (inv[0].value === MAJOR_MOD_BONUS) out[idx].major ??= Number(key);
    else if (inv[0].value === MINOR_MOD_BONUS) out[idx].minor ??= Number(key);
  }
  return out;
}

/**
 * Directional Tier-5 tuning plugs keyed `"plus-minus"` (STAT_ORDER indices).
 * A directional tuning mod is a tuning-category plug investing +5 in one armor
 * stat and −5 in another; the plugs are shared items across pieces, so one
 * global map serves every loadout. Balanced Tuning (all-positive) never matches.
 */
export function getTuningPlugHashes(manifest: Manifest): Map<string, number> {
  const out = new Map<string, number>();
  const table = manifest.all("DestinyInventoryItemDefinition");
  for (const key in table) {
    const def = table[key];
    const cat = def.plug?.plugCategoryIdentifier;
    if (!cat || !cat.includes(TUNING_PLUG_CATEGORY)) continue;

    let plus = -1;
    let minus = -1;
    for (const s of def.investmentStats ?? []) {
      const idx = STAT_HASH_TO_INDEX[s.statTypeHash];
      if (idx === undefined) continue;
      if (s.value > 0) plus = plus === -1 ? idx : -2;
      else if (s.value < 0) minus = minus === -1 ? idx : -2;
    }
    if (plus < 0 || minus < 0) continue;

    const mapKey = `${plus}-${minus}`;
    if (!out.has(mapKey)) out.set(mapKey, Number(key));
  }
  return out;
}

/** Artifice armor's socket-specific +3 stat mods (DIM keys on the same category). */
const ARTIFICE_MOD_CATEGORY = "enhancements.artifice";
const ARTIFICE_BONUS = 3;

/**
 * Per-stat (STAT_ORDER-indexed) plug hashes of the artifice +3 stat mods, scanned
 * from the manifest like the general mods: artifice-category plugs whose investment
 * is a single armor stat worth 3.
 */
export function getArtificeModHashes(manifest: Manifest): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(6).fill(undefined);
  const table = manifest.all("DestinyInventoryItemDefinition");
  for (const key in table) {
    const def = table[key];
    if (def.plug?.plugCategoryIdentifier !== ARTIFICE_MOD_CATEGORY) continue;
    if (def.redacted || !def.displayProperties?.name) continue;

    const inv = (def.investmentStats ?? []).filter(
      (s) => STAT_HASH_TO_INDEX[s.statTypeHash] !== undefined,
    );
    if (inv.length !== 1 || inv[0].value !== ARTIFICE_BONUS) continue;

    const idx = STAT_HASH_TO_INDEX[inv[0].statTypeHash];
    out[idx] ??= Number(key);
  }
  return out;
}
