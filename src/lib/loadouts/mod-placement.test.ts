import { test, expect } from "vitest";
import type { ArmorPiece } from "../armory/normalize";
import type { ModOptionCatalog } from "./mod-options";
import {
  chosenCount,
  cycleModStack,
  toggleExclusiveMod,
  modsFromEditor,
  pieceEnergyUsed,
  placeStatMods,
  placementToMods,
  slotStatMod,
  statModSlotted,
  updateEditorPiece,
  type ModsSection,
} from "./mod-placement";

const piece = (instanceId: string, sockets: { index: number; plugHash?: number }[], used = 0): ArmorPiece =>
  ({
    instanceId,
    name: instanceId,
    armorSockets: sockets.map((s) => ({ ...s, kind: "general", category: "" })),
    energy: { capacity: 10, used },
  }) as unknown as ArmorPiece;

const unplaced = (hash: number) => ({ hash, reason: "test" });

const section = (over: Partial<ModsSection>): ModsSection => ({
  pieces: [piece("a", [{ index: 1 }, { index: 2 }]), piece("b", [{ index: 1 }])],
  catalog: {} as ModOptionCatalog,
  initial: {},
  unplaced: [],
  ...over,
});

test("placementToMods walks pieces then sockets in order", () => {
  const s = section({});
  expect(placementToMods({ b: { 1: 30 }, a: { 2: 20, 1: 10 } }, s.pieces)).toEqual([10, 20, 30]);
});

test("modsFromEditor keeps mods the planner could not place", () => {
  const s = section({ initial: { a: { 1: 10 } }, unplaced: [unplaced(99), unplaced(98)] });
  expect(modsFromEditor(s, { a: { 1: 10 } })).toEqual([10, 99, 98]);
});

test("modsFromEditor: hand-placing an unplaced mod moves it instead of duplicating it", () => {
  const s = section({ initial: { a: { 1: 10 } }, unplaced: [unplaced(99)] });
  expect(modsFromEditor(s, { a: { 1: 10 }, b: { 1: 99 } })).toEqual([10, 99]);
});

test("modsFromEditor: clearing a pre-chosen socket drops that mod; unplaced ones remain", () => {
  const s = section({ initial: { a: { 1: 10 } }, unplaced: [unplaced(99)] });
  expect(modsFromEditor(s, {})).toEqual([99]);
});

test("modsFromEditor: extra copies of a mod use up the unplaced copy before adding more", () => {
  const s = section({ initial: { a: { 1: 10 } }, unplaced: [unplaced(10)] });
  // Two copies pre-existing (one placed, one unplaced); user places two more by hand →
  // one is the unplaced copy finding a home, the other is genuinely new.
  expect(modsFromEditor(s, { a: { 1: 10, 2: 10 }, b: { 1: 10 } })).toEqual([10, 10, 10]);
});

test("modsFromEditor keeps a desired stat mod that energy rebalancing couldn't place", () => {
  const s = section({ initial: { a: { 1: 10 } }, desiredStatMods: [10] });
  expect(modsFromEditor(s, {})).toEqual([10]);
  expect(modsFromEditor(s, { a: { 1: 10 } })).toEqual([10]);
});

test("pieceEnergyUsed counts only the loadout's chosen mods, not vault plugs", () => {
  const cost = (h: number) => ({ 10: 3, 20: 1 })[h] ?? 0;
  // Vault has a 3-cost mod and 5 energy used; none of that is in the loadout.
  const p = piece("a", [{ index: 1, plugHash: 10 }, { index: 2 }], 5);
  expect(pieceEnergyUsed(p, undefined, cost)).toBe(0);
  expect(pieceEnergyUsed(p, { 2: 20 }, cost)).toBe(1);
  expect(pieceEnergyUsed(p, { 1: 20 }, cost)).toBe(1);
  expect(pieceEnergyUsed(p, { 1: 10, 2: 20 }, cost)).toBe(4);
});

test("pieceEnergyUsed can skip a socket kind so armor clicks ignore the stat mod", () => {
  const cost = (h: number) => ({ 10: 3, 20: 1 })[h] ?? 0;
  const p = {
    ...piece("a", [{ index: 1 }, { index: 2 }]),
    armorSockets: [
      { index: 1, kind: "general", category: "" },
      { index: 2, kind: "other", category: "" },
    ],
  } as ArmorPiece;
  expect(pieceEnergyUsed(p, { 1: 10, 2: 20 }, cost)).toBe(4);
  expect(pieceEnergyUsed(p, { 1: 10, 2: 20 }, cost, "general")).toBe(1);
});

const sockets = [1, 2, 3].map((index) => ({ index, kind: "other", category: "" }) as const);

