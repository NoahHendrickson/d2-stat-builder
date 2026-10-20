import { describe, expect, it } from "vitest";
import {
  activityLookup,
  armorSample,
  bucketView,
  characterLoadout,
  mergeSetStores,
  ORBIT_READ_MS,
  pruneSetStore,
  setConfig,
  setPopularitySnapshot,
  type ActivityTables,
  type ArmorRead,
  type SetSample,
  type SetStore,
} from "./set-popularity";

const RAID_TYPE = 10;
const DUNGEON_TYPE = 11;
const SOCIAL_TYPE = 12;
const MISSION_TYPE = 13;
const ORBIT = 82913930;

const tables: ActivityTables = {
  activityTypes: {
    [RAID_TYPE]: { displayProperties: { name: "Raid" } },
    [DUNGEON_TYPE]: { displayProperties: { name: "Dungeon" } },
    [SOCIAL_TYPE]: { displayProperties: { name: "Social" } },
    [MISSION_TYPE]: { displayProperties: { name: "Mission" } },
  },
  activities: {
    1: { displayProperties: { name: "Last Wish: Standard" }, activityTypeHash: RAID_TYPE, activityModeTypes: [4, 7] },
    // A raid with the type but no modes (The Desert Perpetual).
    2: { displayProperties: { name: "The Desert Perpetual" }, activityTypeHash: RAID_TYPE },
    // A dungeon with the type but no modes (Vesper's Host).
    3: { displayProperties: { name: "Vesper's Host: Normal" }, activityTypeHash: DUNGEON_TYPE },
    4: { displayProperties: { name: "Prophecy" }, activityTypeHash: DUNGEON_TYPE, activityModeTypes: [82, 7] },
    // The GM alert's own Warden of Nothing, and the strike's ordinary one.
    5: { displayProperties: { name: "Warden of Nothing: Customize" }, activityTypeHash: MISSION_TYPE, activityModeTypes: [3, 18, 7] },
    6: { displayProperties: { name: "Warden of Nothing: Customize" }, activityTypeHash: MISSION_TYPE, activityModeTypes: [3, 18, 7] },
    7: { displayProperties: { name: "Master Conquest: Derealize: Customize" }, activityTypeHash: MISSION_TYPE },
    8: { displayProperties: { name: "Tower" }, activityTypeHash: SOCIAL_TYPE, activityModeTypes: [40] },
    9: { displayProperties: { name: "The Enclave" }, activityTypeHash: 99, activityModeTypes: [40] },
    10: { displayProperties: { name: "Europa" }, activityTypeHash: 99, activityModeTypes: [6] },
    [ORBIT]: { displayProperties: { name: "" } },
  },
  fireteamFinderGraph: {
    100: { children: [101, 102] },
    101: { displayProperties: { name: "Grandmaster Vanguard Alert" }, relatedActivityHashes: [5] },
    // Another alert node that isn't GM: not a bucket.
    102: { displayProperties: { name: "" }, relatedActivityHashes: [6] },
  },
  vanguardAlertsRoot: 100,
};
const lookup = activityLookup(tables);

describe("setConfig", () => {
  it("reads 4 or 5 pieces of one set as its 4-piece", () => {
    expect(setConfig([7, 7, 7, 7, 8])).toEqual({ kind: "four", set: 7 });
    expect(setConfig([7, 7, 7, 7, 7])).toEqual({ kind: "four", set: 7 });
  });
  it("reads two sets of 2 or more as a pair, lower hash first", () => {
    expect(setConfig([9, 9, 7, 7, undefined])).toEqual({ kind: "pair", sets: [7, 9] });
    expect(setConfig([9, 9, 9, 7, 7])).toEqual({ kind: "pair", sets: [7, 9] });
  });
  it("reads one set of 2 or 3 as its 2-piece", () => {
    expect(setConfig([7, 7, 7, 8, undefined])).toEqual({ kind: "two", set: 7 });
  });
  it("reads no set with 2 pieces as no bonus", () => {
    expect(setConfig([7, 8, 9, undefined, undefined])).toEqual({ kind: "none" });
    expect(setConfig([])).toEqual({ kind: "none" });
  });
});

