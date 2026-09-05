import type { DestinyProfileResponse } from "bungie-api-ts/destiny2";
import type { DimArtifactUnlocks } from "@/lib/dim/loadout-link";

/** Minimal manifest access so the helper is testable without a full Manifest. */
interface SeasonLookup {
  def(
    table: "DestinySeasonDefinition",
    hash: number | undefined | null,
  ): { seasonNumber: number } | undefined;
}

/**
 * The seasonal-artifact perks a character currently has active, in dim-api
 * `artifactUnlocks` shape. Component 202 lists the artifact's tiers with each perk's
 * `isActive`; the season number comes from the profile's `currentSeasonHash` (100).
 * Undefined when the character has no artifact data (or 202 wasn't requested).
 */
export function artifactUnlocksForCharacter(
  profile: DestinyProfileResponse,
  characterId: string,
  manifest: SeasonLookup,
): DimArtifactUnlocks | undefined {
  const artifact = profile.characterProgressions?.data?.[characterId]?.seasonalArtifact;
  if (!artifact?.tiers) return undefined;
  const unlockedItemHashes: number[] = [];
  for (const tier of artifact.tiers) {
    for (const item of tier.items ?? []) {
      if (item.isActive) unlockedItemHashes.push(item.itemHash);
    }
  }
  const seasonHash = profile.profile?.data?.currentSeasonHash;
  const seasonNumber =
    manifest.def("DestinySeasonDefinition", seasonHash)?.seasonNumber ?? 0;
  return { unlockedItemHashes, seasonNumber };
}
