import { expect, test } from "vitest";
import { commitLoadout } from "./commit";
import { modsFromEditor, toggleExclusiveMod, updateEditorPiece, type ModsSection } from "./mod-placement";
import type { ModOptionCatalog } from "./mod-options";
import type { SavedLoadoutData } from "./types";
import type { Manifest } from "../manifest/load";
import type { ArmorPiece } from "../armory/normalize";
import { planLoadoutPlugs } from "./apply-plan";

const piece = (instanceId: string): ArmorPiece =>
  ({
    instanceId,
    name: instanceId,
    armorSockets: [{ index: 1, kind: "general", category: "" }],
  }) as unknown as ArmorPiece;

const data = (): SavedLoadoutData => ({
  version: 1,
  loadout: {
    id: "l",
    name: "L",
    classType: 0,
    equipped: [],
    unequipped: [],
    parameters: { mods: [10], assumeArmorMasterwork: 0 },
  },
  optimizer: {
    pieceIds: ["a"],
    baseStats: [0, 0, 0, 0, 0, 0],
    stats: [10, 0, 0, 0, 0, 0],
    tuningBonus: [0, 0, 0, 0, 0, 0],
    tuning: [null],
    modBonus: [10, 0, 0, 0, 0, 0],
    modsUsed: { major: 1, minor: 0 },
    artificeBonus: [0, 0, 0, 0, 0, 0],
    artifice: [null],
    total: 10,
    exotic: false,
  },
});

test("commitLoadout writes picker mods and placement onto the payload", () => {
  const mods: ModsSection = {
    pieces: [piece("a")],
    catalog: {} as ModOptionCatalog,
    initial: { a: { 1: 10 } },
    unplaced: [],
  };
  const placement = { a: { 1: 20 } };
  const out = commitLoadout(
    data(),
    {} as Manifest,
    { placement, stats: { stats: [20, 0, 0, 0, 0, 0], total: 20 } },
    mods,
  );
  expect(out.loadout.parameters.mods).toEqual(modsFromEditor(mods, placement));
  expect(out.modPlacement).toEqual(placement);
  expect(out.optimizer?.stats).toEqual([20, 0, 0, 0, 0, 0]);
  expect(out.optimizer?.total).toBe(20);
});

test("commitLoadout without a picker keeps the existing mods list", () => {
  const out = commitLoadout(data(), {} as Manifest, {
    placement: { a: { 1: 20 } },
  });
  expect(out.loadout.parameters.mods).toEqual([10]);
  expect(out.modPlacement).toEqual({ a: { 1: 20 } });
});

test.each([
  { path: "save", replacement: 20 },
  { path: "edit", replacement: 20 },
  { path: "save", replacement: null },
  { path: "edit", replacement: null },
])("$path: stat-mod replacement/removal ($replacement) survives saving and apply", ({ path, replacement }) => {
  const mods: ModsSection = {
    pieces: [piece("a"), piece("b")],
    catalog: {} as ModOptionCatalog,
    initial: { a: { 1: 10 } },
    unplaced: [],
    desiredStatMods: [10],
  };
  const state = updateEditorPiece(
    mods,
    { placement: mods.initial, desiredStatMods: [10] },
    "a",
    toggleExclusiveMod(mods.initial.a, mods.pieces[0].armorSockets!, replacement ?? 10),
  );
  const payload = { ...data(), modPlacement: mods.initial };
  // Save builds the DIM payload in its drawer; Edit passes the picker to commit.
  if (path === "save") {
    payload.loadout.parameters.mods = modsFromEditor(mods, state.placement, state.desiredStatMods);
  }
  const saved = commitLoadout(payload, {} as Manifest, state, path === "edit" ? mods : undefined);
  expect(saved.loadout.parameters.mods).toEqual(replacement ? [replacement] : []);
  expect(saved.modPlacement).toEqual(replacement ? { a: { 1: replacement } } : undefined);
  const plan = planLoadoutPlugs({
    pieces: mods.pieces.map((p) => ({
      instanceId: p.instanceId,
      name: p.name,
      sockets: [{ index: 1, kind: "general" }],
      energy: { capacity: 10, used: 0 },
    })),
    modHashes: saved.loadout.parameters.mods,
    placements: saved.modPlacement,
    plugInfo: () => ({ kind: "general", name: "Stat mod", cost: 3 }),
  });
  expect(plan.assigned).toEqual(replacement ? { a: { 1: replacement } } : {});
  expect(plan.skipped).toEqual([]);
});