describe("activityLookup", () => {
  it("buckets raids and dungeons by type or mode", () => {
    expect(lookup.bucket(1)).toBe("raid");
    expect(lookup.bucket(2)).toBe("raid");
    expect(lookup.bucket(3)).toBe("dungeon");
    expect(lookup.bucket(4)).toBe("dungeon");
  });
  it("takes the GM alert from the Vanguard Alerts tree, not the strike's name", () => {
    expect(lookup.bucket(5)).toBe("gmAlert");
    expect(lookup.bucket(6)).toBeUndefined();
  });
  it("buckets every Conquest tier together", () => {
    expect(lookup.bucket(7)).toBe("conquest");
  });
  it("leaves everything else out", () => {
    expect(lookup.bucket(8)).toBeUndefined();
    expect(lookup.bucket(10)).toBeUndefined();
    expect(lookup.bucket(12345)).toBeUndefined();
  });
  it("counts orbit, social spaces and offline as between activities", () => {
    expect(lookup.between(ORBIT)).toBe(true);
    expect(lookup.between(8)).toBe(true);
    expect(lookup.between(9)).toBe(true);
    expect(lookup.between(0)).toBe(true);
    expect(lookup.between(10)).toBe(false);
    expect(lookup.between(1)).toBe(false);
    expect(lookup.between(12345)).toBe(false);
  });
});

describe("armorSample", () => {
  const four = [7, 7, 7, 7, undefined];
  const read = (over: Partial<ArmorRead>): ArmorRead => ({
    reportActivity: 10,
    ended: 1_000_000,
    reportWeapons: [50, 51],
    readAt: 1_000_000 + 60_000,
    currentActivity: 1,
    armorSets: four,
    equippedWeapons: [50, 51, 52],
    ...over,
  });

  it("counts a read inside a bucket's activity for that activity", () => {
    expect(armorSample(read({ currentActivity: 1 }), lookup)).toEqual({ bucket: "raid", config: { kind: "four", set: 7 } });
    // However long after the report, and whatever the weapons.
    expect(armorSample(read({ currentActivity: 3, readAt: 1_000_000 + 20 * 60_000, equippedWeapons: [] }), lookup)?.bucket).toBe(
      "dungeon",
    );
  });

  it("counts an orbit read for a just-finished Conquest or GM alert when the weapons still match", () => {
    expect(armorSample(read({ reportActivity: 7, currentActivity: ORBIT }), lookup)?.bucket).toBe("conquest");
    expect(armorSample(read({ reportActivity: 5, currentActivity: 8 }), lookup)?.bucket).toBe("gmAlert");
  });

  it("drops an orbit read after a raid or dungeon: they fill from in-activity reads", () => {
    expect(armorSample(read({ reportActivity: 1, currentActivity: ORBIT }), lookup)).toBeUndefined();
    expect(armorSample(read({ reportActivity: 4, currentActivity: ORBIT }), lookup)).toBeUndefined();
  });

  it("drops an orbit read that's late, or after a weapon swap, or with no kills to check", () => {
    const after = { reportActivity: 7, currentActivity: ORBIT };
    expect(armorSample(read({ ...after, readAt: 1_000_000 + ORBIT_READ_MS + 1 }), lookup)).toBeUndefined();
    expect(armorSample(read({ ...after, equippedWeapons: [50, 99] }), lookup)).toBeUndefined();
    expect(armorSample(read({ ...after, reportWeapons: [] }), lookup)).toBeUndefined();
  });

  it("drops a read that's in some other activity now", () => {
    expect(armorSample(read({ reportActivity: 7, currentActivity: 10 }), lookup)).toBeUndefined();
  });

  it("drops a read with no armor", () => {
    expect(armorSample(read({ armorSets: [] }), lookup)).toBeUndefined();
  });
});

