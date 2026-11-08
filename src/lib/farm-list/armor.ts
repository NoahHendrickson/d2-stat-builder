// Farm list rules for armor: the entry a Theoretical row or a Dream replacement makes, and
// which owned pieces match one. Armor is only hunted for a set bonus, so a piece that
// doesn't count toward a required set makes no entry at all.
// Pure — runtime imports stay relative so it runs under vitest.
import { armorPipTier, type ArmorPiece } from "../armory/normalize";
import { ARMOR_SLOTS, CLASS_NAMES, SLOT_LABELS, tertiaryStatIndex } from "../armory/stats";
import type { FarmPiece } from "../optimizer/dream";
import type { TheoryPiece } from "../optimizer/theory";
import { assignDrops } from "./assign-drops";
import { FARM_LIST_SCHEMA_VERSION, type ArmorFarmData, type ArmorFarmEntry } from "./types";

/** The entry for a Theoretical build's row; null when it isn't a piece of a required set. */
export function armorFromTheory(
  piece: TheoryPiece,
  context: { classType: number; setName?: string },
): ArmorFarmData | null {
  if (piece.setHash === undefined || piece.exotic) return null;
  return {
    kind: "armor",
    version: FARM_LIST_SCHEMA_VERSION,
    classType: context.classType,
    slot: ARMOR_SLOTS[piece.slot],
    archetype: piece.archetype,
    primary: piece.primary,
    secondary: piece.secondary,
    rolls: [{ tertiary: piece.tertiary, tuned: piece.tuning ? [piece.tuning.plus] : null }],
    setHash: piece.setHash,
    ...(context.setName ? { setName: context.setName } : {}),
    ignoredInstanceIds: [],
  };
}

/**
 * The entry for a Dream build's replacement, with every roll the option says would do;
 * null when it isn't a piece of a required set.
 */
export function armorFromDream(
  farm: FarmPiece,
  context: { classType: number; setName?: string },
): ArmorFarmData | null {
  if (farm.setHash === undefined || farm.exotic) return null;
  return {
    kind: "armor",
    version: FARM_LIST_SCHEMA_VERSION,
    classType: context.classType,
    slot: ARMOR_SLOTS[farm.slot],
    archetype: farm.archetype,
    primary: farm.primary,
    secondary: farm.secondary,
    rolls: farm.rolls.map((r) => ({ tertiary: r.tertiary, tuned: r.tuned })),
    setHash: farm.setHash,
    ...(context.setName ? { setName: context.setName } : {}),
    ignoredInstanceIds: [],
  };
}

/** What makes two armor entries the same hunt. */
export function armorFarmKey(entry: ArmorFarmData): string {
  const rolls = [...entry.rolls]
    .sort((a, b) => a.tertiary - b.tertiary)
    .map((r) => `${r.tertiary}:${r.tuned ? [...r.tuned].sort((a, b) => a - b).join("+") : "any"}`);
  return [entry.classType, entry.slot, entry.archetype, entry.setHash, rolls.join(",")].join("|");
}

/** Whether a Tier 5 piece is the drop an entry is waiting for. */
export function armorMatches(piece: ArmorPiece, entry: ArmorFarmData): boolean {
  if (piece.classType !== entry.classType || armorPipTier(piece) !== 5 || piece.isExotic) return false;
  if (piece.slot !== entry.slot || piece.archetype !== entry.archetype || piece.setHash !== entry.setHash) return false;
  const tertiary = tertiaryStatIndex(piece.baseStats);
  return entry.rolls.some(
    (roll) =>
      roll.tertiary === tertiary &&
      (roll.tuned === null || (piece.tunedStat !== undefined && roll.tuned.includes(piece.tunedStat))),
  );
}

/** The owned pieces that match an entry, other than the copies it ignores. */
export function matchingArmor(pieces: readonly ArmorPiece[], entry: ArmorFarmData): ArmorPiece[] {
  const ignored = new Set(entry.ignoredInstanceIds);
  return pieces.filter((piece) => !ignored.has(piece.instanceId) && armorMatches(piece, entry));
}

/** The waiting entries that now have a match, each with its piece (see assignDrops). */
export function newlyObtainedArmor(
  pieces: readonly ArmorPiece[],
  entries: readonly ArmorFarmEntry[],
): { entry: ArmorFarmEntry; piece: ArmorPiece }[] {
  return assignDrops(entries, (entry) => matchingArmor(pieces, entry)).map(({ entry, copy }) => ({ entry, piece: copy }));
}

/** "Gunner Helmet". */
export function armorFarmTitle(entry: ArmorFarmData): string {
  return `${entry.archetype} ${SLOT_LABELS[entry.slot]}`;
}

/** "in your Vault", "on your Hunter", "at your Hunter's Postmaster". */
export function armorPlaceLabel(piece: Pick<ArmorPiece, "location" | "postmaster" | "classType">): string {
  if (piece.location === "vault") return "in your Vault";
  const name = CLASS_NAMES[piece.classType];
  if (piece.postmaster) return name ? `at your ${name}'s Postmaster` : "at the Postmaster";
  return name ? `on your ${name}` : "on a character";
}
