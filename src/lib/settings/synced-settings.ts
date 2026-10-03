"use client";

// Client side of account-synced settings (see keys.ts). Each value lives in
// localStorage, so pages read it instantly and it works signed out. When signed in,
// SettingsSync pulls the account's copy (on load and on window focus) and `reconcile`
// settles each key; local edits are pushed back shortly after they happen.
//
// Per key, the sync metadata (also in localStorage, so it survives reloads and is
// shared between tabs) records whether there are unpushed edits (`dirty`) and the
// server time of the account copy this browser last matched (`syncedAt`):
//   - never synced here: merge local and account lists (neither computer loses data);
//   - unpushed edits: push them (last write wins);
//   - account copy newer than `syncedAt`: adopt it.
import { useSyncExternalStore } from "react";
import { SELECTIONS_KEY } from "../builder/selection-storage";
import {
  SETTING_KEYS,
  mergeSettingValues,
  parseSettingValue,
  type SettingKey,
  type SettingValues,
  type StoredSettings,
} from "./keys";

const STORAGE_KEYS: Record<SettingKey, string> = {
  links: "stat-builder:links",
  pinnedSets: "stat-builder:pinned-sets",
};
const META_KEY = "stat-builder:settings-sync";
/** Edits are pushed this long after the last one, so a burst of pins is one write. */
const PUSH_DELAY_MS = 500;

interface KeyMeta {
  dirty: boolean;
  syncedAt: number | null;
}
interface SyncMeta {
  account: string | null;
  keys: Partial<Record<SettingKey, KeyMeta>>;
}

const EMPTY: never[] = [];

function storage(): Storage | undefined {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage;
  } catch {
    return undefined;
  }
}

function readJson(key: string): unknown {
  const raw = storage()?.getItem(key);
  if (raw == null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    storage()?.setItem(key, JSON.stringify(value));
  } catch {
    // Persistence is best-effort — quota / privacy modes are ignored.
  }
}

// ---- values -------------------------------------------------------------------------

const values: Partial<SettingValues> = {};
const listeners: Record<SettingKey, Set<() => void>> = {
  links: new Set(),
  pinnedSets: new Set(),
};
/** Bumped on every local edit in this tab: tells a finished push whether it was the last. */
const localVersion: Record<SettingKey, number> = { links: 0, pinnedSets: 0 };

function readLocal<K extends SettingKey>(key: K): SettingValues[K] {
  let stored = readJson(STORAGE_KEYS[key]);
  // Pins used to live inside the builder's selections blob. Copy them out once, and
  // write them straight back under their own key: the builder no longer saves them,
  // so its next save would otherwise drop the only copy.
  if (stored === undefined && key === "pinnedSets") {
    const sel = readJson(SELECTIONS_KEY);
    const old = sel && typeof sel === "object" ? (sel as { pinnedSets?: unknown }).pinnedSets : null;
    const pins = parseSettingValue("pinnedSets", old);
    if (pins?.length) writeJson(STORAGE_KEYS.pinnedSets, pins);
    stored = pins ?? undefined;
  }
  return parseSettingValue(key, stored) ?? (EMPTY as SettingValues[K]);
}

export function getSetting<K extends SettingKey>(key: K): SettingValues[K] {
  if (!(key in values)) values[key] = readLocal(key);
  return values[key] as SettingValues[K];
}

function notify(key: SettingKey) {
  for (const l of listeners[key]) l();
}

/** Write a value locally without touching the sync state (adopting the account's copy). */
function storeLocal<K extends SettingKey>(key: K, value: SettingValues[K]) {
  values[key] = value;
  writeJson(STORAGE_KEYS[key], value);
  notify(key);
}

/** A local edit: saved here at once, pushed to the account shortly after. */
export function setSetting<K extends SettingKey>(key: K, value: SettingValues[K]): void {
  localVersion[key]++;
  storeLocal(key, value);
  setKeyMeta(key, { ...keyMeta(key), dirty: true });
  schedulePush(key);
}

function onStorage(e: StorageEvent) {
  if (e.key === null) {
    // localStorage.clear() in another tab.
    for (const key of SETTING_KEYS) {
      delete values[key];
      notify(key);
    }
    return;
  }
  const key = SETTING_KEYS.find((k) => STORAGE_KEYS[k] === e.key);
  if (!key) return;
  delete values[key];
  notify(key);
}

function subscribe(key: SettingKey, listener: () => void): () => void {
  const total = () => SETTING_KEYS.reduce((n, k) => n + listeners[k].size, 0);
  if (total() === 0) window.addEventListener("storage", onStorage);
  listeners[key].add(listener);
  return () => {
    listeners[key].delete(listener);
    if (total() === 0) window.removeEventListener("storage", onStorage);
  };
}

const subscribers = Object.fromEntries(
  SETTING_KEYS.map((k) => [k, (l: () => void) => subscribe(k, l)]),
) as Record<SettingKey, (l: () => void) => () => void>;
const getters = Object.fromEntries(
  SETTING_KEYS.map((k) => [k, () => getSetting(k)]),
) as { [K in SettingKey]: () => SettingValues[K] };

/**
 * A synced setting. The server and the hydrating render see an empty list; the client
 * snapshot then reads localStorage. Other tabs' writes arrive through `storage`.
 */
