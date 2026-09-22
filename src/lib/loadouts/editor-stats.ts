import { buildFragmentStats } from "../armory/fragments";
import type { ArmorSocket } from "../armory/normalize";
import {
  STAT_HASH_TO_INDEX,
  balancedTuningBonus,
  isBalancedTuningPlug,
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
  /** What the optimizer consumed: base roll + masterwork (+ exotic intrinsic bonus). */
  stats: StatArray;
  /**
   * The true base roll. Balanced Tuning's +1s land on its three lowest stats — the
   * same rule the normalizer used to strip the plug. Required: `stats` already carry
   * masterwork and an exotic's intrinsic bonus, which can move the classification, so
   * the archetype must never be inferred from them.
   */
  baseStats: StatArray;
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

function addStats(target: StatArray, delta: StatArray): void {
  for (let i = 0; i < 6; i++) target[i] += delta[i];
}

function armorInv(inv: InvestmentStat[] | undefined): InvestmentStat[] {
  return (inv ?? []).filter((s) => STAT_HASH_TO_INDEX[s.statTypeHash] !== undefined);
}

/**
 * A placed tuning plug's EFFECTIVE delta. Balanced is +1 to the piece's three
 * off-archetype stats only (the manifest lists six +1s, three of which the game
 * absorbs into the capped archetype stats — see `balancedTuningBonus`); a directional
 * is exactly what its manifest entry says (+5/−5).
 */
function tuningDelta(
  hash: number,
  inv: InvestmentStat[] | undefined,
  baseStats: StatArray,
): StatArray {
  if (isBalancedTuningPlug(hash, inv)) return balancedTuningBonus(baseStats);
  const out = empty();
  addInv(out, inv);
  return out;
}

function tuningFromInv(hash: number, inv: InvestmentStat[] | undefined): AppliedTuning | null {
  if (isBalancedTuningPlug(hash, inv)) return { kind: "balanced" };
  const armor = armorInv(inv);
  let plus = -1;
  let minus = -1;
  for (const s of armor) {
    const i = STAT_HASH_TO_INDEX[s.statTypeHash];
    if (s.value > 0) plus = plus === -1 ? i : -2;
    else if (s.value < 0) minus = minus === -1 ? i : -2;
  }
  if (plus >= 0 && minus >= 0) return { kind: "directional", plus, minus };
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
 * Each placed plug's effective contribution is resolved ONCE and feeds both the
 * headline total and the Mods/Tuning/Artifice breakdown, so the two can't disagree.
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
    addStats(stats, p.stats);
    const chosen = placement[p.instanceId] ?? {};
    const sockets = p.armorSockets ?? [];
    if (sockets.length) hasSockets = true;
    // Sockets the piece describes are resolved by kind below; anything placed outside
    // that list (a piece with no socket metadata) counts at face value.
    const described = new Set(sockets.map((s) => s.index));
    for (const [index, hash] of Object.entries(chosen)) {
      if (!described.has(Number(index))) addInv(stats, investmentStats(hash));
    }
    let tuning: AppliedTuning | null = null;
    let artifice: number | null = null;
    for (const socket of sockets) {
      const hash = chosen[socket.index];
      if (!hash) continue;
      const inv = investmentStats(hash);
      if (socket.kind === "tuning") {
        const delta = tuningDelta(hash, inv, p.baseStats);
        addStats(stats, delta);
        addStats(tuningBonus, delta);
        tuning = tuningFromInv(hash, inv);
      } else if (socket.kind === "artifice") {
        addInv(stats, inv);
        addInv(artificeBonus, inv);
        artifice = artificeFromInv(inv);
      } else {
        addInv(stats, inv);
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
    addStats(stats, bonus);
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
