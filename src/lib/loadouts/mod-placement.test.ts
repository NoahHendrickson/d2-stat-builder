import { test, expect } from "vitest";
import type { ArmorPiece } from "../armory/normalize";
import type { ModOptionCatalog } from "./mod-options";
import { modsFromEditor, pieceEnergyUsed, placementToMods, type ModsSection } from "./mod-placement";

const piece = (instanceId: string, sockets: { index: number; plugHash?: number }[], used = 0): ArmorPiece =>
  ({
    instanceId,
    name: instanceId,
    armorSockets: sockets.map((s) => ({ ...s, kind: "general", category: "" })),
    energy: { capacity: 10, used },
  }) as unknown as ArmorPiece;

const section = (over: Partial<ModsSection>): ModsSection => ({
  pieces: [piece("a", [{ index: 1 }, { index: 2 }]), piece("b", [{ index: 1 }])],
  catalog: {} as ModOptionCatalog,
  initial: {},
  unplaced: [],
  skipped: [],
  ...over,
});

test("placementToMods walks pieces then sockets in order", () => {
  const s = section({});
  expect(placementToMods({ b: { 1: 30 }, a: { 2: 20, 1: 10 } }, s.pieces)).toEqual([10, 20, 30]);
});

test("modsFromEditor keeps mods the planner could not place", () => {
  const s = section({ initial: { a: { 1: 10 } }, unplaced: [99, 98] });
  expect(modsFromEditor(s, { a: { 1: 10 } })).toEqual([10, 99, 98]);
});

test("modsFromEditor: hand-placing an unplaced mod moves it instead of duplicating it", () => {
  const s = section({ initial: { a: { 1: 10 } }, unplaced: [99] });
  expect(modsFromEditor(s, { a: { 1: 10 }, b: { 1: 99 } })).toEqual([10, 99]);
});

test("modsFromEditor: clearing a pre-chosen socket drops that mod; unplaced ones remain", () => {
  const s = section({ initial: { a: { 1: 10 } }, unplaced: [99] });
  expect(modsFromEditor(s, {})).toEqual([99]);
});

test("modsFromEditor: extra copies of a mod use up the unplaced copy before adding more", () => {
  const s = section({ initial: { a: { 1: 10 } }, unplaced: [10] });
  // Two copies pre-existing (one placed, one unplaced); user places two more by hand →
  // one is the unplaced copy finding a home, the other is genuinely new.
  expect(modsFromEditor(s, { a: { 1: 10, 2: 10 }, b: { 1: 10 } })).toEqual([10, 10, 10]);
});

test("pieceEnergyUsed counts unmanaged baseline plus the chosen / current plugs", () => {
  const cost = (h: number) => ({ 10: 3, 20: 1 })[h] ?? 0;
  // used 5 with a 3-cost mod in socket 1 → 2 of baseline energy elsewhere.
  const p = piece("a", [{ index: 1, plugHash: 10 }, { index: 2 }], 5);
  expect(pieceEnergyUsed(p, undefined, cost)).toBe(5);
  expect(pieceEnergyUsed(p, { 2: 20 }, cost)).toBe(6);
  expect(pieceEnergyUsed(p, { 1: 20 }, cost)).toBe(3);
});
