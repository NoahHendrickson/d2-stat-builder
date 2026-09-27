"use client";

import { useSyncExternalStore } from "react";
import { parseStoredLinks, type SavedLink } from "./links";

const LINKS_KEY = "stat-builder:links";

// Module store read through useSyncExternalStore: the server and the hydrating render
// see no links, then the client snapshot reads localStorage lazily. Other tabs'
// writes arrive through the `storage` event.
let linksValue: SavedLink[] | null = null;
const listeners = new Set<() => void>();
const EMPTY: SavedLink[] = [];

function getLinks(): SavedLink[] {
  if (linksValue === null) {
    try {
      linksValue = parseStoredLinks(localStorage.getItem(LINKS_KEY));
    } catch {
      linksValue = [];
    }
  }
  return linksValue;
}

function onStorage(e: StorageEvent) {
  if (e.key !== LINKS_KEY) return;
  linksValue = parseStoredLinks(e.newValue);
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

function setLinks(next: SavedLink[]): void {
  linksValue = next;
  try {
    localStorage.setItem(LINKS_KEY, JSON.stringify(next));
  } catch {
    // Persistence is best-effort — quota / privacy modes are ignored.
  }
  for (const l of listeners) l();
}

export function useLinks(): SavedLink[] {
  return useSyncExternalStore(subscribe, getLinks, () => EMPTY);
}

export function addLink(link: Omit<SavedLink, "id">): void {
  setLinks([...getLinks(), { ...link, id: crypto.randomUUID() }]);
}

export function updateLink(id: string, patch: Omit<SavedLink, "id">): void {
  setLinks(getLinks().map((l) => (l.id === id ? { ...l, ...patch } : l)));
}

export function removeLink(id: string): void {
  setLinks(getLinks().filter((l) => l.id !== id));
}
