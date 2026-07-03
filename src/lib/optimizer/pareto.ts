import { NUM_STATS, type InternalPiece } from "./tuning";

/**
 * Keep only the Pareto frontier of a dominance group: pieces not dominated on all six
 * stats by another piece in the same group. A group (built by solve's dedupe) shares
 * every non-stat attribute the search can distinguish — exotic hash / legendary,
 * artifice flag, set hash (when set requirements are active), and tuning signature —
 * so two group members differ ONLY in their stat vectors. All constraints are stat
 * minimums and both objectives (top-N total, per-stat ceilings) are monotone
 * nondecreasing in piece stats, so a piece that is <= another on every stat can be
 * swapped out of any loadout without loss: dropping it cannot change the best
 * achievable totals or the exact ceilings. It only disappears as a lower-total
 * alternate in the results list — the same precedent dedupe already sets by silently
 * collapsing stat-identical duplicates.
 *
 * Future candidates (deliberately NOT done — near-zero yield today for real proof
 * burden): cross-group rules such as "artifice dominates non-artifice at >= stats"
 * (artifice options are a strict superset) or "tunable dominates non-tunable at
 * >= stats" (Balanced is pure upside over no-tune).
 *
 * Expected yield: Armor 3.0 Tier-5 pieces are a fixed stat budget (every piece in the
 * real-pool fixture totals exactly 90), and domination implies a strictly greater
 * total — so among Tier-5 gear this filter prunes NOTHING. It only fires where totals
 * vary: duplicate copies of legacy exotics today, and any future stat-varying gear
 * (e.g. legacy legendary support). It's kept as a free safety net, not a speedup.
 */
export function paretoWithinGroup(pieces: InternalPiece[]): InternalPiece[] {
  if (pieces.length <= 1) return pieces;
  // Descending by total: a dominator always has a strictly greater total than a piece
  // it dominates (dedupe already collapsed equal vectors), so each candidate only needs
  // checking against already-kept pieces with greater totals.
  const sorted = [...pieces].sort((a, b) => b.total - a.total);
  const kept: InternalPiece[] = [];
  outer: for (const cand of sorted) {
    for (const k of kept) {
      // Kept is in descending-total order; once totals stop exceeding the candidate's,
      // domination is impossible (equal totals with distinct vectors never dominate).
      if (k.total <= cand.total) break;
      let dominates = true;
      for (let s = 0; s < NUM_STATS; s++) {
        if (k.stats[s] < cand.stats[s]) {
          dominates = false;
          break;
        }
      }
      if (dominates) continue outer;
    }
    kept.push(cand);
  }
  return kept;
}
