import { test, expect, describe } from "vitest";
import type { DestinyProfileResponse } from "bungie-api-ts/destiny2";
import { SUBCLASS_ITEM_HASHES } from "@/lib/dim/subclasses";
import { equippedSubclassForCharacter, subclassItemsForCharacter } from "./equipped-subclass";

const CHAR = "char1";
const SOLAR_HUNTER = SUBCLASS_ITEM_HASHES.Solar[1]; // 2240888816
const PRISMATIC_WARLOCK = SUBCLASS_ITEM_HASHES.Prismatic[2]; // 3893112950

type SocketSpec = number | undefined | { plugHash: number; isVisible?: boolean; isEnabled?: boolean };

function mkProfile(opts: {
  itemHash: number;
  instanceId: string;
  /** Sparse socket list; length must cover fragment indices used. */
  sockets: SocketSpec[];
}): DestinyProfileResponse {
  return {
    characterEquipment: {
      data: {
        [CHAR]: {
          items: [{ itemHash: opts.itemHash, itemInstanceId: opts.instanceId }],
        },
      },
    },
    itemComponents: {
      sockets: {
        data: {
          [opts.instanceId]: {
            sockets: opts.sockets.map((s) =>
              s == null ? {} : typeof s === "number" ? { plugHash: s } : s,
            ),
          },
        },
      },
    },
  } as unknown as DestinyProfileResponse;
}

describe("equippedSubclassForCharacter", () => {
  test("reads Solar fragment plugs from sockets 7–12", () => {
    // indices 0–6 empty fillers; 7–12 = fragments
    const sockets: SocketSpec[] = Array(13).fill(undefined);
    sockets[7] = 11;
    sockets[8] = 22;
    sockets[12] = 33;
    const got = equippedSubclassForCharacter(
      mkProfile({ itemHash: SOLAR_HUNTER, instanceId: "sub1", sockets }),
      CHAR,
    );
    expect(got).toEqual({ subclass: "Solar", fragmentHashes: [11, 22, 33] });
  });

  test("reads Prismatic fragment plugs from sockets 9–14", () => {
    const sockets: SocketSpec[] = Array(15).fill(undefined);
    sockets[9] = 100;
    sockets[14] = 200;
    const got = equippedSubclassForCharacter(
      mkProfile({ itemHash: PRISMATIC_WARLOCK, instanceId: "sub2", sockets }),
      CHAR,
    );
    expect(got).toEqual({ subclass: "Prismatic", fragmentHashes: [100, 200] });
  });

  test("skips empty / zero plugs", () => {
    const sockets: SocketSpec[] = Array(13).fill(undefined);
    sockets[7] = 0;
    sockets[8] = 55;
    const got = equippedSubclassForCharacter(
      mkProfile({ itemHash: SOLAR_HUNTER, instanceId: "sub3", sockets }),
      CHAR,
    );
    expect(got).toEqual({ subclass: "Solar", fragmentHashes: [55] });
  });

  test("returns undefined when no subclass item is equipped", () => {
    const profile = {
      characterEquipment: {
        data: { [CHAR]: { items: [{ itemHash: 999, itemInstanceId: "x" }] } },
      },
      itemComponents: { sockets: { data: {} } },
    } as unknown as DestinyProfileResponse;
    expect(equippedSubclassForCharacter(profile, CHAR)).toBeUndefined();
  });

  test("returns undefined for unknown character id", () => {
    expect(
      equippedSubclassForCharacter(
        mkProfile({
          itemHash: SOLAR_HUNTER,
          instanceId: "sub1",
          sockets: Array(13).fill(1),
        }),
        "missing",
      ),
    ).toBeUndefined();
  });
});

describe("subclassItemsForCharacter", () => {
  // Prismatic Hunter 4282591831 (fragments at 9–14), Arcstrider 2328211300 (7–12).
  function profile(): DestinyProfileResponse {
    const sockets = (plugs: (number | undefined)[]) => ({
      sockets: plugs.map((plugHash) => ({ plugHash, isEnabled: true, isVisible: true })),
    });
    return {
      characterEquipment: {
        data: { c1: { items: [{ itemHash: 4282591831, itemInstanceId: "pris" }, { itemHash: 1, itemInstanceId: "helmet" }] } },
      },
      characterInventories: {
        data: { c1: { items: [{ itemHash: 2328211300, itemInstanceId: "arc" }, { itemHash: 7 }] } },
      },
      itemComponents: {
        sockets: {
          data: {
            pris: sockets([0, 0, 0, 0, 0, 0, 0, 0, 0, 501, 502, undefined, 0, 0, 0]),
            arc: sockets([0, 0, 0, 0, 0, 0, 0, 601, undefined, undefined, undefined, undefined, undefined]),
          },
        },
      },
    } as unknown as DestinyProfileResponse;
  }

  test("lists equipped + inventory subclasses with their fragment sockets", () => {
    const out = subclassItemsForCharacter(profile(), "c1");
    expect(out).toEqual([
      {
        itemHash: 4282591831,
        instanceId: "pris",
        subclass: "Prismatic",
        equipped: true,
        fragmentSockets: { 9: 501, 10: 502 },
      },
      {
        itemHash: 2328211300,
        instanceId: "arc",
        subclass: "Arc",
        equipped: false,
        fragmentSockets: { 7: 601 },
      },
    ]);
  });

  test("locked (not visible / not enabled) fragment slots are not offered as sockets", () => {
    const sockets: SocketSpec[] = Array(13).fill(undefined);
    sockets[7] = 11;
    sockets[8] = { plugHash: 900, isVisible: false, isEnabled: false }; // locked slot, empty plug
    sockets[9] = { plugHash: 22, isVisible: true, isEnabled: true };
    sockets[10] = { plugHash: 901, isVisible: true, isEnabled: false };
    const [item] = subclassItemsForCharacter(
      mkProfile({ itemHash: SOLAR_HUNTER, instanceId: "sub1", sockets }),
      CHAR,
    );
    expect(item.fragmentSockets).toEqual({ 7: 11, 9: 22 });
  });

  test("unknown character → empty", () => {
    expect(subclassItemsForCharacter(profile(), "nope")).toEqual([]);
  });
});
