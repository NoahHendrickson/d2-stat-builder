import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MANIFEST_TABLES } from "./tables";

// In-memory stand-in for the IndexedDB cache.
const store = { version: undefined as string | undefined, tables: new Map<string, unknown>() };
vi.mock("./db", () => ({
  getCachedVersion: vi.fn(async () => store.version),
  getCachedTable: vi.fn(async (stamp: string, t: string) => store.tables.get(`${stamp}/${t}`)),
  setCachedTable: vi.fn(async (stamp: string, t: string, d: unknown) => {
    store.tables.set(`${stamp}/${t}`, d);
  }),
  commitVersion: vi.fn(async (stamp: string) => {
    for (const key of [...store.tables.keys()]) {
      if (!key.startsWith(`${stamp}/`)) store.tables.delete(key);
    }
    store.version = stamp;
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
const cachedTables = (stamp: string, tag: string) =>
  Object.fromEntries(MANIFEST_TABLES.map((t) => [`${stamp}/${t}`, { 1: { tag, t } }]));
const seedCache = (stamp: string, tag: string) => {
  store.version = stamp;
  for (const [k, d] of Object.entries(cachedTables(stamp, tag))) store.tables.set(k, d);
};

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
    seedCache(`v1:${REV}`, "cached");
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
    seedCache(`v1:${REV}`, "cached");
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
    // Commit dropped the old version's tables and kept only v2's.
    expect([...store.tables.keys()].every((k) => k.startsWith(`v2:${REV}/`))).toBe(true);
    expect(store.tables.size).toBe(MANIFEST_TABLES.length);
  });

  it("a revalidation that fails partway leaves the old cache intact and served", async () => {
    seedCache(`v1:${REV}`, "cached");
    getDestinyManifest.mockResolvedValue(info("v2"));
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("DestinyStatDefinition")) throw new Error("connection lost");
      return realFetch(url);
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onUpdate = vi.fn();

    const manifest = await loadManifest({ onUpdate });
    expect(manifest.version).toBe("v1");
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(onUpdate).not.toHaveBeenCalled();
    // Old stamp + tables untouched; the next load serves them again.
    expect(store.version).toBe(`v1:${REV}`);
    for (const t of MANIFEST_TABLES) expect(store.tables.get(`v1:${REV}/${t}`)).toBeDefined();
    getDestinyManifest.mockReturnValue(new Promise(() => {}));
    expect((await loadManifest()).all("DestinyStatDefinition")).toEqual({ 1: { tag: "cached", t: "DestinyStatDefinition" } });
    warn.mockRestore();
  });

  it("keeps serving the cache when the version check fails", async () => {
    seedCache(`v1:${REV}`, "cached");
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

  it("treats a cache from an older filter revision or a missing table as a miss, without reading tables", async () => {
    const { getCachedTable } = await import("./db");
    seedCache("v1:older-revision", "stale");
    getDestinyManifest.mockResolvedValue(info("v1"));
    expect((await loadManifest()).all("DestinyStatDefinition")).not.toEqual({ 1: { tag: "stale", t: "DestinyStatDefinition" } });
    expect(downloads).toHaveLength(MANIFEST_TABLES.length);
    // The revision check comes first: no stale table was deserialized.
    expect(vi.mocked(getCachedTable)).not.toHaveBeenCalledWith("v1:older-revision", expect.anything());

    downloads = [];
    store.tables.delete(`v1:${REV}/DestinyStatDefinition`);
    expect(store.version).toBe(`v1:${REV}`);
    await loadManifest();
    expect(downloads).toHaveLength(MANIFEST_TABLES.length);
  });

  it("only accepts a stamp whose revision suffix matches exactly", async () => {
    // A revision name that merely ends with the current one must not match.
    seedCache(`v1:x${REV}`, "stale");
    getDestinyManifest.mockResolvedValue(info("v1"));
    await loadManifest();
    expect(downloads).toHaveLength(MANIFEST_TABLES.length);
  });
});
