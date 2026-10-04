"use client";

import { Analytics as VercelAnalytics, type BeforeSendEvent } from "@vercel/analytics/next";

/**
 * A share link carries the whole loadout in `?import=` (name, notes, item ids). Page
 * views still count; the payload just never reaches Vercel's analytics.
 */
function dropSharePayload(event: BeforeSendEvent): BeforeSendEvent {
  const url = new URL(event.url);
  if (!url.searchParams.has("import")) return event;
  url.searchParams.delete("import");
  return { ...event, url: url.toString() };
}

export function Analytics() {
  return <VercelAnalytics beforeSend={dropSharePayload} />;
}
