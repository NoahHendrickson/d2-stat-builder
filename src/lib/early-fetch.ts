/**
 * The two startup requests that gate everything else — the session check and the
 * profile fetch — are started by an inline script in the root layout, before the app
 * bundle has downloaded, parsed, and hydrated. The query functions take the in-flight
 * responses from `window.__d2Early` (once) instead of starting their own.
 *
 * It is an inline script, so it relies on `script-src 'unsafe-inline'` in the CSP
 * (next.config.ts). If that is ever tightened to a nonce, this must become a nonced
 * script or the requests silently start late (the app keeps working, just slower).
 */

interface EarlyFetches {
  session?: Promise<Response>;
  /** Resolves to null when the session came back unauthenticated. */
  profile?: Promise<Response | null>;
}

declare global {
  interface Window {
    __d2Early?: EarlyFetches;
  }
}

/** Inline bootstrap script (ES5, no dependencies). Keep in sync with the query functions. */
export const EARLY_FETCH_SCRIPT = [
  "(function(){",
  "var e=window.__d2Early={};",
  'e.session=fetch("/api/auth/session",{cache:"no-store"});',
  "e.profile=e.session.then(function(r){return r.ok?r.clone().json():null})",
  '.then(function(s){return s&&s.authenticated?fetch("/api/bungie/profile",{cache:"no-store"}):null});',
  "e.session.catch(function(){});e.profile.catch(function(){});",
  "})();",
].join("");

/**
 * The response the bootstrap script started for `kind`, or undefined if there is none
 * (server render, a later refetch, or the early request failed — the caller then fetches
 * normally). Each early response is handed out once.
 */
export async function takeEarlyResponse(
  kind: keyof EarlyFetches,
): Promise<Response | undefined> {
  if (typeof window === "undefined") return undefined;
  const early = window.__d2Early;
  const pending = early?.[kind];
  if (!early || !pending) return undefined;
  delete early[kind];
  try {
    return (await pending) ?? undefined;
  } catch {
    return undefined;
  }
}
