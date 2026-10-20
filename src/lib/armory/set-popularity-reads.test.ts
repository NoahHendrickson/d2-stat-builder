import { describe, expect, it } from "vitest";
import {
  activityLookup,
  armorSample,
  characterLoadout,
  ORBIT_READ_MS,
  reportSide,
  type ActivityTables,
  type ArmorRead,
} from "./set-popularity-reads";

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
    expect(armorSample(read({ currentActivity: 1 }), lookup)).toEqual({ bucket: "raid", config: { kind: "four", sets: [7] } });
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

describe("reportSide", () => {
  it("takes the director activity, the entry's kill weapons and its class", () => {
    const report = { activityDetails: { referenceId: 1, directorActivityHash: 2 } };
    const entry = { player: { classHash: 671679327 }, extended: { weapons: [{ referenceId: 50 }, { referenceId: 51 }] } };
    expect(reportSide(report, entry)).toEqual({ reportActivity: 2, reportWeapons: [50, 51], classType: 1 });
  });
  it("falls back to the reference id, no weapons, and class 3", () => {
    expect(reportSide({ activityDetails: { referenceId: 1 } }, {})).toEqual({ reportActivity: 1, reportWeapons: [], classType: 3 });
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
