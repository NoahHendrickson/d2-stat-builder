import { test, expect } from "vitest";
import type { DestinyProfileResponse } from "bungie-api-ts/destiny2";
import { artifactUnlocksForCharacter } from "./artifact";

const manifest = {
  def: (_t: "DestinySeasonDefinition", hash: number | undefined | null) =>
    hash === 77 ? { seasonNumber: 30 } : undefined,
};

function profile(tiers: unknown, seasonHash?: number) {
  return {
    profile: { data: { currentSeasonHash: seasonHash } },
    characterProgressions: {
      data: { c1: { seasonalArtifact: { tiers } } },
    },
  } as unknown as DestinyProfileResponse;
}

test("collects active perks across tiers and resolves the season number", () => {
  const out = artifactUnlocksForCharacter(
    profile(
      [
        { items: [{ itemHash: 1, isActive: true }, { itemHash: 2, isActive: false }] },
        { items: [{ itemHash: 3, isActive: true }] },
      ],
      77,
    ),
    "c1",
    manifest,
  );
  expect(out).toEqual({ unlockedItemHashes: [1, 3], seasonNumber: 30 });
});

test("season falls back to 0 when unknown; missing artifact → undefined", () => {
  expect(
    artifactUnlocksForCharacter(profile([{ items: [] }]), "c1", manifest)?.seasonNumber,
  ).toBe(0);
  expect(artifactUnlocksForCharacter(profile([]), "nope", manifest)).toBeUndefined();
});
