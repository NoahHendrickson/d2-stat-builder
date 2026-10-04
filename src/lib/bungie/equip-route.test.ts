import { describe, expect, test, vi } from "vitest";

vi.mock("./session", () => ({ clearSession: vi.fn() }));
const { parseEquipItems } = await import("./equip-route");

describe("parseEquipItems", () => {
  const item = (slot: unknown) => [{ itemInstanceId: "6917529000000000001", itemHash: 1, location: "vault", slot }];
  const parse = (v: unknown) => parseEquipItems(v, { min: 1, max: 6 });

  test("accepts an armor slot, a weapon slot, or no slot (the subclass)", () => {
    expect(parse(item("helmet"))).not.toBeNull();
    expect(parse(item("kinetic"))).not.toBeNull();
    expect(parse(item("power"))).not.toBeNull();
    expect(parse(item("classItem"))).not.toBeNull();
    expect(parse(item(undefined))).not.toBeNull();
  });

  test("rejects anything that isn't an armor or weapon slot", () => {
    expect(parse(item("sparrow"))).toBeNull();
    expect(parse(item(3448274439))).toBeNull(); // a bucket hash, not a slot
    expect(parse(item("toString"))).toBeNull();
  });

  test("rejects ids that aren't Bungie's numeric ids", () => {
    const withIds = (itemInstanceId: string, characterId?: string) => [
      { itemInstanceId, itemHash: 1, location: "vault", characterId },
    ];
    expect(parse(withIds("../Profile/1"))).toBeNull();
    expect(parse(withIds(""))).toBeNull();
    expect(parse(withIds("6917529000000000001", "2305843009/x"))).toBeNull();
    expect(parse(withIds("6917529000000000001", "2305843009300000001"))).not.toBeNull();
  });
});
