"use client";

// Whether this device records optimizer searches into the armor usage history. Kept
// per device like the rest of Settings; on unless turned off.
import { useSyncExternalStore } from "react";

const KEY = "stat-builder:record-build-usage";
const listeners = new Set<() => void>();
let value: boolean | null = null;

function read(): boolean {
  if (value === null) {
    try {
      value = localStorage.getItem(KEY) !== "off";
    } catch {
      value = true;
    }
  }
  return value;
}

function onStorage(e: StorageEvent) {
  if (e.key !== KEY) return;
  value = e.newValue !== "off";
  for (const l of listeners) l();
}

export function subscribeBuildUsageRecording(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

export const isBuildUsageRecording = read;

export function setBuildUsageRecording(on: boolean) {
  value = on;
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // Persistence is best-effort — the choice still holds for this session.
  }
  for (const l of listeners) l();
}

export function useBuildUsageRecording(): boolean {
  return useSyncExternalStore(subscribeBuildUsageRecording, read, () => true);
}
