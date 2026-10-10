import { NextResponse } from "next/server";

/**
 * Refuse a state-changing request that a browser sent from another site. SameSite=Lax
 * cookies already stop most of these, but on canary.noahjh.com every other noahjh.com
 * subdomain counts as same-site, and the routes parse a `text/plain` form post as JSON.
 *
 * Browsers mark every fetch with `Sec-Fetch-Site`; older ones only send `Origin`. A
 * request with neither didn't come from a browser page, so it carries no cookies a
 * page could have borrowed.
 */
export function rejectCrossSite(request: Request): NextResponse | null {
  if (isSameOrigin(request)) return null;
  return NextResponse.json({ error: "Cross-site request refused" }, { status: 403 });
}

export function isSameOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}
