/**
 * A "seen it" flag in localStorage, for things shown once per browser. Best-effort: where
 * storage is blocked (a privacy mode) it reads as unseen, so the thing just shows again
 * next visit.
 */
export function seenFlag(key: string, value = "1") {
  return {
    seen(): boolean {
      try {
        return localStorage.getItem(key) === value;
      } catch {
        return false;
      }
    },
    markSeen(): void {
      try {
        localStorage.setItem(key, value);
      } catch {
        // Unseen again next visit.
      }
    },
  };
}
