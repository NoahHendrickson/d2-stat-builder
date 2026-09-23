import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MANIFEST_TABLES } from "./tables";

// In-memory stand-in for the IndexedDB cache.
const store = { version: undefined as string | undefined, tables: new Map<string, unknown>() };
vi.mock("./db", () => ({
  getCachedVersion: vi.fn(async () => store.version),
  setCachedVersion: vi.fn(async (v: string) => {
    store.version = v;
  }),
  getCachedTable: vi.fn(async (t: string) => store.tables.get(t)),
  setCachedTable: vi.fn(async (t: string, d: unknown) => {
    store.tables.set(t, d);
  }),
  clearCache: vi.fn(async () => {
    store.version = undefined;
    store.tables.clear();
  }),
}));
vi.mock("@/lib/bungie/http", () => ({ createBungieHttp: () => ({}) }));
const getDestinyManifest = vi.fn();
vi.mock("bungie-api-ts/destiny2", async (importOriginal) => ({
  ...(await importOriginal<typeof import("bungie-api-ts/destiny2")>()),
  getDestinyManifest: (...args: unknown[]) => getDestinyManifest(...args),
}));

const { loadManifest } = await import("./load");

const REV = "item-def-projection-v1";
const info = (version: string) => ({
  Response: {
    version,
    jsonWorldComponentContentPaths: {
      en: Object.fromEntries(MANIFEST_TABLES.map((t) => [t, `/${version}/${t}.json`])),
    },
  },
});
const cachedTables = (tag: string) =>
  Object.fromEntries(MANIFEST_TABLES.map((t) => [t, { 1: { tag, t } }]));

let downloads: string[];
beforeEach(() => {
  store.version = undefined;
  store.tables.clear();
  downloads = [];
  getDestinyManifest.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      downloads.push(url);
      const table = url.slice(url.lastIndexOf("/") + 1, -".json".length);
      const body =
        table === "DestinyInventoryItemDefinition"
          ? { 5: { hash: 5, itemType: 2, classType: 0, redacted: false, displayProperties: { name: "Helm" }, investmentStats: [], perks: [] } }
          : table === "DestinyMaterialRequirementSetDefinition"
            ? { 9: { materials: [] } }
            : { 1: { from: url } };
      return { ok: true, json: async () => body } as Response;
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("loadManifest", () => {
  it("serves a complete cache immediately and skips the download when the version matches", async () => {
    store.version = `v1:${REV}`;
    for (const [t, d] of Object.entries(cachedTables("cached"))) store.tables.set(t, d);
    let resolveInfo!: (v: unknown) => void;
    getDestinyManifest.mockReturnValue(new Promise((r) => (resolveInfo = r)));
    const onUpdate = vi.fn();

    const manifest = await loadManifest({ onUpdate });
    expect(manifest.version).toBe("v1");
    expect(manifest.all("DestinyStatDefinition")).toEqual({ 1: { tag: "cached", t: "DestinyStatDefinition" } });

    resolveInfo(info("v1"));
    await flush();
    expect(downloads).toEqual([]);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("revalidates in the background and hands over the newer version", async () => {
    store.version = `v1:${REV}`;
    for (const [t, d] of Object.entries(cachedTables("cached"))) store.tables.set(t, d);
    getDestinyManifest.mockResolvedValue(info("v2"));
    const onUpdate = vi.fn();

    const manifest = await loadManifest({ onUpdate });
    expect(manifest.version).toBe("v1");
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    const fresh = onUpdate.mock.calls[0][0];
    expect(fresh.version).toBe("v2");
    expect(fresh.def("DestinyInventoryItemDefinition", 5)?.displayProperties.name).toBe("Helm");
    expect(store.version).toBe(`v2:${REV}`);
    expect(downloads).toHaveLength(MANIFEST_TABLES.length);
  });

  it("keeps serving the cache when the version check fails", async () => {
    store.version = `v1:${REV}`;
    for (const [t, d] of Object.entries(cachedTables("cached"))) store.tables.set(t, d);
    getDestinyManifest.mockRejectedValue(new Error("bungie down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onUpdate = vi.fn();

    const manifest = await loadManifest({ onUpdate });
    expect(manifest.version).toBe("v1");
    await flush();
    expect(onUpdate).not.toHaveBeenCalled();
    expect(downloads).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("downloads before returning when there is no cache", async () => {
    getDestinyManifest.mockResolvedValue(info("v3"));
    const progress: [string, number][] = [];
    const manifest = await loadManifest({ onProgress: (m, p) => progress.push([m, p]) });
    expect(manifest.version).toBe("v3");
    expect(downloads).toHaveLength(MANIFEST_TABLES.length);
    expect(store.version).toBe(`v3:${REV}`);
    expect(progress.at(-1)).toEqual(["Manifest ready", 1]);
    // The item table is stored projected.
    expect(manifest.def("DestinyInventoryItemDefinition", 5)).toEqual({
      hash: 5, itemType: 2, classType: 0, redacted: false,
      displayProperties: { name: "Helm" }, investmentStats: [], perks: [],
    });
  });

  it("treats a cache from an older filter revision or a missing table as a miss", async () => {
    store.version = "v1:older-revision";
    for (const [t, d] of Object.entries(cachedTables("stale"))) store.tables.set(t, d);
    getDestinyManifest.mockResolvedValue(info("v1"));
    expect((await loadManifest()).all("DestinyStatDefinition")).not.toEqual({ 1: { tag: "stale", t: "DestinyStatDefinition" } });
    expect(downloads).toHaveLength(MANIFEST_TABLES.length);

    downloads = [];
    store.tables.delete("DestinyStatDefinition");
    expect(store.version).toBe(`v1:${REV}`);
    await loadManifest();
    expect(downloads).toHaveLength(MANIFEST_TABLES.length);
  });
});
