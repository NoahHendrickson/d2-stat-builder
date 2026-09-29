import { expect, test } from "vitest";
import type { DestinyProfileResponse } from "bungie-api-ts/destiny2";
import type { Manifest } from "@/lib/manifest/load";
import { BUCKETS } from "./buckets";
import { OTHER_BUCKET, buildInventory, deriveInventory } from "./build";

const MATERIAL_BUCKET = 999;

const items: Record<number, object> = {
  1: { displayProperties: { name: "Ace of Spades", icon: "/ace.png" }, itemType: 3, itemTypeDisplayName: "Hand Cannon", inventory: { bucketTypeHash: BUCKETS.kinetic, tierType: 6 } },
  2: { displayProperties: { name: "Fatebringer" }, itemType: 3, inventory: { bucketTypeHash: BUCKETS.kinetic, tierType: 5 } },
  3: { displayProperties: { name: "Helm" }, itemType: 2, classType: 1, inventory: { bucketTypeHash: BUCKETS.helmet, tierType: 5 } },
  4: { displayProperties: { name: "Glimmer-ish" }, itemType: 0, inventory: { bucketTypeHash: MATERIAL_BUCKET, tierType: 2 } },
  5: { displayProperties: { name: "Shader" }, itemType: 0, inventory: { bucketTypeHash: BUCKETS.consumables, tierType: 2 } },
};
const manifest = {
  def: (table: string, hash: number | null | undefined) => {
    if (hash == null) return undefined;
    if (table === "DestinyInventoryItemDefinition") return items[hash];
    if (table === "DestinyDamageTypeDefinition") return hash === 77 ? { displayProperties: { icon: "/solar.png" } } : undefined;
    if (table === "DestinyInventoryBucketDefinition") {
      return { [BUCKETS.vault]: { itemCount: 700 }, [BUCKETS.postmaster]: { itemCount: 21 } }[hash];
    }
    return undefined;
  },
} as unknown as Manifest;

const item = (itemHash: number, bucketHash: number, extra: object = {}) => ({
  itemHash,
  bucketHash,
  quantity: 1,
  transferStatus: 0,
  state: 0,
  ...extra,
});

const profile = {
  characters: {
    data: {
      old: { characterId: "old", classType: 0, light: 10, emblemBackgroundPath: "", dateLastPlayed: "2026-01-01T00:00:00Z" },
      new: { characterId: "new", classType: 1, light: 20, emblemBackgroundPath: "", dateLastPlayed: "2026-09-01T00:00:00Z" },
    },
  },
  characterEquipment: {
    data: { new: { items: [item(1, BUCKETS.kinetic, { itemInstanceId: "i1", state: 1 })] } },
  },
  characterInventories: {
    data: {
      new: {
        items: [
          item(2, BUCKETS.kinetic, { itemInstanceId: "i2" }),
          item(4, BUCKETS.postmaster, { quantity: 5 }),
        ],
      },
    },
  },
  profileInventory: {
    data: {
      items: [
        item(3, BUCKETS.vault, { itemInstanceId: "i3" }),
        item(4, BUCKETS.vault, { quantity: 250 }),
        item(5, BUCKETS.consumables, { quantity: 3 }),
      ],
    },
  },
  itemComponents: {
    instances: { data: { i1: { primaryStat: { value: 550 }, damageTypeHash: 77 } } },
  },
} as unknown as DestinyProfileResponse;

test("lays the profile out by character, vault, postmaster, and account", () => {
  const inv = buildInventory(profile, manifest);

  expect(inv.characters.map((c) => c.id)).toEqual(["new", "old"]);
  const [hunter] = inv.characters;
  expect(hunter.equipped[BUCKETS.kinetic]).toMatchObject({
    name: "Ace of Spades",
    power: 550,
    damageIcon: "/solar.png",
    locked: true,
  });
  expect(hunter.inventory[BUCKETS.kinetic].map((i) => i.name)).toEqual(["Fatebringer"]);
  expect(hunter.postmaster).toMatchObject([{ name: "Glimmer-ish", quantity: 5 }]);
  expect(hunter.inventory[BUCKETS.postmaster]).toBeUndefined();

  // Vault items sort into their definition bucket; unrowed ones go to "Other".
  expect(inv.vault[BUCKETS.helmet].map((i) => i.name)).toEqual(["Helm"]);
  expect(inv.vault[OTHER_BUCKET]).toMatchObject([{ name: "Glimmer-ish", quantity: 250 }]);
  expect(inv.vaultCount).toBe(2);
  expect(inv.vaultCapacity).toBe(700);
  expect(inv.postmasterCapacity).toBe(21);
  expect(inv.account[BUCKETS.consumables]).toMatchObject([{ name: "Shader", quantity: 3 }]);
});

test("unknown items still get a tile and stack keys stay unique", () => {
  const inv = buildInventory(
    {
      ...profile,
      profileInventory: {
        data: { items: [item(404, BUCKETS.vault), item(404, BUCKETS.vault)] },
      },
    } as unknown as DestinyProfileResponse,
    manifest,
  );
  const other = inv.vault[OTHER_BUCKET];
  expect(other.map((i) => i.name)).toEqual(["Unknown item", "Unknown item"]);
  expect(new Set(other.map((i) => i.key)).size).toBe(2);
});

