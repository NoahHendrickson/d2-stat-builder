// Browser side of share links: store a snapshot for a short link, and read one back.
import { buildShareUrl, isShareCode, shortShareUrl } from "./share";
import { parseSavedLoadoutData, type SavedLoadoutData } from "./types";

/** Why a short link didn't open: it isn't stored, its loadout doesn't parse, or the server or network failed. */
export type ShareFetchFailure = "missing" | "unreadable" | "unavailable";

const FAILURE_MESSAGES: Record<ShareFetchFailure, string> = {
  missing: "That share link doesn't exist",
  unreadable: "That share link can't be read",
  unavailable: "Couldn't open the share link",
};

export class ShareFetchError extends Error {
  readonly retryable: boolean;
  constructor(
    readonly kind: ShareFetchFailure,
    { retryable = false }: { retryable?: boolean } = {},
  ) {
    super(FAILURE_MESSAGES[kind]);
    this.name = "ShareFetchError";
    this.retryable = retryable;
  }
}

/** The loadout behind a short code. Every failure is a ShareFetchError. */
export async function fetchShare(code: string): Promise<SavedLoadoutData> {
  let res: Response;
  try {
    res = await fetch(`/api/loadout-shares/${encodeURIComponent(code)}`);
  } catch {
    throw new ShareFetchError("unavailable", { retryable: true }); // offline, or blocked
  }
  if (res.status === 404 || res.status === 400) throw new ShareFetchError("missing");
  // 503 means storage isn't configured, which retrying won't fix.
  if (!res.ok) throw new ShareFetchError("unavailable", { retryable: res.status >= 500 && res.status !== 503 });
  const body = (await res.json().catch(() => null)) as { loadout?: unknown } | null;
  const data = parseSavedLoadoutData(body?.loadout);
  if (!data) throw new ShareFetchError("unreadable");
  return data;
}

async function shortLink(origin: string, saved: SavedLoadoutData): Promise<string> {
  const res = await fetch("/api/loadout-shares", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(saved),
  });
  const body = (await res.json().catch(() => null)) as { code?: unknown } | null;
  if (!res.ok || !isShareCode(body?.code)) throw new Error(`Share failed (${res.status})`);
  return shortShareUrl(origin, body.code);
}

/**
 * Copy a share link for `saved`. Prefers the short link; if it can't be stored, copies
 * the long self-contained one instead. Resolves to whether the short one was copied.
 *
 * Safari only lets the clipboard be written during the click, so the link is handed
 * over as a promise (ClipboardItem) rather than written after the request returns.
 */
export async function copyShareLink(origin: string, saved: SavedLoadoutData): Promise<boolean> {
  const link = shortLink(origin, saved).then(
    (url) => ({ url, short: true }),
    () => ({ url: buildShareUrl(origin, saved), short: false }),
  );
  if (typeof ClipboardItem !== "undefined") {
    try {
      const text = link.then(({ url }) => new Blob([url], { type: "text/plain" }));
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": text })]);
      return (await link).short;
    } catch {
      // Older engines refuse a promised item; fall back to writing the text.
    }
  }
  const { url, short } = await link;
  await navigator.clipboard.writeText(url);
  return short;
}
