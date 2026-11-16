import { describe, expect, test, vi } from "vitest";

vi.mock("./session", () => ({ clearSession: vi.fn() }));
const { parseApplyTargets, parseEquipItems } = await import("./equip-route");

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

describe("parseApplyTargets", () => {
  const parse = (v: unknown) => parseApplyTargets(v, { maxItems: 11 });
  const armor = {
    kind: "armor",
    itemInstanceId: "6917529000000000001",
    sockets: [{ index: 0, plug: 10, empty: 1, current: 11 }, { index: 1, empty: 2 }],
  };
  const subclass = {
    kind: "subclass",
    itemInstanceId: "6917529000000000002",
    groups: [{ kind: "fragment", start: 7, count: 4, desired: [5, 6], emptyHash: 9, clearUnused: true, current: { 7: 5 } }],
  };
  const artifact = {
    kind: "artifact",
    itemInstanceId: "6917529000000000003",
    sockets: [{ index: 0, empty: 3, plug: 4 }, { index: 1, empty: 3, current: 4 }],
  };

  test("accepts armor, subclass and artifact targets with a cost table", () => {
    const t = parse({ items: [armor, subclass, artifact], costs: { 10: 1, 11: 3 } });
    expect(t?.items).toHaveLength(3);
    expect(t?.costs).toEqual({ 10: 1, 11: 3 });
    expect(parse({ items: [] })).toEqual({ items: [], costs: {} });
  });

  test("rejects malformed, oversized, or repeated items", () => {
    expect(parse(null)).toBeNull();
    expect(parse({ items: [{ ...armor, kind: "weapon" }] })).toBeNull();
    expect(parse({ items: [{ ...armor, itemInstanceId: "abc" }] })).toBeNull();
    expect(parse({ items: [{ ...armor, sockets: [{ index: -1 }] }] })).toBeNull();
    expect(parse({ items: [{ ...armor, sockets: [{ index: 0, plug: 1.5 }] }] })).toBeNull();
    expect(parse({ items: [{ ...armor, sockets: Array.from({ length: 33 }, (_, index) => ({ index })) }] })).toBeNull();
    expect(parse({ items: [{ ...artifact, sockets: [{ index: 0 }] }] })).toBeNull(); // no empty plug
    expect(parse({ items: [{ ...subclass, groups: [{ ...subclass.groups[0], kind: "weapon" }] }] })).toBeNull();
    expect(parse({ items: [{ ...subclass, groups: [{ ...subclass.groups[0], current: { x: 1 } }] }] })).toBeNull();
    expect(parse({ items: [armor, armor] })).toBeNull();
    expect(parse({ items: Array.from({ length: 12 }, (_, i) => ({ ...armor, itemInstanceId: String(i + 1) })) })).toBeNull();
  });

  test("rejects a cost table that isn't hash → small whole number", () => {
    expect(parse({ items: [armor], costs: { 10: -1 } })).toBeNull();
    expect(parse({ items: [armor], costs: { 10: 2.5 } })).toBeNull();
    expect(parse({ items: [armor], costs: { 10: 99 } })).toBeNull();
    expect(parse({ items: [armor], costs: { abc: 1 } })).toBeNull();
    expect(parse({ items: [armor], costs: [1, 2] })).toBeNull();
  });
});
