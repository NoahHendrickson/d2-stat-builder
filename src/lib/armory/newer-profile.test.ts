import { describe, expect, it } from "vitest";
import type { DestinyProfileResponse } from "bungie-api-ts/destiny2";
import { newerProfile } from "./fetch";

const minted = (response: string, secondary: string) =>
  ({
    responseMintedTimestamp: response,
    secondaryComponentsMintedTimestamp: secondary,
  }) as DestinyProfileResponse;

describe("newerProfile", () => {
  const held = minted("2026-10-02T15:00:10Z", "2026-10-02T15:00:10Z");

  it("takes the first profile", () => {
    expect(newerProfile(undefined, held)).toBe(held);
  });

  it("keeps the held profile over an older cached one or the same snapshot", () => {
    expect(newerProfile(held, minted("2026-10-02T15:00:00Z", "2026-10-02T15:00:00Z"))).toBe(held);
    expect(newerProfile(held, minted("2026-10-02T15:00:10Z", "2026-10-02T15:00:10Z"))).toBe(held);
  });

  it("takes a profile with either part minted later", () => {
    const newer = minted("2026-10-02T15:00:30Z", "2026-10-02T15:00:10Z");
    expect(newerProfile(held, newer)).toBe(newer);
    const newerSecondary = minted("2026-10-02T15:00:10Z", "2026-10-02T15:00:30Z");
    expect(newerProfile(held, newerSecondary)).toBe(newerSecondary);
  });

  it("takes the new profile when the timestamps can't be read", () => {
    const blank = {} as DestinyProfileResponse;
    expect(newerProfile(held, blank)).toBe(blank);
    expect(newerProfile(blank, held)).toBe(held);
  });
});
