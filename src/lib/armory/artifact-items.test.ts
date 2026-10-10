import { test, expect } from "vitest";
import type { DestinyProfileResponse } from "bungie-api-ts/destiny2";
import {
  ARTIFACT_BUCKET,
  artifactPerkColumns,
  artifactPerkSockets,
  artifactsForCharacter,
  assignArtifactPerks,
  planArtifactPlugs,
  type ArtifactDefLookup,
} from "./artifact-items";

// Shaped like the live manifest: sockets 0–1 take column 1 (perks 1–3 here), 2–4 add
// column 2 (4–6), 5–6 add column 3 (7–9), socket 7 is the reset socket.
const EMPTY = 100;
const PERK_TYPE = 1;
const RESET_TYPE = 2;
const SETS: Record<number, number[]> = {
  10: [EMPTY, 1, 2, 3],
  20: [EMPTY, 4, 5, 6, 1, 2, 3],
  30: [EMPTY, 7, 8, 9, 4, 5, 6, 1, 2, 3],
  40: [999, EMPTY],
};
const ARTIFACT = 500;
const entry = (set: number, type = PERK_TYPE) => ({
  socketTypeHash: type,
  singleInitialItemHash: EMPTY,
  reusablePlugSetHash: set,
});
const manifest = {
  def(table: string, hash: number | undefined | null) {
    if (table === "DestinyInventoryItemDefinition" && hash === ARTIFACT) {
      return {
        inventory: { bucketTypeHash: ARTIFACT_BUCKET },
        sockets: {
          socketEntries: [
            entry(10), entry(10),
            entry(20), entry(20), entry(20),
            entry(30), entry(30),
            entry(40, RESET_TYPE),
          ],
        },
      };
    }
    if (table === "DestinySocketTypeDefinition") {
      if (hash === PERK_TYPE) return { plugWhitelist: [{ categoryIdentifier: "artifact_perks" }] };
      if (hash === RESET_TYPE)
        return {
          plugWhitelist: [
            { categoryIdentifier: "artifact_perks" },
            { categoryIdentifier: "artifact_reset" },
          ],
        };
    }
    if (table === "DestinyPlugSetDefinition" && hash != null && SETS[hash]) {
      return { reusablePlugItems: SETS[hash].map((plugItemHash) => ({ plugItemHash })) };
    }
    return undefined;
  },
} as unknown as ArtifactDefLookup;

const sockets = artifactPerkSockets(manifest, ARTIFACT);

test("perk sockets skip the reset socket and the empty plug", () => {
  expect(sockets.map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  expect(sockets[0]).toEqual({ index: 0, options: [1, 2, 3], emptyHash: EMPTY });
});

test("columns hold the perks each pool adds", () => {
  expect(artifactPerkColumns(sockets)).toEqual([[1, 2, 3], [4, 5, 6], [7, 8, 9]]);
});

test("later-column perks take the wide sockets; too many of them don't fit", () => {
  expect(assignArtifactPerks(sockets, [1, 7, 4, 8, 2, 5, 6])).toEqual({
    0: 1, 1: 2, 2: 4, 3: 5, 4: 6, 5: 7, 6: 8,
  });
  expect(assignArtifactPerks(sockets, [7, 8, 9])).toBeNull();
  expect(assignArtifactPerks(sockets, [4, 5, 6, 1, 2, 3, 7, 8])).toBeNull();
});

test("perks already in a socket that takes them stay, unless that blocks the rest", () => {
  expect(assignArtifactPerks(sockets, [1, 4], { 6: 1 })).toEqual({ 6: 1, 2: 4 });
  // 1 in socket 5 would leave a single wide socket for 7 and 8.
  expect(assignArtifactPerks(sockets, [1, 7, 8], { 5: 1 })).toEqual({ 0: 1, 5: 7, 6: 8 });
});

test("plan empties sockets whose perk moves, then inserts", () => {
  const plan = planArtifactPlugs(sockets, { 0: 1, 5: 7, 6: 8 }, { 5: 1, 6: 8, 2: 4 });
  expect(plan.steps).toEqual([
    { socketIndex: 5, plugItemHash: EMPTY, clear: true },
    { socketIndex: 0, plugItemHash: 1 },
    { socketIndex: 5, plugItemHash: 7 },
  ]);
  expect(plan.inPlace).toEqual([{ socketIndex: 6, plugItemHash: 8 }]);
});

test("owned artifacts read live perks and locked plugs", () => {
  const profile = {
    characterEquipment: {
      data: { c1: { items: [{ itemHash: ARTIFACT, itemInstanceId: "a1", bucketHash: ARTIFACT_BUCKET }] } },
    },
    characterInventories: {
      data: { c1: { items: [{ itemHash: 1234, itemInstanceId: "x", bucketHash: 1 }] } },
    },
    itemComponents: {
      sockets: { data: { a1: { sockets: [{ plugHash: 2 }, { plugHash: EMPTY }] } } },
      reusablePlugs: {
        data: {
          a1: {
            plugs: {
              0: [
                { plugItemHash: 1, canInsert: true, enabled: true },
                { plugItemHash: 2, canInsert: false, enabled: true },
              ],
              5: [{ plugItemHash: 9, canInsert: false, enabled: false }],
            },
          },
        },
      },
    },
  } as unknown as DestinyProfileResponse;
  expect(artifactsForCharacter(profile, "c1", manifest)).toEqual([
    { instanceId: "a1", itemHash: ARTIFACT, equipped: true, perks: { 0: 2 }, locked: [9] },
  ]);
});