test("cycleModStack fills the next free socket, then clears at the limit", () => {
  let chosen: Record<number, number> | undefined;
  chosen = cycleModStack(chosen, sockets, 7, 3);
  expect(chosen).toEqual({ 1: 7 });
  chosen = cycleModStack(chosen, sockets, 7, 3);
  chosen = cycleModStack(chosen, sockets, 7, 3);
  expect(chosen).toEqual({ 1: 7, 2: 7, 3: 7 });
  expect(chosenCount(chosen, sockets, 7)).toBe(3);
  expect(cycleModStack(chosen, sockets, 7, 3)).toEqual({});
});

test("cycleModStack respects a non-stackable mod and leaves other mods alone", () => {
  const once = cycleModStack({ 2: 9 }, sockets, 7, 1);
  expect(once).toEqual({ 1: 7, 2: 9 });
  expect(cycleModStack(once, sockets, 7, 1)).toEqual({ 2: 9 });
});

test("cycleModStack clears when every socket is taken by other mods", () => {
  expect(cycleModStack({ 1: 8, 2: 9, 3: 8 }, sockets, 8, 3)).toEqual({ 2: 9 });
  expect(cycleModStack({ 1: 8, 2: 9, 3: 5 }, sockets, 7, 3)).toEqual({ 1: 8, 2: 9, 3: 5 });
});

const exclusive = [{ index: 1, kind: "general", category: "" }] as const;

test("toggleExclusiveMod selects, replaces, then clears on a second click", () => {
  const first = toggleExclusiveMod(undefined, exclusive, 10);
  expect(first).toEqual({ 1: 10 });
  expect(toggleExclusiveMod(first, exclusive, 20)).toEqual({ 1: 20 });
  expect(toggleExclusiveMod({ 1: 20 }, exclusive, 20)).toEqual({});
});

test("toggleExclusiveMod only clears sockets in the exclusive group", () => {
  expect(toggleExclusiveMod({ 1: 10, 4: 99 }, exclusive, 20)).toEqual({ 1: 20, 4: 99 });
});

const mixed = (
  id: string,
  sockets: { index: number; kind: "general" | "other" }[],
): ArmorPiece =>
  ({
    instanceId: id,
    name: id,
    armorSockets: sockets.map((s) => ({ ...s, category: "" })),
    energy: { capacity: 10, used: 0 },
  }) as unknown as ArmorPiece;

const MAJOR = 10;
const MINOR = 20;
const ARMOR = 90;
const statCost = (h: number) => ({ [MAJOR]: 3, [MINOR]: 1, [ARMOR]: 3 }[h] ?? 0);

test("placeStatMods puts the major on the piece with the most leftover energy", () => {
  const arms = mixed("arms", [
    { index: 1, kind: "general" },
    { index: 2, kind: "other" },
    { index: 3, kind: "other" },
    { index: 4, kind: "other" },
  ]);
  const helm = mixed("helm", [{ index: 1, kind: "general" }]);
  const { placement, unplaced } = placeStatMods(
    [helm, arms],
    { arms: { 2: ARMOR, 3: ARMOR, 4: ARMOR } },
    [MAJOR, MINOR],
    statCost,
  );
  expect(unplaced).toEqual([]);
  expect(placement.arms[1]).toBe(MINOR);
  expect(placement.helm[1]).toBe(MAJOR);
  expect(placement.arms[2]).toBe(ARMOR);
});

test("placeStatMods leaves a major unplaced when no piece has 3 energy left", () => {
  const arms = mixed("arms", [
    { index: 1, kind: "general" },
    { index: 2, kind: "other" },
    { index: 3, kind: "other" },
    { index: 4, kind: "other" },
  ]);
  const { placement, unplaced } = placeStatMods(
    [arms],
    { arms: { 2: ARMOR, 3: ARMOR, 4: ARMOR } },
    [MAJOR],
    statCost,
  );
  expect(placement.arms[1]).toBeUndefined();
  expect(unplaced).toEqual([MAJOR]);
});

test("slotStatMod fills the emptiest piece's general socket and moves nothing else", () => {
  const helm = mixed("helm", [{ index: 1, kind: "general" }, { index: 2, kind: "other" }]);
  const arms = mixed("arms", [{ index: 1, kind: "general" }]);
  const before = { helm: { 2: ARMOR } };
  expect(slotStatMod([helm, arms], before, MAJOR, statCost)).toEqual({
    helm: { 2: ARMOR },
    arms: { 1: MAJOR },
  });
  expect(before).toEqual({ helm: { 2: ARMOR } });
});

