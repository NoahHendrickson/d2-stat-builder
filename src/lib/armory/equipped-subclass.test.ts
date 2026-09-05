import { test, expect } from "vitest";
import type { DestinyProfileResponse } from "bungie-api-ts/destiny2";
import { subclassItemsForCharacter } from "./equipped-subclass";

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

test("unknown character → empty", () => {
  expect(subclassItemsForCharacter(profile(), "nope")).toEqual([]);
});
