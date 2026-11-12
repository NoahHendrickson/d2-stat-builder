import { afterEach, describe, expect, it, vi } from "vitest";

const manifest = vi.hoisted(() => ({ version: "v1" }));
vi.mock("bungie-api-ts/destiny2", () => ({
  getDestinyManifest: vi.fn(async () => ({
    Response: { version: manifest.version, jsonWorldComponentContentPaths: { en: {} } },
  })),
}));

vi.mock("./http", () => ({ createBungieHttp: vi.fn() }));

import { perManifestVersion } from "./manifest-tables";

afterEach(() => vi.useRealTimers());

describe("perManifestVersion", () => {
  it("shares one build, keeps it for the hour, and rebuilds only for a new version", async () => {
    vi.useFakeTimers();
    manifest.version = "v1";
    let builds = 0;
    const load = perManifestVersion(async () => ++builds);

    expect(await Promise.all([load(), load()])).toEqual([1, 1]);
    vi.advanceTimersByTime(2 * 60 * 60_000);
    expect(await load()).toBe(1); // same version: kept
    manifest.version = "v2";
    vi.advanceTimersByTime(2 * 60 * 60_000);
    expect(await load()).toBe(2);
  });

  it("doesn't keep a failed build", async () => {
    manifest.version = "v1";
    let calls = 0;
    const load = perManifestVersion(async () => {
      if (++calls === 1) throw new Error("down");
      return calls;
    });
    await expect(load()).rejects.toThrow("down");
    expect(await load()).toBe(2);
  });
});
