import { describe, expect, it } from "vitest";
import type { DestinyProfileResponse } from "bungie-api-ts/destiny2";
import { countProfileItems } from "./profile-counts";

// Only the item lists matter here; the rest of the response is left out.
const profile = (p: object) => p as DestinyProfileResponse;

describe("countProfileItems", () => {
  it("sums items across equipment, inventories, and vault", () => {
    expect(
      countProfileItems(
        profile({
          characterEquipment: {
            data: {
              char1: { items: [{ itemHash: 1 }, { itemHash: 2 }] },
            },
          },
          characterInventories: {
            data: {
              char1: { items: [{ itemHash: 3 }] },
              char2: { items: [] },
            },
          },
          profileInventory: {
            data: { items: [{ itemHash: 4 }, { itemHash: 5 }, { itemHash: 6 }] },
          },
        }),
      ),
    ).toEqual({ equipped: 2, inventory: 1, vault: 3 });
  });

  it("handles missing profile sections", () => {
    expect(countProfileItems(profile({}))).toEqual({ equipped: 0, inventory: 0, vault: 0 });
  });
});
