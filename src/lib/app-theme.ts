"use client";

import { useSyncExternalStore } from "react";
import { APP_THEME_KEY, DEFAULT_APP_THEME } from "@/lib/app-theme-script";

/**
 * The app's look, separate from next-themes' light/dark mode. `scene` is the
 * Destiny look over the blurred photo; `slate` is the same look over a flat
 * gradient (Figma 121:939); `normal` is a plain rounded UI on a flat page
 * (Figma 130:6188). globals.css keys everything off `data-app-theme` on <html>,
 * and components reach for the `normal:` variant where tokens can't.
 */
export const APP_THEMES = [
  { id: "scene", label: "Scene" },
  { id: "slate", label: "Slate" },
  { id: "normal", label: "Normal" },
] as const;

export type AppThemeId = (typeof APP_THEMES)[number]["id"];

export { DEFAULT_APP_THEME };

// Same module-store shape as site-icon: the server and the hydrating render see the
// default, then the client snapshot reads localStorage; other tabs follow via `storage`.
let themeValue: AppThemeId | null = null;
const listeners = new Set<() => void>();

function parseTheme(raw: string | null): AppThemeId {
  return APP_THEMES.find((t) => t.id === raw)?.id ?? DEFAULT_APP_THEME;
}

function getTheme(): AppThemeId {
  if (themeValue === null) {
    try {
      themeValue = parseTheme(localStorage.getItem(APP_THEME_KEY));
    } catch {
      themeValue = DEFAULT_APP_THEME;
    }
  }
  return themeValue;
}

function apply(id: AppThemeId) {
  const root = document.documentElement;
  // Scene is the look with no attribute (globals.css keys the others off it).
  if (id === "scene") delete root.dataset.appTheme;
  else root.dataset.appTheme = id;
}

function onStorage(e: StorageEvent) {
  if (e.key !== APP_THEME_KEY) return;
  themeValue = parseTheme(e.newValue);
  apply(themeValue);
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

export function setAppTheme(id: string): void {
  themeValue = parseTheme(id);
  apply(themeValue);
  try {
    localStorage.setItem(APP_THEME_KEY, themeValue);
  } catch {
    // Persistence is best-effort — quota / privacy modes are ignored.
  }
  for (const l of listeners) l();
}

export function useAppTheme(): AppThemeId {
  return useSyncExternalStore(subscribe, getTheme, () => DEFAULT_APP_THEME);
}
