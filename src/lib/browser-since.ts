// When this browser first used the app, so a changed default can apply to new browsers
// only. No imports: app-shell stamps it as the app loads, on every page.

/** `YYYY-MM-DD` (UTC) of the first visit, or BEFORE_STAMPS. */
const FIRST_SEEN_KEY = "stat-builder:first-seen";
/** Used the app before the stamp existed: earlier than any date. */
const BEFORE_STAMPS = "before";

/**
 * Stamp the browser's first visit, once. A browser that already has any of the app's keys
 * was here before stamps existed. The check holds only while nothing saves to storage as
 * the app loads: app-shell runs this at module load, and no module may write storage at
 * load time (they read it, or write from effects and handlers).
 */
export function stampFirstSeen(storage: Storage, today = new Date().toISOString().slice(0, 10)) {
  if (storage.getItem(FIRST_SEEN_KEY) !== null) return;
  let returning = false;
  for (let i = 0; i < storage.length; i++) {
    if (storage.key(i)?.startsWith("stat-builder:")) {
      returning = true;
      break;
    }
  }
  storage.setItem(FIRST_SEEN_KEY, returning ? BEFORE_STAMPS : today);
}

/**
 * Whether this browser was using the app before `date` (`YYYY-MM-DD`, UTC). Unknown (no
 * stamp, unreadable, or storage blocked) counts as before: a browser we can't place keeps
 * what it had, rather than having a new default sprung on it.
 */
export function browserPredates(date: string, storage?: Storage): boolean {
  try {
    const seen = (storage ?? localStorage).getItem(FIRST_SEEN_KEY);
    if (seen === null || seen === BEFORE_STAMPS || !/^\d{4}-\d{2}-\d{2}$/.test(seen)) return true;
    return seen < date;
  } catch {
    return true;
  }
}
