/** How the popularity cards and dialogs write their numbers. */

/** A share as a whole percent; nobody at all is "0%", a few people "<1%". */
export const percent = (share: number) =>
  share === 0 ? "0%" : share < 0.01 ? "<1%" : `${Math.round(share * 100)}%`;

// With the hour: the snapshots are rebuilt several times a day.
const sampledAtFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric" });

/** When a snapshot was made, e.g. "Oct 19, 7 PM". */
export const sampledAt = (iso: string) => sampledAtFormat.format(new Date(iso));
