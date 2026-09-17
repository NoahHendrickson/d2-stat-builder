"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  DEFAULT_SKIN,
  SKIN_ATTRIBUTE,
  SKIN_STORAGE_KEY,
  isSkin,
  type Skin,
} from "@/lib/skin";

const listeners = new Set<() => void>();

function readSkin(): Skin {
  const current = document.documentElement.getAttribute(SKIN_ATTRIBUTE);
  return isSkin(current) ? current : DEFAULT_SKIN;
}

function applySkin(skin: Skin) {
  document.documentElement.setAttribute(SKIN_ATTRIBUTE, skin);
  try {
    localStorage.setItem(SKIN_STORAGE_KEY, skin);
  } catch {
    // Storage may be unavailable (private mode); the skin still applies for this page.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Follow another tab switching skins.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== SKIN_STORAGE_KEY) return;
    if (isSkin(event.newValue)) {
      document.documentElement.setAttribute(SKIN_ATTRIBUTE, event.newValue);
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * The active skin and a setter. Reads `<html data-skin>`, which the inline
 * bootstrap script sets before hydration, so the server snapshot (the default)
 * only shows until the first client render.
 */
export function useSkin(): { skin: Skin; setSkin: (skin: Skin) => void } {
  const skin = useSyncExternalStore(subscribe, readSkin, () => DEFAULT_SKIN);
  const setSkin = useCallback((next: Skin) => applySkin(next), []);
  return { skin, setSkin };
}
