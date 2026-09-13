import { test, expect } from "vitest";
import type { Manifest } from "@/lib/manifest/load";
import { SYNTHETIC_CLASS_ITEM_ID_PREFIX } from "./exotic-class-perks";
import {
  DREAMERS_BOND_ID_PREFIX,
  DREAMERS_CLASS_ITEMS,
  dreamersBondPiece,
  dreamersClassItemName,
  isDreamersBondId,
} from "./dreamers-bond";

function manifestWith(hash: number, name: string, icon: string): Manifest {
  return {
    def: (_table: string, h: number | null | undefined) =>
      h === hash ? { displayProperties: { name, icon } } : undefined,
  } as unknown as Manifest;
}

test("names the class-specific collections item", () => {
  expect(dreamersClassItemName(0)).toBe("Dreamer's Mark");
  expect(dreamersClassItemName(1)).toBe("Dreamer's Cloak");
  expect(dreamersClassItemName(2)).toBe("Dreamer's Bond");
  expect(dreamersClassItemName(99)).toBe("Dreamer's Bond");
});

test("builds a 0-stat synthetic class item per class", () => {
  const warlock = dreamersBondPiece(2);
  expect(warlock).toMatchObject({
    itemHash: DREAMERS_CLASS_ITEMS[2].hash,
    name: "Dreamer's Bond",
    slot: "classItem",
    classType: 2,
    isExotic: false,
    isArtifice: false,
    baseStats: [0, 0, 0, 0, 0, 0],
    stats: [0, 0, 0, 0, 0, 0],
  });
  expect(warlock?.instanceId.startsWith(DREAMERS_BOND_ID_PREFIX)).toBe(true);
  expect(isDreamersBondId(warlock!.instanceId)).toBe(true);
  expect(isDreamersBondId(`${SYNTHETIC_CLASS_ITEM_ID_PREFIX}other`)).toBe(false);
  expect(dreamersBondPiece(0)?.name).toBe("Dreamer's Mark");
  expect(dreamersBondPiece(1)?.name).toBe("Dreamer's Cloak");
});

test("prefers the manifest name and icon when present", () => {
  const hash = DREAMERS_CLASS_ITEMS[2].hash;
  const piece = dreamersBondPiece(2, manifestWith(hash, "Bond", "/img/bond.png"));
  expect(piece?.name).toBe("Bond");
  expect(piece?.icon).toBe("/img/bond.png");
});

test("returns null for an unknown class", () => {
  expect(dreamersBondPiece(3)).toBeNull();
});
