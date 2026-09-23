import { describe, expect, it } from "vitest";
import type { DestinyProfileResponse } from "bungie-api-ts/destiny2";
import type { Manifest } from "@/lib/manifest/load";
import { deriveArmory } from "./fetch";

const manifest = (): Manifest => ({
  version: "v",
  tables: {} as Manifest["tables"],
  def: () => undefined,
  all: () => ({}) as never,
  counts: () => ({}) as never,
});

describe("deriveArmory", () => {
  it("normalizes once per (profile, manifest) pair and again for a new pair", () => {
    const profile = { characters: { data: {} } } as unknown as DestinyProfileResponse;
    const m1 = manifest();
    const a = deriveArmory(profile, m1);
    expect(a).toEqual({ pieces: [], characters: [] });
    expect(deriveArmory(profile, m1)).toBe(a);
    expect(deriveArmory(profile, manifest())).not.toBe(a);
    expect(deriveArmory({ ...profile } as DestinyProfileResponse, m1)).not.toBe(a);
  });
});
