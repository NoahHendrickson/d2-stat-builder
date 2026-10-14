import type { Manifest } from "@/lib/manifest/load";
import { memoByManifest } from "@/lib/manifest/memo";
import {
  ARTIFICE_MOD_CATEGORY,
  GENERAL_MOD_CATEGORY,
  STAT_HASH_TO_INDEX,
  STAT_LABELS,
  STAT_ORDER,
  TUNING_PLUG_CATEGORY,
  plugKindForCategory,
} from "../armory/stats";

const MAJOR_MOD_BONUS = 10;
const MINOR_MOD_BONUS = 5;

/** Plug hashes for one stat's general mods (undefined if the manifest scan missed it). */
export interface StatModHashes {
  major?: number;
  minor?: number;
}

type PlugDef = {
  plug?: { plugCategoryIdentifier?: string };
  investmentStats?: { statTypeHash: number; value: number }[];
};

/** One armor-stat investment: `index` into STAT_ORDER. */
export interface ArmorStatInvestment {
  index: number;
  value: number;
}

/** A plug's investment in the six armor stats; energy cost and every other stat dropped. */
export function armorStatInvestment(def: PlugDef | undefined): ArmorStatInvestment[] {
  const out: ArmorStatInvestment[] = [];
  for (const s of def?.investmentStats ?? []) {
    const index = STAT_HASH_TO_INDEX[s.statTypeHash];
    if (index !== undefined) out.push({ index, value: s.value });
  }
  return out;
}

/**
 * Per-stat (STAT_ORDER-indexed) plug hashes of the general +10/+5 stat mods,
 * scanned from the manifest: general-category plugs whose investment is a single
 * armor stat worth 10 or 5. Redacted defs are skipped so a deprecated duplicate
 * can't shadow the live mod.
 */
export const getStatModHashes = memoByManifest((manifest): StatModHashes[] => {
  const out: StatModHashes[] = Array.from({ length: 6 }, () => ({}));
  const table = manifest.all("DestinyInventoryItemDefinition");
  for (const key in table) {
    const def = table[key];
    if (def.plug?.plugCategoryIdentifier !== GENERAL_MOD_CATEGORY) continue;
    if (def.redacted || !def.displayProperties?.name) continue;

    const inv = armorStatInvestment(def);
    if (inv.length !== 1) continue;

    const { index, value } = inv[0];
    if (value === MAJOR_MOD_BONUS) out[index].major ??= Number(key);
    else if (value === MINOR_MOD_BONUS) out[index].minor ??= Number(key);
  }
  return out;
});

/** Builder major-mod selector range is 0–5 (the remaining slots are minors). */
const BUILDER_MAJOR_MOD_CAP = 5;

/** True for a general-armor +10 stat mod (the builder's "major"). */
export function isMajorStatMod(def: PlugDef | undefined): boolean {
  if (!def || def.plug?.plugCategoryIdentifier !== GENERAL_MOD_CATEGORY) return false;
  const inv = armorStatInvestment(def);
  return inv.length === 1 && inv[0].value === MAJOR_MOD_BONUS;
}

/**
 * How many general +10 stat mods are in `mods`. Caps at the builder selector max
 * so Optimize can set the budget from what's actually on the loadout.
 */
export function countMajorStatMods(
  mods: readonly number[],
  isMajor: (hash: number) => boolean,
): number {
  let n = 0;
  for (const h of mods) {
    if (isMajor(h)) n++;
  }
  return Math.min(BUILDER_MAJOR_MOD_CAP, n);
}

/**
 * The +N / −N pair of a directional tuning plug: one armor stat up, one down.
 * Undefined for anything else (Balanced Tuning is all-positive).
 */
function tuningDirection(
  inv: ArmorStatInvestment[],
): { plus: ArmorStatInvestment; minus: ArmorStatInvestment } | undefined {
  const plus = inv.filter((s) => s.value > 0);
  const minus = inv.filter((s) => s.value < 0);
  if (plus.length !== 1 || minus.length !== 1) return undefined;
  return { plus: plus[0], minus: minus[0] };
}

/**
 * Directional Tier-5 tuning plugs keyed `"plus-minus"` (STAT_ORDER indices).
 * A directional tuning mod is a tuning-category plug investing +5 in one armor
 * stat and −5 in another; the plugs are shared items across pieces, so one
 * global map serves every loadout. Balanced Tuning (all-positive) never matches.
 */
