"use client";

import { getSetting, setSetting, useSetting } from "../settings/synced-settings";
import type { SavedLink } from "./links";

// Stored and synced to the account by synced-settings.ts.

export function useLinks(): SavedLink[] {
  return useSetting("links");
}

export function addLink(link: Omit<SavedLink, "id">): void {
  setSetting("links", [...getSetting("links"), { ...link, id: crypto.randomUUID() }]);
}

export function updateLink(id: string, patch: Omit<SavedLink, "id">): void {
  setSetting(
    "links",
    getSetting("links").map((l) => (l.id === id ? { ...l, ...patch } : l)),
  );
}

export function removeLink(id: string): void {
  setSetting(
    "links",
    getSetting("links").filter((l) => l.id !== id),
  );
}
