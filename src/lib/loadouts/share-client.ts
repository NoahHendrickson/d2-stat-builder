// Browser side of share links: store a snapshot for a short link, and read one back.
import { buildShareUrl, isShareCode, shortShareUrl } from "./share";
import { parseSavedLoadoutData, type SavedLoadoutData } from "./types";

export class ShareFetchError extends Error {
  constructor(public readonly status: number) {
    super(status === 404 ? "That share link doesn't exist" : "Couldn't open the share link");
    this.name = "ShareFetchError";
  }
}

/** The loadout behind a short code. Throws ShareFetchError. */
export async function fetchShare(code: string): Promise<SavedLoadoutData> {
  const res = await fetch(`/api/loadout-shares/${encodeURIComponent(code)}`);
  if (!res.ok) throw new ShareFetchError(res.status);
  const body = (await res.json().catch(() => null)) as { loadout?: unknown } | null;
  const data = parseSavedLoadoutData(body?.loadout);
  if (!data) throw new ShareFetchError(422);
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
