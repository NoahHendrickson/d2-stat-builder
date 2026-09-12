import { buildFragmentStats } from "../armory/fragments";
import type { ArmorSocket } from "../armory/normalize";
import {
  BALANCED_TUNING_PLUG_HASH,
  STAT_HASH_TO_INDEX,
  type StatArray,
} from "../armory/stats";
import type { AppliedTuning } from "../optimizer/types";
import type { ModPlacement, SavedLoadoutData } from "./types";

type InvestmentStat = {
  statTypeHash: number;
  value: number;
  isConditionallyActive?: boolean;
};

/** Piece fields the drawer totals need — live armor plus whatever is currently placed. */
export interface EditorStatPiece {
  instanceId: string;
  stats: StatArray;
  armorSockets?: ArmorSocket[];
}

export interface EditorBreakdown {
  modBonus: StatArray;
  tuningBonus: StatArray;
  artificeBonus: StatArray;
  modsUsed: { major: number; minor: number };
  /** Per-instance tuning/artifice picks from the current placement. */
  piece: Record<string, { tuning: AppliedTuning | null; artifice: number | null }>;
}

export interface EditorTotals {
  stats: StatArray;
  total: number;
  /** Present when pieces had sockets, so Mods/Tuning/Artifice stay in sync with the header. */
  breakdown?: EditorBreakdown;
}

const ZERO: StatArray = [0, 0, 0, 0, 0, 0];
const empty = (): StatArray => [...ZERO] as StatArray;

function addInv(target: StatArray, inv: InvestmentStat[] | undefined): void {
  for (const s of inv ?? []) {
    const i = STAT_HASH_TO_INDEX[s.statTypeHash];
    if (i !== undefined) target[i] += s.value;
  }
}

function armorInv(inv: InvestmentStat[] | undefined): InvestmentStat[] {
  return (inv ?? []).filter((s) => STAT_HASH_TO_INDEX[s.statTypeHash] !== undefined);
}

function tuningFromInv(hash: number, inv: InvestmentStat[] | undefined): AppliedTuning | null {
  if (hash === BALANCED_TUNING_PLUG_HASH) return { kind: "balanced" };
  const armor = armorInv(inv);
  let plus = -1;
  let minus = -1;
  for (const s of armor) {
    const i = STAT_HASH_TO_INDEX[s.statTypeHash];
    if (s.value > 0) plus = plus === -1 ? i : -2;
    else if (s.value < 0) minus = minus === -1 ? i : -2;
  }
  if (plus >= 0 && minus >= 0) return { kind: "directional", plus, minus };
  if (plus >= 0 && minus === -1) return { kind: "balanced" };
  return null;
}

function artificeFromInv(inv: InvestmentStat[] | undefined): number | null {
  const hit = armorInv(inv).find((s) => s.value === 3);
  if (!hit) return null;
  return STAT_HASH_TO_INDEX[hit.statTypeHash];
}

/**
 * Armor + placed mods + fragments, clamped to 0–200 per stat (same window the
 * optimizer reports). `investmentStats` is the plug's manifest investment list.
 */
export function sumEditorStats(
  pieces: readonly EditorStatPiece[],
  placement: ModPlacement,
  fragmentHashes: readonly number[],
  classType: number,
  investmentStats: (hash: number) => InvestmentStat[] | undefined,
): EditorTotals {
  const stats = empty();
  const modBonus = empty();
  const tuningBonus = empty();
  const artificeBonus = empty();
  const modsUsed = { major: 0, minor: 0 };
  const piece: EditorBreakdown["piece"] = {};
  let hasSockets = false;

  for (const p of pieces) {
    for (let i = 0; i < 6; i++) stats[i] += p.stats[i];
    const chosen = placement[p.instanceId] ?? {};
    for (const hash of Object.values(chosen)) addInv(stats, investmentStats(hash));
    let tuning: AppliedTuning | null = null;
    let artifice: number | null = null;
    if (p.armorSockets?.length) hasSockets = true;
    for (const socket of p.armorSockets ?? []) {
      const hash = chosen[socket.index];
      if (!hash) continue;
      const inv = investmentStats(hash);
      if (socket.kind === "tuning") {
        addInv(tuningBonus, inv);
        tuning = tuningFromInv(hash, inv);
      } else if (socket.kind === "artifice") {
        addInv(artificeBonus, inv);
        artifice = artificeFromInv(inv);
      } else {
        addInv(modBonus, inv);
        const armor = armorInv(inv);
        if (socket.kind === "general" && armor.length === 1) {
          if (armor[0].value === 10) modsUsed.major++;
          else if (armor[0].value === 5) modsUsed.minor++;
        }
      }
    }
    piece[p.instanceId] = { tuning, artifice };
  }
  for (const hash of fragmentHashes) {
    const bonus = buildFragmentStats(investmentStats(hash), classType).stats;
    for (let i = 0; i < 6; i++) stats[i] += bonus[i];
  }
  const clamped = stats.map((v) => Math.max(0, Math.min(200, v))) as StatArray;
  return {
    stats: clamped,
    total: clamped.reduce((sum, v) => sum + v, 0),
    ...(hasSockets
      ? { breakdown: { modBonus, tuningBonus, artificeBonus, modsUsed, piece } }
      : {}),
  };
}

/**
 * The displayed totals of a saved loadout are what the editor last showed.
 * When a breakdown is present, Mods/Tuning/Artifice are rebuilt from placement
 * so the rows still add up after an edit.
 */
export function withEditorTotals(
  data: SavedLoadoutData,
  totals: EditorTotals | undefined,
): SavedLoadoutData {
  if (!totals || !data.optimizer) return data;
  const { breakdown } = totals;
  const optimizer = {
    ...data.optimizer,
    stats: totals.stats,
    total: totals.total,
  };
  if (breakdown) {
    optimizer.modBonus = breakdown.modBonus;
    optimizer.tuningBonus = breakdown.tuningBonus;
    optimizer.artificeBonus = breakdown.artificeBonus;
    optimizer.modsUsed = breakdown.modsUsed;
    optimizer.tuning = data.optimizer.pieceIds.map(
      (id) => breakdown.piece[id]?.tuning ?? null,
    );
    optimizer.artifice = data.optimizer.pieceIds.map(
      (id) => breakdown.piece[id]?.artifice ?? null,
    );
  }
  return { ...data, optimizer };
}
