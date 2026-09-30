"use client";

import { useSyncExternalStore } from "react";

/** The pixel-art exotic icons offered as the tab icon and sidebar logo (Figma 217:5013). */
export const SITE_ICONS = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({
  id: `icon-${n}`,
  src: `/favicons/icon-${n}.svg`,
}));

/** icon-2 is the one shipped as src/app/icon.svg. */
export const DEFAULT_SITE_ICON = "icon-2";

const SITE_ICON_KEY = "stat-builder:site-icon";

// Same module-store shape as use-links: the server and the hydrating render see the
// default, then the client snapshot reads localStorage; other tabs follow via `storage`.
let iconValue: string | null = null;
const listeners = new Set<() => void>();

function parseIcon(raw: string | null): string {
  return SITE_ICONS.some((i) => i.id === raw) ? (raw as string) : DEFAULT_SITE_ICON;
}

function getIcon(): string {
  if (iconValue === null) {
    try {
      iconValue = parseIcon(localStorage.getItem(SITE_ICON_KEY));
    } catch {
      iconValue = DEFAULT_SITE_ICON;
    }
  }
  return iconValue;
}

function onStorage(e: StorageEvent) {
  if (e.key !== SITE_ICON_KEY) return;
  iconValue = parseIcon(e.newValue);
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

export function setSiteIcon(id: string): void {
  iconValue = parseIcon(id);
  try {
    localStorage.setItem(SITE_ICON_KEY, iconValue);
  } catch {
    // Persistence is best-effort — quota / privacy modes are ignored.
  }
  for (const l of listeners) l();
}

export function useSiteIcon(): { id: string; src: string } {
  const id = useSyncExternalStore(subscribe, getIcon, () => DEFAULT_SITE_ICON);
  return SITE_ICONS.find((i) => i.id === id) ?? SITE_ICONS[1];
}
