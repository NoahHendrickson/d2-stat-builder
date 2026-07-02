// Relative timestamps for the "New drops" feed ("just now", "5 minutes ago",
// "yesterday"). Intl.RelativeTimeFormat keeps this dependency-free.

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** Format how long ago `thenMs` was relative to `nowMs` (clock skew clamps to "just now"). */
export function formatRelativeTime(thenMs: number, nowMs: number): string {
  const elapsed = Math.max(0, nowMs - thenMs);
  if (elapsed < MINUTE_MS) return "just now";
  if (elapsed < HOUR_MS) return rtf.format(-Math.floor(elapsed / MINUTE_MS), "minute");
  if (elapsed < DAY_MS) return rtf.format(-Math.floor(elapsed / HOUR_MS), "hour");
  return rtf.format(-Math.floor(elapsed / DAY_MS), "day");
}