describe("characterLoadout", () => {
  it("reads the report's character only", () => {
    const profile = {
      characterActivities: { data: { a: { currentActivityHash: 1 }, b: { currentActivityHash: 4 } } },
      characterEquipment: {
        data: {
          a: {
            items: [
              { itemHash: 1, bucketHash: 3448274439 },
              { itemHash: 2, bucketHash: 14239492 },
              { itemHash: 3, bucketHash: 1498876634 },
              { itemHash: 4, bucketHash: 4023194814 }, // the ghost: neither
            ],
          },
          b: { items: [] },
        },
      },
    };
    const setOf = (hash: number) => (hash === 1 ? 77 : undefined);
    expect(characterLoadout(profile, "a", setOf)).toEqual({
      currentActivity: 1,
      armorSets: [77, undefined],
      equippedWeapons: [3],
    });
    expect(characterLoadout(profile, "c", setOf)).toBeUndefined();
    expect(characterLoadout({ characterEquipment: profile.characterEquipment }, "a", setOf)).toBeUndefined();
  });
});

const sample = (character: string, day: number, over: Partial<SetSample> = {}): SetSample => ({
  character,
  bucket: "raid",
  day,
  classType: 0,
  config: { kind: "four", set: 7 },
  ...over,
});
const run = (generatedAt: string) => ({ generatedAt, reads: 1, samples: 1 });

describe("mergeSetStores / pruneSetStore", () => {
  it("keeps each character's latest sample per bucket", () => {
    const older: SetStore = {
      runs: [run("2026-10-01T00:00:00Z")],
      samples: [sample("a", 10), sample("b", 10), sample("a", 10, { bucket: "dungeon" })],
    };
    const newer: SetStore = {
      runs: [run("2026-10-02T00:00:00Z")],
      samples: [sample("a", 11, { config: { kind: "none" } }), sample("b", 9)],
    };
    const merged = mergeSetStores(older, newer);
    expect(merged.runs).toHaveLength(2);
    const byKey = Object.fromEntries(merged.samples.map((s) => [`${s.character}:${s.bucket}`, s]));
    expect(byKey["a:raid"].config).toEqual({ kind: "none" });
    expect(byKey["b:raid"].day).toBe(10);
    expect(byKey["a:dungeon"]).toBeDefined();
  });

  it("skips a run already merged", () => {
    const store: SetStore = { runs: [run("2026-10-01T00:00:00Z")], samples: [] };
    expect(mergeSetStores(store, store).runs).toHaveLength(1);
  });

  it("prunes samples and runs before the window", () => {
    const store: SetStore = {
      runs: [run("1970-01-11T00:00:00Z"), run("1970-01-13T00:00:00Z")],
      samples: [sample("a", 10), sample("b", 12)],
    };
    const dayOf = (iso: string) => Math.floor(Date.parse(iso) / 86_400_000);
    const pruned = pruneSetStore(store, 11, dayOf);
    expect(pruned.samples.map((s) => s.character)).toEqual(["b"]);
    expect(pruned.runs.map((r) => r.generatedAt)).toEqual(["1970-01-13T00:00:00Z"]);
  });
});

describe("setPopularitySnapshot / bucketView", () => {
  const store: SetStore = {
    runs: [],
    samples: [
      sample("a", 1, { config: { kind: "four", set: 7 } }),
      sample("b", 1, { config: { kind: "four", set: 7 } }),
      sample("c", 1, { config: { kind: "pair", sets: [7, 9] } }),
      sample("d", 1, { config: { kind: "two", set: 9 } }),
      sample("e", 1, { config: { kind: "none" } }),
      sample("f", 1, { bucket: "dungeon", config: { kind: "two", set: 9 } }),
    ],
  };
  const snapshot = setPopularitySnapshot(store, "2026-10-19T00:00:00Z", 14);

  it("tallies each bucket apart", () => {
    expect(snapshot.buckets.raid).toEqual({ samples: 5, none: 1, four: { 7: 2 }, pairs: { "7,9": 1 }, two: { 9: 1 } });
    expect(snapshot.buckets.dungeon?.samples).toBe(1);
    expect(snapshot.buckets.gmAlert).toBeUndefined();
  });

  it("shares each set's bonuses, a pair counting toward both its sets", () => {
    const view = bucketView(snapshot.buckets.raid!);
    expect(view.shape).toEqual({ four: 0.4, pair: 0.2, two: 0.2, none: 0.2 });
    expect(view.sets).toEqual([
      { setHash: 7, four: 0.4, two: 0.2, any: 0.6 },
      { setHash: 9, four: 0, two: 0.4, any: 0.4 },
    ]);
    expect(view.pairs).toEqual([{ sets: [7, 9], share: 0.2 }]);
  });
});
