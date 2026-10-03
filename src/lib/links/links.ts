// Sidebar bookmarks: user-added links (usually Google Sheets) that open in a new tab.
// Pure helpers only — storage lives in use-links.ts. Runtime imports stay relative so
// the module runs under vitest.

export interface SavedLink {
  id: string;
  name: string;
  /** Always an absolute http(s) URL — see `normalizeLinkUrl`. */
  url: string;
}

export const MAX_LINK_NAME_LENGTH = 60;

/**
 * Turn what someone typed into an absolute http(s) URL, or null if it isn't one.
 * A bare host ("docs.google.com/…") gets https://. Anything else with a scheme
 * (javascript:, data:, file:) is refused: the result ends up in an href.
 */
export function normalizeLinkUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  // "localhost:3000" parses as scheme "localhost:" — treat host:port as a bare host.
  const bareHostWithPort = /^[^/:]+:\d+(\/|$)/.test(trimmed);
  const candidate = hasScheme && !bareHostWithPort ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  // "https://foo" with no dot is almost always a typo, except localhost.
  if (!url.hostname.includes(".") && url.hostname !== "localhost") return null;
  return url.href;
}

const KNOWN_APPS: { host: string; path: string; name: string }[] = [
  { host: "docs.google.com", path: "/spreadsheets/", name: "Google Sheet" },
  { host: "docs.google.com", path: "/document/", name: "Google Doc" },
  { host: "docs.google.com", path: "/presentation/", name: "Google Slides" },
  { host: "docs.google.com", path: "/forms/", name: "Google Form" },
];

/** Name used when the person leaves the name blank: the app, else the bare host. */
export function defaultLinkName(url: string): string {
  const { hostname, pathname } = new URL(url);
  const app = KNOWN_APPS.find((a) => a.host === hostname && pathname.startsWith(a.path));
  return app?.name ?? hostname.replace(/^www\./, "");
}

/** Keep only well-formed entries from a stored blob (hand-edited or older builds). */
export function parseStoredLinks(raw: string | null): SavedLink[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  return parseLinks(data);
}

/** Keep only well-formed entries from parsed JSON (storage or the account's copy). */
export function parseLinks(data: unknown): SavedLink[] {
  if (!Array.isArray(data)) return [];
  const links: SavedLink[] = [];
  for (const entry of data) {
    if (!entry || typeof entry !== "object") continue;
    const { id, name, url } = entry as Record<string, unknown>;
    if (typeof id !== "string" || typeof name !== "string" || typeof url !== "string") {
      continue;
    }
    const normalized = normalizeLinkUrl(url);
    if (!normalized) continue;
    links.push({ id, name: name.slice(0, MAX_LINK_NAME_LENGTH), url: normalized });
  }
  return links;
}

/** Same-origin favicon for `url` (see src/app/api/favicon/route.ts). */
export function faviconSrc(url: string): string {
  return `/api/favicon?url=${encodeURIComponent(url)}`;
}
