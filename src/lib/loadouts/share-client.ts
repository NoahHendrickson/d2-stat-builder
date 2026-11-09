// Browser side of share links: store a snapshot for a short link, and read one back.
import { buildShareUrl, isShareCode, shareableData, shortShareUrl } from "./share";
import { asPlayerLoadout, parseSavedLoadoutData, type SavedLoadoutData } from "./types";

/** Why a short link didn't open: it isn't stored, its loadout doesn't parse, or the server or network failed. */
export type ShareFetchFailure = "missing" | "unreadable" | "unavailable";

const FAILURE_MESSAGES: Record<ShareFetchFailure, string> = {
  missing: "That share link doesn't exist",
  unreadable: "That share link can't be read",
  unavailable: "Couldn't open the share link. Reload to try again.",
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
  const data = asPlayerLoadout(parseSavedLoadoutData(body?.loadout));
  if (!data) throw new ShareFetchError("unreadable");
  return data;
}

const UNAVAILABLE = "Short links aren't available right now";

/** Stores a snapshot and returns its short link; rejects with the reason it couldn't. */
async function shortLink(origin: string, saved: SavedLoadoutData): Promise<string> {
  let res: Response;
  try {
    res = await fetch("/api/loadout-shares", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(shareableData(saved)),
    });
  } catch {
    throw new Error(UNAVAILABLE);
  }
  const body = (await res.json().catch(() => null)) as { code?: unknown; error?: unknown } | null;
  if (res.ok && isShareCode(body?.code)) return shortShareUrl(origin, body.code);
  // The daily limit is the account's to know about, not a passing outage.
  throw new Error(res.status === 409 && typeof body?.error === "string" ? body.error : UNAVAILABLE);
}

/**
 * Copy a share link for `saved`. Prefers the short link; if it can't be stored, copies
 * the long self-contained one instead. Resolves to null when the short link was copied,
 * or to why it wasn't.
 *
 * Safari only lets the clipboard be written during the click, so the link is handed
 * over as a promise (ClipboardItem) rather than written after the request returns.
 */
export async function copyShareLink(origin: string, saved: SavedLoadoutData): Promise<string | null> {
  const link = shortLink(origin, saved).then(
    (url) => ({ url, longBecause: null }),
    (err: Error) => ({ url: buildShareUrl(origin, saved), longBecause: err.message }),
  );
  if (typeof ClipboardItem !== "undefined") {
    try {
      const text = link.then(({ url }) => new Blob([url], { type: "text/plain" }));
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": text })]);
      return (await link).longBecause;
    } catch {
      // Older engines refuse a promised item; fall back to writing the text.
    }
  }
  const { url, longBecause } = await link;
  await navigator.clipboard.writeText(url);
  return longBecause;
}
