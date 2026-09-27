import { normalizeLinkUrl } from "@/lib/links/links";

// Favicons for the sidebar's saved links. The CSP only allows same-origin images, so
// this proxies Google's favicon service rather than letting the page load third-party
// hosts. The server only ever contacts gstatic — never the saved URL itself — so a
// link can't make it fetch internal addresses. The service resolves the full URL, not
// just the host: a Google Sheet gets the Sheets icon, a Doc the Docs icon.
const FAVICON_SERVICE = "https://t0.gstatic.com/faviconV2";
const MAX_URL_LENGTH = 2048;
const ONE_WEEK_S = 60 * 60 * 24 * 7;

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("url");
  const target = raw && raw.length <= MAX_URL_LENGTH ? normalizeLinkUrl(raw) : null;
  if (!target) return new Response(null, { status: 400 });

  const upstream = new URL(FAVICON_SERVICE);
  upstream.searchParams.set("client", "SOCIAL");
  upstream.searchParams.set("type", "FAVICON");
  upstream.searchParams.set("fallback_opts", "TYPE,SIZE,URL");
  upstream.searchParams.set("size", "64");
  upstream.searchParams.set("url", target);

  let res: Response;
  try {
    res = await fetch(upstream, { signal: AbortSignal.timeout(5000) });
  } catch {
    return new Response(null, { status: 502 });
  }
  // The service answers unknown sites with a 404 and a generic globe; pass the 404
  // on so the client shows its own fallback. Cache misses briefly, hits for a week.
  const contentType = res.headers.get("content-type") ?? "";
  if (!res.ok || !contentType.startsWith("image/")) {
    return new Response(null, {
      status: 404,
      headers: { "Cache-Control": "public, max-age=3600" },
    });
  }
  return new Response(await res.arrayBuffer(), {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": `public, max-age=${ONE_WEEK_S}, stale-while-revalidate=${ONE_WEEK_S}`,
    },
  });
}
