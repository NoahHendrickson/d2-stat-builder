import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { SELECTIONS_KEY } from "../builder/selection-storage";
import { mergeSettingValues, parseSettingValue, type StoredSettings } from "./keys";
import {
  getSetting,
  reconcileSettings,
  resetSyncedSettingsForTests,
  setSetting,
  setSyncAccount,
} from "./synced-settings";

/** Minimal in-memory Storage so the node test env can exercise load/save I/O. */
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}

const link = (id: string, url: string) => ({ id, name: id, url });

/** Fake /api/settings/[key]: records PUTs and stamps them with an increasing clock. */
function stubServer() {
  const puts: { key: string; value: unknown }[] = [];
  let clock = 1000;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const key = url.split("/").pop()!;
      const { value } = JSON.parse(String(init?.body)) as { value: unknown };
      puts.push({ key, value });
      return new Response(JSON.stringify({ value, updatedAt: ++clock }), { status: 200 });
    }),
  );
  return puts;
}

beforeEach(() => {
  vi.stubGlobal("localStorage", new MemStorage());
  resetSyncedSettingsForTests();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("keys", () => {
  test("pinned sets keep positive integers, de-duplicated, in order", () => {
    expect(parseSettingValue("pinnedSets", [3, "x", 1, 3, -2, 1.5, 2])).toEqual([3, 1, 2]);
    expect(parseSettingValue("pinnedSets", { a: 1 })).toBeNull();
  });

  test("links drop entries that aren't safe http(s) URLs", () => {
    expect(
      parseSettingValue("links", [
        link("a", "https://example.com/"),
        link("b", "javascript:alert(1)"),
        { id: 1 },
      ]),
    ).toEqual([link("a", "https://example.com/")]);
  });

  test("first-sync merge: the account's list leads, local extras follow", () => {
    expect(mergeSettingValues("pinnedSets", [5, 1, 9], [1, 2])).toEqual([1, 2, 5, 9]);
    const merged = mergeSettingValues(
      "links",
      [link("x", "https://a.com/"), link("s", "https://b.com/")],
      [link("s", "https://a.com/")],
    );
    expect(merged.map((l) => l.url)).toEqual(["https://a.com/", "https://b.com/"]);
    // A local link whose id collides with an account link gets a fresh id.
    expect(new Set(merged.map((l) => l.id)).size).toBe(2);
  });
});

describe("reconcile", () => {
  test("pins move out of the old selections blob, once", () => {
    localStorage.setItem(SELECTIONS_KEY, JSON.stringify({ pinnedSets: [7, 8] }));
    expect(getSetting("pinnedSets")).toEqual([7, 8]);
    localStorage.setItem(SELECTIONS_KEY, JSON.stringify({}));
    resetSyncedSettingsForTests();
    expect(getSetting("pinnedSets")).toEqual([7, 8]);
  });

  test("an empty account gets this browser's values", async () => {
    const puts = stubServer();
    setSetting("pinnedSets", [4]);
    await reconcileSettings("me", {});
    expect(puts).toEqual([{ key: "pinnedSets", value: [4] }]);
  });

  test("a new browser merges with the account and pushes the union", async () => {
    const puts = stubServer();
    setSetting("pinnedSets", [4]);
    await reconcileSettings("me", { pinnedSets: { value: [1], updatedAt: 500 } });
    expect(getSetting("pinnedSets")).toEqual([1, 4]);
    expect(puts).toEqual([{ key: "pinnedSets", value: [1, 4] }]);
  });

  test("a synced browser adopts a newer account copy, including removals", async () => {
    stubServer();
    await reconcileSettings("me", { pinnedSets: { value: [1, 2], updatedAt: 500 } });
    expect(getSetting("pinnedSets")).toEqual([1, 2]);
    await reconcileSettings("me", { pinnedSets: { value: [2], updatedAt: 600 } });
    expect(getSetting("pinnedSets")).toEqual([2]);
  });

  test("unpushed local edits win over the account copy", async () => {
    const puts = stubServer();
    await reconcileSettings("me", { pinnedSets: { value: [1], updatedAt: 500 } });
    setSyncAccount(null); // edited while signed out: nothing is pushed yet
    setSetting("pinnedSets", []);
    expect(puts).toEqual([]);
    const server: StoredSettings = { pinnedSets: { value: [1], updatedAt: 500 } };
    await reconcileSettings("me", server);
    expect(getSetting("pinnedSets")).toEqual([]);
    expect(puts).toEqual([{ key: "pinnedSets", value: [] }]);
  });

  test("an edit while signed in is pushed after a short delay, then counts as synced", async () => {
    vi.useFakeTimers();
    const puts = stubServer();
    await reconcileSettings("me", { pinnedSets: { value: [1], updatedAt: 500 } });
    setSetting("pinnedSets", [1, 3]);
    setSetting("pinnedSets", [1, 3, 5]);
    await vi.runAllTimersAsync();
    expect(puts).toEqual([{ key: "pinnedSets", value: [1, 3, 5] }]);
    // The account copy we just wrote isn't "newer": nothing to adopt or push.
    await reconcileSettings("me", { pinnedSets: { value: [1, 3, 5], updatedAt: 1001 } });
    expect(puts).toHaveLength(1);
  });

  test("a failed push stays dirty and is retried on the next pull", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 502 })));
    await reconcileSettings("me", { pinnedSets: { value: [1], updatedAt: 500 } });
    setSetting("pinnedSets", [9]);
    await vi.runAllTimersAsync();
    const puts = stubServer();
    await reconcileSettings("me", { pinnedSets: { value: [1], updatedAt: 500 } });
    expect(puts).toEqual([{ key: "pinnedSets", value: [9] }]);
    expect(getSetting("pinnedSets")).toEqual([9]);
  });

  test("another tab's edit during a push keeps the key dirty", async () => {
    vi.useFakeTimers();
    await reconcileSettings("me", { pinnedSets: { value: [1], updatedAt: 500 } });
    // Tab A pushes [1, 2]; its response is held back.
    let respond!: () => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((resolve) => {
            const { value } = JSON.parse(String(init?.body)) as { value: unknown };
            respond = () => resolve(new Response(JSON.stringify({ value, updatedAt: 600 }), { status: 200 }));
          }),
      ),
    );
    setSetting("pinnedSets", [1, 2]);
    await vi.advanceTimersByTimeAsync(1000);
    // Tab B (its own module copy, same storage) edits, and its push fails.
    vi.resetModules();
    const tabB = await import("./synced-settings");
    const failing = vi.fn(async () => new Response("{}", { status: 502 }));
    vi.stubGlobal("fetch", failing);
    tabB.setSyncAccount("me");
    tabB.setSetting("pinnedSets", [1, 2, 3]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(failing).toHaveBeenCalled();
    // A's older response lands: B's edit must still go up on the next pull.
    respond();
    await vi.runAllTimersAsync();
    resetSyncedSettingsForTests();
    const puts = stubServer();
    await reconcileSettings("me", { pinnedSets: { value: [1, 2], updatedAt: 600 } });
    expect(puts).toEqual([{ key: "pinnedSets", value: [1, 2, 3] }]);
  });
});
