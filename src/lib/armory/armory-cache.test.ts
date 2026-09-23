import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, unknown>();
vi.mock("idb", () => ({
  openDB: async () => ({
    get: async (_s: string, key: string) => store.get(key),
    put: async (_s: string, value: unknown, key: string) => {
      store.set(key, value);
    },
    clear: async () => store.clear(),
  }),
}));

const { ARMORY_CACHE_TTL_MS, clearArmoryCache, persistArmoryWhenIdle, readArmoryCache, writeArmoryCache } = await import("./armory-cache");
const armory = { pieces: [], characters: [] };

describe("armory cache", () => {
  beforeEach(() => store.clear());

  it("round-trips an entry per account and ignores one past the TTL", async () => {
    await writeArmoryCache("me", { manifestVersion: "v1", savedAt: 1_000, armory });
    expect(await readArmoryCache("me", 2_000)).toEqual({ manifestVersion: "v1", savedAt: 1_000, armory });
    expect(await readArmoryCache("someone-else", 2_000)).toBeNull();
    expect(await readArmoryCache("me", 1_000 + ARMORY_CACHE_TTL_MS + 1)).toBeNull();
  });

  it("a deferred write queued before a clear is dropped, one queued after it lands", async () => {
    vi.useFakeTimers();
    try {
      persistArmoryWhenIdle("me", { manifestVersion: "v1", savedAt: 5, armory });
      await clearArmoryCache(); // the session ended while the write was queued
      await vi.runAllTimersAsync();
      expect(store.size).toBe(0);

      persistArmoryWhenIdle("me", { manifestVersion: "v1", savedAt: 6, armory });
      await vi.runAllTimersAsync();
      expect((store.get("me") as { savedAt: number }).savedAt).toBe(6);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears every account", async () => {
    await writeArmoryCache("a", { manifestVersion: "v1", savedAt: 1, armory });
    await writeArmoryCache("b", { manifestVersion: "v1", savedAt: 1, armory });
    await clearArmoryCache();
    expect(await readArmoryCache("a", 2)).toBeNull();
    expect(await readArmoryCache("b", 2)).toBeNull();
  });
});
