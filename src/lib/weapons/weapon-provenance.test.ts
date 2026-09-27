import { describe, expect, test } from "vitest";

import type { ManifestDefs } from "./manifest";
import {
  activitySourceMatchesQuery,
  canonicalActivitySource,
  canonicalRaidSource,
  isCuratedActivitySource,
  isDungeonSource,
  isRaidSource,
  matchesWeaponSource,
  normalizeWeaponSource,
  raidSourceMatchesQuery,
  resolveWeaponSources,
  resolveWeaponSeason,
} from "./weapon-provenance";

const presentationNodes = {
  1154828558: {
    displayProperties: { name: "Raid: Vault of Glass" },
    parentNodeHashes: [498211331],
    hash: 1154828558,
  },
  1968454484: {
    displayProperties: { name: "Raid: Root of Nightmares" },
    parentNodeHashes: [498211331],
    hash: 1968454484,
  },
  239187336: {
    displayProperties: { name: "Season of the Haunted" },
    parentNodeHashes: [3790247699],
    hash: 239187336,
  },
} as unknown as ManifestDefs["DestinyPresentationNodeDefinition"];

const seasons = {
  1743682818: {
    hash: 1743682818,
    seasonNumber: 8,
    displayProperties: { name: "Season of the Undying" },
  },
  1743682820: {
    hash: 1743682820,
    seasonNumber: 20,
    displayProperties: { name: "Season of Defiance" },
  },
  193596630: {
    hash: 193596630,
    seasonNumber: 26,
    displayProperties: { name: "Episode: Heresy" },
  },
} as unknown as ManifestDefs["DestinySeasonDefinition"];

describe("normalizeWeaponSource", () => {
  test("extracts quoted raid names from Bungie source strings", () => {
    expect(
      normalizeWeaponSource('Source: "Root of Nightmares" Raid', presentationNodes, []),
    ).toBe("Root of Nightmares");
  });

  test("falls back to presentation parents for raid nodes", () => {
    expect(
      normalizeWeaponSource(undefined, presentationNodes, [1154828558]),
    ).toBe("Vault of Glass");
  });
});

describe("resolveWeaponSources", () => {
  test("keeps Dreaming City primary source and adds Shattered Throne for known dungeon loot", () => {
    expect(
      resolveWeaponSources(
        "Retold Tale",
        "Dreaming City",
        presentationNodes,
        [],
      ),
    ).toEqual({
      source: "Dreaming City",
      sources: ["Dreaming City", "The Shattered Throne"],
    });
  });

  test("adds Shattered Throne for updated dungeon weapons with old seasonal sources", () => {
    expect(
      resolveWeaponSources(
        "Chrysura Melo",
        "Season of the Lost",
        presentationNodes,
        [],
      ),
    ).toEqual({
      source: "Season of the Lost",
      sources: ["Season of the Lost", "The Shattered Throne"],
    });
  });

  test("adds Pit of Heresy for its refreshed Episode: Heresy weapons", () => {
    expect(
      resolveWeaponSources(
        "Refusal of the Call",
        "Source: Episode: Heresy Activities",
        presentationNodes,
        [],
      ),
    ).toEqual({
      source: "Episode: Heresy Activities",
      sources: ["Episode: Heresy Activities", "Pit of Heresy"],
    });
  });

  test("uses the dungeon as primary source for collectible-less refresh hashes", () => {
    expect(resolveWeaponSources("Adamantite", undefined, presentationNodes, [])).toEqual({
      source: "Pit of Heresy",
    });
  });

  test("ignores the reissue collectible placeholder as a source", () => {
    expect(
      resolveWeaponSources(
        "Apostate",
        "Random Perks: This item cannot be reacquired from Collections.",
        presentationNodes,
        [],
      ),
    ).toEqual({ source: undefined });
  });
});

