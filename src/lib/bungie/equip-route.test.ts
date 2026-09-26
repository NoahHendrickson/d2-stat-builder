import { describe, expect, test, vi } from "vitest";

vi.mock("./session", () => ({ clearSession: vi.fn() }));
const { parseEquipItems } = await import("./equip-route");

describe("parseEquipItems", () => {
  const item = (slot: unknown) => [{ itemInstanceId: "a", itemHash: 1, location: "vault", slot }];
  const parse = (v: unknown) => parseEquipItems(v, { min: 1, max: 6 });

  test("accepts an armor slot or no slot (the subclass)", () => {
    expect(parse(item("helmet"))).not.toBeNull();
    expect(parse(item("classItem"))).not.toBeNull();
    expect(parse(item(undefined))).not.toBeNull();
  });

  test("rejects anything that isn't an armor slot", () => {
    expect(parse(item("sparrow"))).toBeNull();
    expect(parse(item(3448274439))).toBeNull(); // a bucket hash, not a slot
    expect(parse(item("toString"))).toBeNull();
  });
});
