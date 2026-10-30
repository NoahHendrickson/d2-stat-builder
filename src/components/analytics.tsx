"use client";

import { Analytics as VercelAnalytics, type BeforeSendEvent } from "@vercel/analytics/next";

/**
 * A share link carries the whole loadout (name, notes, item ids) in `#import=`, or
 * `?import=` for older links. Page views still count; the payload just never reaches
 * Vercel's analytics.
 */
function beforeSend(event: BeforeSendEvent): BeforeSendEvent | null {
  const url = new URL(event.url);
  // The component showcase framed on the portfolio: those are portfolio visitors, not
  // D2 Conflux ones, so they stay out of the visit counts.
  if (url.pathname === "/components/embed") return null;
  if (!url.searchParams.has("import") && !url.hash) return event;
  url.searchParams.delete("import");
  url.hash = "";
  return { ...event, url: url.toString() };
}

export function Analytics() {
  return <VercelAnalytics beforeSend={beforeSend} />;
}