export function useSetting<K extends SettingKey>(key: K): SettingValues[K] {
  return useSyncExternalStore(
    subscribers[key],
    getters[key] as () => SettingValues[K],
    () => EMPTY as SettingValues[K],
  );
}

// ---- sync metadata ------------------------------------------------------------------

function loadMeta(): SyncMeta {
  const raw = readJson(META_KEY);
  if (!raw || typeof raw !== "object") return { account: null, keys: {} };
  const o = raw as Partial<SyncMeta>;
  return {
    account: typeof o.account === "string" ? o.account : null,
    keys: o.keys && typeof o.keys === "object" ? o.keys : {},
  };
}

function keyMeta(key: SettingKey): KeyMeta {
  const m = loadMeta().keys[key];
  return {
    dirty: m?.dirty === true,
    syncedAt: typeof m?.syncedAt === "number" ? m.syncedAt : null,
  };
}

function setKeyMeta(key: SettingKey, next: KeyMeta) {
  const meta = loadMeta();
  writeJson(META_KEY, { ...meta, keys: { ...meta.keys, [key]: next } });
}

// ---- pushing ------------------------------------------------------------------------

/** The signed-in account, set by SettingsSync. Null = signed out: edits stay local. */
let account: string | null = null;
const pushTimers = new Map<SettingKey, ReturnType<typeof setTimeout>>();
/** Pushes for a key run one at a time, so an older value can't land after a newer one. */
const pushChains = new Map<SettingKey, Promise<void>>();

function schedulePush(key: SettingKey) {
  if (!account) return;
  clearTimeout(pushTimers.get(key));
  pushTimers.set(
    key,
    setTimeout(() => queuePush(key), PUSH_DELAY_MS),
  );
}

function queuePush(key: SettingKey, keepalive = false): Promise<void> {
  clearTimeout(pushTimers.get(key));
  pushTimers.delete(key);
  const next = (pushChains.get(key) ?? Promise.resolve()).then(() => push(key, keepalive));
  pushChains.set(key, next);
  void next.finally(() => {
    if (pushChains.get(key) === next) pushChains.delete(key);
  });
  return next;
}

async function push(key: SettingKey, keepalive: boolean): Promise<void> {
  const acct = account;
  if (!acct) return;
  const version = localVersion[key];
  try {
    const res = await fetch(`/api/settings/${key}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: getSetting(key) }),
      cache: "no-store",
      keepalive,
    });
    // A failure leaves the key dirty; the next pull (focus / reload) pushes again.
    if (!res.ok) return;
    const { updatedAt } = (await res.json()) as { updatedAt: number };
    if (account !== acct || typeof updatedAt !== "number") return;
    // Edited again while this was in flight: still dirty, and that edit's push is queued.
    setKeyMeta(key, { dirty: localVersion[key] !== version, syncedAt: updatedAt });
  } catch {
    // Offline / navigated away — same as a failure.
  }
}

/** Send any edits still waiting out their delay now (the page is going away). */
export function flushSettingPushes(): void {
  for (const key of [...pushTimers.keys()]) void queuePush(key, true);
}

// ---- reconciling --------------------------------------------------------------------

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Sign-in state from SettingsSync. Signing out stops pushes; local values stay. */
export function setSyncAccount(membershipId: string | null): void {
  account = membershipId;
  if (!membershipId) {
    for (const t of pushTimers.values()) clearTimeout(t);
    pushTimers.clear();
  }
}

/** Settle every key against the account's stored copy. Resolves when pushes finish. */
export async function reconcileSettings(
  membershipId: string,
  server: StoredSettings,
): Promise<void> {
  setSyncAccount(membershipId);
  const meta = loadMeta();
  if (meta.account !== membershipId) {
    // First sync for this account in this browser: start every key from "never synced",
    // keeping the dirty flags so signed-out edits still count as edits.
    writeJson(META_KEY, {
      account: membershipId,
      keys: Object.fromEntries(
        SETTING_KEYS.map((k) => [k, { dirty: meta.keys[k]?.dirty === true, syncedAt: null }]),
      ),
    });
  }

  const pushes: Promise<void>[] = [];
  for (const key of SETTING_KEYS) {
    const m = keyMeta(key);
    const remote = server[key];
    const local = getSetting(key);
    if (!remote) {
      if (local.length || m.dirty) pushes.push(queuePush(key));
      continue;
    }
    if (m.syncedAt === null) {
      const merged = mergeSettingValues(key, local, remote.value as typeof local);
      if (same(merged, remote.value)) {
        if (!same(local, merged)) storeLocal(key, merged);
        setKeyMeta(key, { dirty: false, syncedAt: remote.updatedAt });
      } else {
        localVersion[key]++;
        storeLocal(key, merged);
        setKeyMeta(key, { dirty: true, syncedAt: null });
        pushes.push(queuePush(key));
      }
    } else if (m.dirty) {
      pushes.push(queuePush(key));
    } else if (remote.updatedAt > m.syncedAt) {
      if (!same(local, remote.value)) storeLocal(key, remote.value as typeof local);
      setKeyMeta(key, { dirty: false, syncedAt: remote.updatedAt });
    }
  }
  await Promise.all(pushes);
}

/** Test hook: forget in-memory state so the next read comes from storage. */
export function resetSyncedSettingsForTests(): void {
  for (const key of SETTING_KEYS) {
    delete values[key];
    localVersion[key] = 0;
  }
  setSyncAccount(null);
  pushChains.clear();
}