export const getTuningPlugHashes = memoByManifest((manifest): Map<string, number> => {
  const out = new Map<string, number>();
  const table = manifest.all("DestinyInventoryItemDefinition");
  for (const key in table) {
    const def = table[key];
    const cat = def.plug?.plugCategoryIdentifier;
    if (!cat || !cat.includes(TUNING_PLUG_CATEGORY)) continue;

    const dir = tuningDirection(armorStatInvestment(def));
    if (!dir) continue;

    const mapKey = `${dir.plus.index}-${dir.minus.index}`;
    if (!out.has(mapKey)) out.set(mapKey, Number(key));
  }
  return out;
});

/** Artifice armor's socket-specific +3 stat mods (DIM keys on the same category). */
const ARTIFICE_BONUS = 3;

/**
 * Per-stat (STAT_ORDER-indexed) plug hashes of the artifice +3 stat mods, scanned
 * from the manifest like the general mods: artifice-category plugs whose investment
 * is a single armor stat worth 3.
 */
export const getArtificeModHashes = memoByManifest((manifest): (number | undefined)[] => {
  const out: (number | undefined)[] = new Array(6).fill(undefined);
  const table = manifest.all("DestinyInventoryItemDefinition");
  for (const key in table) {
    const def = table[key];
    if (def.plug?.plugCategoryIdentifier !== ARTIFICE_MOD_CATEGORY) continue;
    if (def.redacted || !def.displayProperties?.name) continue;

    const inv = armorStatInvestment(def);
    if (inv.length !== 1 || inv[0].value !== ARTIFICE_BONUS) continue;

    out[inv[0].index] ??= Number(key);
  }
  return out;
});

function formatInvestment({ index, value }: ArmorStatInvestment): string {
  return `${value > 0 ? "+" : "−"}${Math.abs(value)} ${STAT_LABELS[STAT_ORDER[index]]}`;
}

/**
 * What a stat mod (general +10 / +5, artifice +3) or directional tuning mod does,
 * read from its investment: "+10 Grenade", "+5 Weapons / −5 Grenade". Undefined for
 * any other plug, Balanced Tuning included.
 */
export function statModLabel(def: PlugDef | undefined): string | undefined {
  const kind = plugKindForCategory(def?.plug?.plugCategoryIdentifier ?? "");
  const inv = armorStatInvestment(def);
  if (kind === "general" || kind === "artifice") {
    return inv.length === 1 && inv[0].value > 0 ? formatInvestment(inv[0]) : undefined;
  }
  if (kind === "tuning") {
    const dir = tuningDirection(inv);
    return dir ? `${formatInvestment(dir.plus)} / ${formatInvestment(dir.minus)}` : undefined;
  }
  return undefined;
}

/**
 * `statModLabel` for every stat and tuning plug, by hash. The artifact-discounted copy
 * of a general mod invests only energy (its +10 lives on its sandbox perk), so it takes
 * the label of the full-cost mod that shares that perk.
 */
const getStatModLabels = memoByManifest((manifest): Map<number, string> => {
  const out = new Map<number, string>();
  const byPerk = new Map<number, string>();
  const unlabeled: { hash: number; perkHash: number }[] = [];
  const table = manifest.all("DestinyInventoryItemDefinition");
  for (const key in table) {
    const def = table[key];
    const kind = plugKindForCategory(def.plug?.plugCategoryIdentifier ?? "");
    if (kind !== "general" && kind !== "artifice" && kind !== "tuning") continue;
    const label = statModLabel(def);
    const perkHash = def.perks?.[0]?.perkHash;
    if (label) {
      out.set(Number(key), label);
      if (kind === "general" && perkHash !== undefined) byPerk.set(perkHash, label);
    } else if (kind === "general" && perkHash !== undefined) {
      unlabeled.push({ hash: Number(key), perkHash });
    }
  }
  for (const { hash, perkHash } of unlabeled) {
    const label = byPerk.get(perkHash);
    if (label) out.set(hash, label);
  }
  return out;
});

/** The stat label for a plug hash (see `statModLabel`), or undefined if it isn't a stat/tuning mod. */
export function statModName(manifest: Manifest, hash: number): string | undefined {
  return getStatModLabels(manifest).get(hash);
}