describe("raid source helpers", () => {
  test("canonicalRaidSource normalizes armor-style raid strings", () => {
    expect(canonicalRaidSource("Last Wish raid")).toBe("Last Wish");
    expect(canonicalRaidSource('Source: "Vault of Glass" Raid')).toBe("Vault of Glass");
    expect(canonicalRaidSource("Source: Pantheon")).toBe("Pantheon");
  });

  test("isRaidSource recognizes canonical raid labels only", () => {
    expect(isRaidSource("Root of Nightmares")).toBe(true);
    expect(isRaidSource("Pantheon")).toBe(true);
    expect(isRaidSource("Last Wish raid")).toBe(true);
    expect(isRaidSource("Prophecy")).toBe(false);
    expect(isRaidSource("Complete Crucible matches")).toBe(false);
  });

  test("isDungeonSource recognizes canonical dungeon labels only", () => {
    expect(isDungeonSource("Prophecy")).toBe(true);
    expect(isDungeonSource("Prophecy dungeon")).toBe(true);
    expect(isDungeonSource("Root of Nightmares")).toBe(false);
  });

  test("raidSourceMatchesQuery supports shorthand raid tokens", () => {
    expect(raidSourceMatchesQuery("Root of Nightmares", "root")).toBe(true);
    expect(raidSourceMatchesQuery("Root of Nightmares", "ron")).toBe(true);
    expect(raidSourceMatchesQuery("Vault of Glass", "vog")).toBe(true);
    expect(raidSourceMatchesQuery("Pantheon", "panth")).toBe(true);
  });
});

describe("curated activity source helpers", () => {
  test("canonicalActivitySource normalizes dungeon and Ops strings", () => {
    expect(canonicalActivitySource("Prophecy dungeon")).toBe("Prophecy");
    expect(canonicalActivitySource("Source: Fireteam Ops")).toBe("Fireteam Ops");
    expect(canonicalActivitySource("Source: Raids and Dungeons")).toBe("Raids and Dungeons");
    expect(canonicalActivitySource("Source: Sparrow Racing League")).toBe("Sparrow Racing League");
  });

  test("isCuratedActivitySource recognizes curated labels only", () => {
    expect(isCuratedActivitySource("Prophecy")).toBe(true);
    expect(isCuratedActivitySource("Solo Ops")).toBe(true);
    expect(isCuratedActivitySource("Pantheon")).toBe(true);
    expect(isCuratedActivitySource("Sparrow Racing League")).toBe(true);
    expect(isCuratedActivitySource("Solstice")).toBe(false);
  });

  test("activitySourceMatchesQuery supports shorthand activity tokens", () => {
    expect(activitySourceMatchesQuery("Fireteam Ops", "fireteam")).toBe(true);
    expect(activitySourceMatchesQuery("Solo Ops", "solo")).toBe(true);
    expect(activitySourceMatchesQuery("Grasp of Avarice", "goa")).toBe(true);
    expect(activitySourceMatchesQuery("Pantheon", "panth")).toBe(true);
    expect(activitySourceMatchesQuery("Sparrow Racing League", "srl")).toBe(true);
  });
});

describe("matchesWeaponSource", () => {
  test("matches activity fragments case-insensitively", () => {
    expect(matchesWeaponSource("Root of Nightmares", ["root of nightmares"])).toBe(true);
    expect(matchesWeaponSource("Root of Nightmares", ["nightmares"])).toBe(true);
    expect(matchesWeaponSource("Vault of Glass", ["root"])).toBe(false);
  });
});

describe("resolveWeaponSeason", () => {
  test("maps episode activity sources onto seasons", () => {
    const season = resolveWeaponSeason(
      { hash: 1, itemType: 3 } as never,
      { sourceString: "Source: Episode: Heresy Activities", parentNodeHashes: [] } as never,
      { DestinySeasonDefinition: seasons, DestinyPresentationNodeDefinition: presentationNodes },
    );
    expect(season).toEqual({
      seasonNumber: 26,
      seasonName: "Episode: Heresy",
    });
  });

  test("maps normalized raid sources onto intro seasons", () => {
    const season = resolveWeaponSeason(
      { hash: 2, itemType: 3 } as never,
      {
        sourceString: 'Source: "Root of Nightmares" Raid',
        parentNodeHashes: [1968454484],
      } as never,
      { DestinySeasonDefinition: seasons, DestinyPresentationNodeDefinition: presentationNodes },
    );
    expect(season).toEqual({
      seasonNumber: 20,
      seasonName: "Season of Defiance",
    });
  });

  test("uses item seasonHash when Bungie provides it", () => {
    const season = resolveWeaponSeason(
      { hash: 3, itemType: 3, seasonHash: 1743682818 } as never,
      undefined,
      { DestinySeasonDefinition: seasons, DestinyPresentationNodeDefinition: presentationNodes },
    );
    expect(season).toEqual({
      seasonNumber: 8,
      seasonName: "Season of the Undying",
    });
  });
});
