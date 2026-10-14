import { afterEach, describe, expect, it, vi } from "vitest";
import type { DestinyProfileResponse } from "bungie-api-ts/destiny2";
import { ArmoryError, fetchProfile } from "./fetch";

const held = {
  responseMintedTimestamp: "2026-10-02T15:00:10Z",
  secondaryComponentsMintedTimestamp: "2026-10-02T15:00:12Z",
} as DestinyProfileResponse;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchProfile", () => {
  it("sends the held profile's stamps and keeps it on a 304", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 304 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchProfile(held)).toBe(held);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["If-None-Match"]).toBe(
      '"2026-10-02T15:00:10Z|2026-10-02T15:00:12Z"',
    );
  });

  it("sends no validator and parses the body when nothing is held", async () => {
    const fresh = { ...held, responseMintedTimestamp: "2026-10-02T15:01:00Z" };
    const fetchMock = vi.fn(async () => Response.json(fresh));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchProfile()).toEqual(fresh);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toEqual({});
  });

  it("still surfaces errors with their status", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ error: "Session expired" }, { status: 401 }));
    await expect(fetchProfile(held)).rejects.toMatchObject({ status: 401, message: "Session expired" });
    await expect(fetchProfile(held)).rejects.toBeInstanceOf(ArmoryError);
  });
});
