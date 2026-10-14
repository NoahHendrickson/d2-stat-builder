import { afterEach, describe, expect, it, vi } from "vitest";
import type { DestinyProfileResponse } from "bungie-api-ts/destiny2";
import { ArmoryError, fetchProfile } from "./fetch";
import { HELD_PROFILE_HEADER, PROFILE_SHAPE_VERSION } from "./profile-mint";

const held = {
  responseMintedTimestamp: "2026-10-02T15:00:10Z",
  secondaryComponentsMintedTimestamp: "2026-10-02T15:00:12Z",
} as DestinyProfileResponse;

const sentHeaders = (fetchMock: ReturnType<typeof vi.fn>) =>
  (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchProfile", () => {
  it("sends the held profile's stamps and keeps it on a 304", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 304 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchProfile(held)).toBe(held);
    expect(sentHeaders(fetchMock)[HELD_PROFILE_HEADER]).toBe(
      `${PROFILE_SHAPE_VERSION} 2026-10-02T15:00:10Z 2026-10-02T15:00:12Z`,
    );
  });

  it("sends no stamps and parses the body when nothing is held", async () => {
    const fresh = { ...held, responseMintedTimestamp: "2026-10-02T15:01:00Z" };
    const fetchMock = vi.fn(async () => Response.json(fresh));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchProfile()).toEqual(fresh);
    expect(sentHeaders(fetchMock)).toEqual({});
  });

  it("refuses a 304 it did not ask for", async () => {
    vi.stubGlobal("fetch", async () => new Response(null, { status: 304 }));
    await expect(fetchProfile()).rejects.toMatchObject({ status: 304 });
  });

  it("still surfaces errors with their status", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ error: "Session expired" }, { status: 401 }));
    await expect(fetchProfile(held)).rejects.toMatchObject({ status: 401, message: "Session expired" });
    await expect(fetchProfile(held)).rejects.toBeInstanceOf(ArmoryError);
  });
});