test("reads crafted, enhanced, and Deepsight state and the weapon's champion", () => {
  const breakers: Record<number, object> = {
    485622768: { enumValue: 1, displayProperties: { icon: "/barrier.png" } },
    3178805705: { enumValue: 3, displayProperties: { icon: "/stagger.png" } },
  };
  const withBreakers = {
    def: (table: string, hash: number | null | undefined) => {
      if (table === "DestinyBreakerTypeDefinition") return hash == null ? undefined : breakers[hash];
      if (table === "DestinyInventoryItemDefinition" && hash === 50) return { breakerTypeHash: 3178805705 };
      return manifest.def(table as never, hash);
    },
  } as unknown as Manifest;
  const inv = buildInventory(
    {
      ...profile,
      characterEquipment: { data: {} },
      characterInventories: { data: {} },
      profileInventory: {
        data: {
          items: [
            // Crafted + Deepsight, champion from the instance.
            item(2, BUCKETS.vault, { itemInstanceId: "a", state: 8 | 16 }),
            // Enhanced, champion from a plugged perk.
            item(2, BUCKETS.vault, { itemInstanceId: "b", state: 32 }),
            // Armor never gets a champion.
            item(3, BUCKETS.vault, { itemInstanceId: "c", state: 8 }),
          ],
        },
      },
      itemComponents: {
        instances: { data: { a: { breakerTypeHash: 485622768 }, b: {}, c: { breakerTypeHash: 485622768 } } },
        sockets: { data: { b: { sockets: [{ plugHash: 50, isEnabled: true }] } } },
      },
    } as unknown as DestinyProfileResponse,
    withBreakers,
  );
  const byId = Object.fromEntries(
    Object.values(inv.vault).flat().map((i) => [i.instanceId, i]),
  );
  expect(byId.a).toMatchObject({ crafted: true, deepsight: true, enhanced: false, breakerType: 1, breakerIcon: "/barrier.png" });
  expect(byId.b).toMatchObject({ crafted: false, enhanced: true, breakerType: 3, breakerIcon: "/stagger.png" });
  expect(byId.c.breakerType).toBeUndefined();
});

test("reads the champion a frame or exotic perk grants through its hidden sandbox perk", () => {
  const breakers: Record<number, object> = {
    2611060930: { hash: 2611060930, enumValue: 2, displayProperties: { icon: "/overload.png" } },
    485622768: { hash: 485622768, enumValue: 1, displayProperties: { icon: "/barrier.png" } },
  };
  const plugs: Record<number, object> = {
    // Area Denial Frame → "[Disruption] Overload".
    60: { displayProperties: { name: "Area Denial Frame" }, perks: [{ perkHash: 1 }, { perkHash: 472686235 }] },
    61: { displayProperties: { name: "Quickdraw" }, perks: [{ perkHash: 2 }] },
  };
  const sandbox: Record<number, object> = {
    1: { displayProperties: { name: "Area denial" } },
    2: { displayProperties: { name: "Quickdraw" } },
    472686235: { displayProperties: { name: "[Disruption] Overload" } },
  };
  const m = {
    def: (table: string, hash: number | null | undefined) => {
      if (hash == null) return undefined;
      if (table === "DestinyBreakerTypeDefinition") return breakers[hash];
      if (table === "DestinySandboxPerkDefinition") return sandbox[hash];
      if (table === "DestinyInventoryItemDefinition" && plugs[hash]) return plugs[hash];
      return manifest.def(table as never, hash);
    },
    all: (table: string) => (table === "DestinyBreakerTypeDefinition" ? breakers : {}),
  } as unknown as Manifest;
  const inv = buildInventory(
    {
      ...profile,
      characterEquipment: { data: {} },
      characterInventories: { data: {} },
      profileInventory: {
        data: {
          items: [
            item(2, BUCKETS.vault, { itemInstanceId: "gl" }),
            item(2, BUCKETS.vault, { itemInstanceId: "plain" }),
          ],
        },
      },
      itemComponents: {
        instances: { data: { gl: {}, plain: {} } },
        sockets: {
          data: {
            gl: { sockets: [{ plugHash: 61, isEnabled: true }, { plugHash: 60, isEnabled: true }] },
            plain: { sockets: [{ plugHash: 61, isEnabled: true }] },
          },
        },
      },
    } as unknown as DestinyProfileResponse,
    m,
  );
  const byId = Object.fromEntries(Object.values(inv.vault).flat().map((i) => [i.instanceId, i]));
  expect(byId.gl).toMatchObject({ breakerType: 2, breakerIcon: "/overload.png" });
  expect(byId.plain.breakerType).toBeUndefined();
});

test("derives once per profile and manifest pair", () => {
  const first = deriveInventory(profile, manifest);
  expect(deriveInventory(profile, manifest)).toBe(first);
  expect(deriveInventory({ ...profile }, manifest)).not.toBe(first);
  expect(deriveInventory(profile, { ...manifest })).not.toBe(first);
  expect(first).toEqual(buildInventory(profile, manifest));
});
