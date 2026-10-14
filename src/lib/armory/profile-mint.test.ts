import { describe, expect, it } from "vitest";
import {
  PROFILE_SHAPE_VERSION,
  encodeHeldProfile,
  isNewerMint,
  parseHeldProfile,
} from "./profile-mint";

const minted = (response: string, secondary: string) => ({
  responseMintedTimestamp: response,
  secondaryComponentsMintedTimestamp: secondary,
});

describe("isNewerMint", () => {
  const held = minted("2026-10-02T15:00:10Z", "2026-10-02T15:00:10Z");

  it("is false for the same snapshot or an older one", () => {
    expect(isNewerMint(held, minted("2026-10-02T15:00:10Z", "2026-10-02T15:00:10Z"))).toBe(false);
    expect(isNewerMint(held, minted("2026-10-02T15:00:00Z", "2026-10-02T15:00:00Z"))).toBe(false);
  });

  it("is true when either stamp is later", () => {
    expect(isNewerMint(held, minted("2026-10-02T15:00:30Z", "2026-10-02T15:00:10Z"))).toBe(true);
    expect(isNewerMint(held, minted("2026-10-02T15:00:10Z", "2026-10-02T15:00:30Z"))).toBe(true);
  });

  it("is true when a stamp can't be read", () => {
    expect(isNewerMint(held, {})).toBe(true);
    expect(isNewerMint({}, held)).toBe(true);
  });
});

describe("held-profile header", () => {
  const held = minted("2026-10-02T15:00:10Z", "2026-10-02T15:00:12Z");

  it("round-trips the stamps with the shape version", () => {
    const value = encodeHeldProfile(held);
    expect(value).toBe(`${PROFILE_SHAPE_VERSION} 2026-10-02T15:00:10Z 2026-10-02T15:00:12Z`);
    expect(parseHeldProfile(value ?? null)).toEqual(held);
  });

  it("encodes nothing without both stamps", () => {
    expect(encodeHeldProfile(undefined)).toBeUndefined();
    expect(encodeHeldProfile({})).toBeUndefined();
    expect(encodeHeldProfile({ responseMintedTimestamp: "2026-10-02T15:00:10Z" })).toBeUndefined();
  });

  it("ignores a missing, malformed, or other-shape header", () => {
    expect(parseHeldProfile(null)).toBeUndefined();
    expect(parseHeldProfile("")).toBeUndefined();
    expect(parseHeldProfile("2026-10-02T15:00:10Z")).toBeUndefined();
    expect(parseHeldProfile(`${PROFILE_SHAPE_VERSION} a b c`)).toBeUndefined();
    expect(parseHeldProfile(`${PROFILE_SHAPE_VERSION + 1} a b`)).toBeUndefined();
  });
});
