/**
 * The hazard: how often a weapon copy that's dropped out of a player's
 * loadout turns out to be gone, by how long since it was last seen equipped.
 *
 * It's what the merge's unseen window (--unseen-days) is up against. For most
 * players the crawler sees only what's equipped, so a copy of theirs that
 * hasn't been seen equipped for that long is taken as gone. Players read whole
 * (vault and all) show what really happens: when one is read whole again,
 * each copy of theirs last seen equipped g days ago is, if it's not back in
 * the loadout, either still there (stowed) or gone. Those checks are tallied
 * here by gap, in weeks, so old seasons drop out (pruneHazard) and the
 * counts follow how players behave now. The merged store carries it
 * (popularity-copies.ts measures it; see measureHazard there) and the
 * snapshot publishes it: counts only, nothing about anyone.
 */

export interface Hazard {
  /** Oldest first; one per week in which checks were made. */
  weeks: HazardWeek[];
}
/** The checks made in the week starting on store day `day` (a multiple of 7), by gap: copies checked, and how many of those were gone. */
export interface HazardWeek {
  day: number;
  checked: number[];
  gone: number[];
}

/** The longest gap told apart, in days; longer gaps count here. */
export const HAZARD_MAX_GAP = 90;
/** Weeks of checks kept: about three months. */
export const HAZARD_WEEKS = 13;
/** The gaps the log line reports the loss at. */
const REPORTED_GAPS = [7, 14, 30, 60];

export const emptyHazard = (): Hazard => ({ weeks: [] });

export const cloneHazard = (hazard: Hazard): Hazard => ({
  weeks: hazard.weeks.map(({ day, checked, gone }) => ({ day, checked: [...checked], gone: [...gone] })),
});

function bump(counts: number[], at: number) {
  while (counts.length <= at) counts.push(0);
  counts[at]!++;
}

/** Counts one check made on `readDay` of a copy last seen equipped `gap` days before, found `gone` or not. */
export function recordHazard(hazard: Hazard, readDay: number, gap: number, gone: boolean) {
  const start = readDay - (readDay % 7);
  let week = hazard.weeks.find((w) => w.day === start);
  if (!week) {
    week = { day: start, checked: [], gone: [] };
    hazard.weeks.push(week);
    hazard.weeks.sort((a, b) => a.day - b.day);
  }
  const at = Math.min(gap, HAZARD_MAX_GAP);
  bump(week.checked, at);
  if (gone) bump(week.gone, at);
}

/** The hazard without the weeks that started HAZARD_WEEKS or more before `firstDay` (the store's window start). */
export function pruneHazard(hazard: Hazard | undefined, firstDay: number): Hazard | undefined {
  if (!hazard) return undefined;
  const weeks = hazard.weeks.filter((week) => week.day + HAZARD_WEEKS * 7 > firstDay);
  return weeks.length === hazard.weeks.length ? hazard : { weeks };
}

/**
 * The hazard in one line for a log: how many checks, over how many weeks, and
 * the share of copies gone by each of REPORTED_GAPS and by HAZARD_MAX_GAP or
 * more. A copy is checked again at every later whole read until it's gone, so
 * each gap's gone-rate is the loss since the check before; the share gone by
 * a gap chains those (the product of what survived each gap up to it).
 */
export function describeHazard(hazard: Hazard | undefined): string {
  const lead = "Copies out of the loadout, checked at a later whole read";
  const weeks = hazard?.weeks ?? [];
  const checked: number[] = [];
  const gone: number[] = [];
  for (const week of weeks) {
    week.checked.forEach((n, gap) => (checked[gap] = (checked[gap] ?? 0) + n));
    week.gone.forEach((n, gap) => (gone[gap] = (gone[gap] ?? 0) + n));
  }
  const checks = checked.reduce((sum, n) => sum + n, 0);
  if (checks === 0) return `${lead}: none yet.`;
  let survived = 1;
  const lossBy: string[] = [];
  let next = 0;
  for (let gap = 0; gap < checked.length; gap++) {
    while (next < REPORTED_GAPS.length && REPORTED_GAPS[next]! < gap) lossBy.push(`by ${REPORTED_GAPS[next++]} d ${pct(1 - survived)}`);
    if (checked[gap]) survived *= 1 - (gone[gap] ?? 0) / checked[gap]!;
  }
  while (next < REPORTED_GAPS.length) lossBy.push(`by ${REPORTED_GAPS[next++]} d ${pct(1 - survived)}`);
  lossBy.push(`by ${HAZARD_MAX_GAP} d or more ${pct(1 - survived)}`);
  const over = weeks.length === 1 ? "one week" : `${weeks.length} weeks`;
  return `${lead} (${checks.toLocaleString("en-US")} checks over ${over}): gone ${lossBy.join(", ")}, chained from the gone-rate at each gap.`;
}

const pct = (share: number) => `${(share * 100).toFixed(1)}%`;
