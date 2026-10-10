"use client";

// Tags and notes on items (DIM's Favorite / Keep / Junk / Infuse / Archive and free-text
// notes), keyed by item instance id and kept in localStorage per Bungie account.
// Best-effort like the other local stores: bad data reads as empty, I/O never throws,
// and another tab's edits arrive through the `storage` event.
import { useSyncExternalStore } from "react";
import { createValueStore } from "@/lib/value-store";

export const ITEM_TAGS = ["favorite", "keep", "junk", "infuse", "archive"] as const;
export type ItemTag = (typeof ITEM_TAGS)[number];

export const TAG_LABELS: Record<ItemTag, string> = {
  favorite: "Favorite",
  keep: "Keep",
  junk: "Junk",
  infuse: "Infuse",
  archive: "Archive",
};

export interface Annotation {
  tag?: ItemTag;
  notes?: string;
}
export type Annotations = Readonly<Record<string, Annotation>>;

const KEY_PREFIX = "stat-builder:item-annotations:v1:";
const EMPTY: Annotations = {};

export const annotationsStore = createValueStore<Annotations>(EMPTY);
let membership: string | undefined;

export function isItemTag(v: unknown): v is ItemTag {
  return typeof v === "string" && (ITEM_TAGS as readonly string[]).includes(v);
}

/** Keep only well-formed entries; anything else in storage is dropped. */
export function parseAnnotations(raw: string | null): Annotations {
  if (!raw) return EMPTY;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return EMPTY;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return EMPTY;
  const out: Record<string, Annotation> = {};
  for (const [id, value] of Object.entries(data as Record<string, unknown>)) {
    const v = value as Partial<Record<keyof Annotation, unknown>> | null;
    if (!v || typeof v !== "object") continue;
    const entry: Annotation = {};
    if (isItemTag(v.tag)) entry.tag = v.tag;
    if (typeof v.notes === "string" && v.notes.trim()) entry.notes = v.notes;
    if (entry.tag || entry.notes) out[id] = entry;
  }
  return out;
}

function read(id: string): Annotations {
  try {
    return parseAnnotations(localStorage.getItem(KEY_PREFIX + id));
  } catch {
    return EMPTY;
  }
}

function write(next: Annotations) {
  annotationsStore.set(next);
  if (!membership) return;
  try {
    localStorage.setItem(KEY_PREFIX + membership, JSON.stringify(next));
  } catch {
    // Storage full or blocked: the tags still hold for this session.
  }
}

/** Point the store at an account's annotations (and follow other tabs' edits to them). */
export function loadAnnotations(membershipId: string | undefined): () => void {
  membership = membershipId;
  annotationsStore.set(membershipId ? read(membershipId) : EMPTY);
  if (!membershipId) return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY_PREFIX + membershipId) annotationsStore.set(parseAnnotations(e.newValue));
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

/** Apply `patch` to each instance id's annotation, dropping entries left empty. */
export function updateAnnotations(
  current: Annotations,
  instanceIds: readonly string[],
  patch: Annotation,
): Annotations {
  const next: Record<string, Annotation> = { ...current };
  for (const id of instanceIds) {
    const entry: Annotation = { ...next[id], ...patch };
    if (!entry.tag) delete entry.tag;
    if (!entry.notes?.trim()) delete entry.notes;
    if (entry.tag || entry.notes) next[id] = entry;
    else delete next[id];
  }
  return next;
}

/** Tag (or with `undefined`, untag) every item in `instanceIds`. */
export function setTag(instanceIds: readonly string[], tag: ItemTag | undefined) {
  write(updateAnnotations(annotationsStore.get(), instanceIds, { tag }));
}

export function setNotes(instanceId: string, notes: string) {
  write(updateAnnotations(annotationsStore.get(), [instanceId], { notes }));
}

/** One item's annotation; re-renders only when that item's entry changes. */
export function useAnnotation(instanceId: string | undefined): Annotation | undefined {
  const get = () => (instanceId ? annotationsStore.get()[instanceId] : undefined);
  return useSyncExternalStore(annotationsStore.subscribe, get, () => undefined);
}
