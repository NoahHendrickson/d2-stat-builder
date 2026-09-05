import { test, expect } from "vitest";
import type { ArmorPiece } from "../armory/normalize";
import { resolveLoadout, type DefLookup } from "./resolve";

const manifest: DefLookup = {
  def: (_t, hash) =>
    hash === 200
      ? { displayProperties: { name: "Gone Helm", icon: "/h.png" }, inventory: { bucketTypeHash: 3448274439 } }
      : undefined,
};

const piece = (instanceId: string, slot: ArmorPiece["slot"]): ArmorPiece =>
  ({ instanceId, itemHash: 1, name: `live ${slot}`, slot, stats: [] }) as unknown as ArmorPiece;

const pieceMap = new Map([
  ["c1", piece("c1", "chest")],
  ["a1", piece("a1", "arms")],
]);

test("resolves live pieces, flags missing ones, orders by slot, extracts fragments", () => {
  const out = resolveLoadout(
    {
      id: "x",
      name: "n",
      classType: 1,
      unequipped: [],
      parameters: { mods: [], assumeArmorMasterwork: 3 },
      equipped: [
        { id: "c1", hash: 1 },
        { id: "gone", hash: 200 },
        { id: "a1", hash: 1 },
        // Prismatic Hunter carrier: fragments start at socket 9
        { id: "12345", hash: 4282591831, socketOverrides: { 10: 22, 9: 11 } },
      ],
    },
    pieceMap,
    manifest,
  );
  expect(out.armor.map((a) => [a.name, a.slot, a.missing])).toEqual([
    ["Gone Helm", "helmet", true],
    ["live arms", "arms", false],
    ["live chest", "chest", false],
  ]);
  expect(out.subclass).toEqual({
    itemHash: 4282591831,
    subclass: "Prismatic",
    fragmentHashes: [11, 22],
  });
  expect(out.missing).toBe(true);
  expect(out.actionable).toBe(false);
});

test("actionable only when every piece is live and none is synthetic", () => {
  const base = {
    id: "x",
    name: "n",
    classType: 1,
    unequipped: [],
    parameters: { mods: [], assumeArmorMasterwork: 3 },
  };
  expect(
    resolveLoadout({ ...base, equipped: [{ id: "c1", hash: 1 }] }, pieceMap, manifest)
      .actionable,
  ).toBe(true);
  const synthetic = new Map(pieceMap);
  synthetic.set("synthetic-class-item:1", piece("synthetic-class-item:1", "classItem"));
  expect(
    resolveLoadout(
      { ...base, equipped: [{ id: "synthetic-class-item:1", hash: 1 }] },
      synthetic,
      manifest,
    ).actionable,
  ).toBe(false);
});