test("slotStatMod is null when every general socket is taken or short on energy", () => {
  const helm = mixed("helm", [{ index: 1, kind: "general" }]);
  const arms = mixed("arms", [{ index: 1, kind: "general" }, { index: 2, kind: "other" }, { index: 3, kind: "other" }, { index: 4, kind: "other" }]);
  expect(slotStatMod([helm], { helm: { 1: MINOR } }, MAJOR, statCost)).toBeNull();
  expect(slotStatMod([arms], { arms: { 2: ARMOR, 3: ARMOR, 4: ARMOR } }, MAJOR, statCost)).toBeNull();
  expect(slotStatMod([arms], { arms: { 2: ARMOR, 3: ARMOR, 4: ARMOR } }, MINOR, statCost)).toEqual({
    arms: { 1: MINOR, 2: ARMOR, 3: ARMOR, 4: ARMOR },
  });
});

test("statModSlotted checks off each desired copy against general sockets", () => {
  const helm = mixed("helm", [{ index: 1, kind: "general" }]);
  const arms = mixed("arms", [{ index: 1, kind: "general" }]);
  expect(statModSlotted([MAJOR, MINOR], { helm: { 1: MAJOR } }, [helm, arms])).toEqual([
    true,
    false,
  ]);
  expect(statModSlotted([MINOR, MINOR], { helm: { 1: MINOR }, arms: { 1: MINOR } }, [helm, arms])).toEqual([
    true,
    true,
  ]);
});

test("explicit replacement changes one desired copy and survives later armor edits", () => {
  const helm = mixed("helm", [{ index: 1, kind: "general" }, { index: 2, kind: "other" }]);
  const arms = mixed("arms", [{ index: 1, kind: "general" }]);
  const s = section({
    pieces: [helm, arms],
    catalog: { option: (h: number) => ({ cost: statCost(h) }) } as ModOptionCatalog,
    initial: { helm: { 1: MAJOR }, arms: { 1: MAJOR } },
    desiredStatMods: [MAJOR, MAJOR],
  });
  const before = { placement: s.initial, desiredStatMods: s.desiredStatMods! };
  const edited = updateEditorPiece(s, before, "helm", { 1: MINOR });
  const rebalanced = updateEditorPiece(s, edited, "helm", { 1: MINOR, 2: ARMOR });
  expect(edited.desiredStatMods).toEqual([MAJOR, MINOR]);
  expect(modsFromEditor(s, rebalanced.placement, rebalanced.desiredStatMods).sort()).toEqual([MAJOR, MINOR, ARMOR]);
  expect(before).toEqual({ placement: s.initial, desiredStatMods: [MAJOR, MAJOR] });
  expect(s.initial.helm).toEqual({ 1: MAJOR });
});

test("a manually placed unplaced stat mod is not duplicated or resurrected after removal", () => {
  const helm = mixed("helm", [{ index: 1, kind: "general" }]);
  const s = section({
    pieces: [helm],
    initial: { helm: { 1: MAJOR } },
    desiredStatMods: [MAJOR, MINOR],
    unplaced: [unplaced(MINOR), unplaced(99)],
  });
  const replaced = updateEditorPiece(s, { placement: s.initial, desiredStatMods: s.desiredStatMods! }, "helm", { 1: MINOR });
  expect(replaced.desiredStatMods).toEqual([MINOR]);
  expect(modsFromEditor(s, replaced.placement, replaced.desiredStatMods)).toEqual([MINOR, 99]);
  const cleared = updateEditorPiece(s, replaced, "helm", {});
  expect(cleared.desiredStatMods).toEqual([]);
  expect(modsFromEditor(s, cleared.placement, cleared.desiredStatMods)).toEqual([99]);
});

test("energy displacement preserves a desired stat mod and restores it when energy returns", () => {
  const helm = mixed("helm", [{ index: 1, kind: "general" }, { index: 2, kind: "other" }]);
  const s = section({
    pieces: [helm],
    catalog: { option: (h: number) => ({ cost: h === ARMOR ? 8 : statCost(h) }) } as ModOptionCatalog,
    initial: { helm: { 1: MAJOR } },
    desiredStatMods: [MAJOR],
  });
  const displaced = updateEditorPiece(s, { placement: s.initial, desiredStatMods: [MAJOR] }, "helm", { 1: MAJOR, 2: ARMOR });
  expect(displaced.placement).toEqual({ helm: { 2: ARMOR } });
  expect(displaced.desiredStatMods).toEqual([MAJOR]);
  expect(modsFromEditor(s, displaced.placement, displaced.desiredStatMods)).toEqual([ARMOR, MAJOR]);
  const restored = updateEditorPiece(s, displaced, "helm", {});
  expect(restored.placement).toEqual({ helm: { 1: MAJOR } });
});
