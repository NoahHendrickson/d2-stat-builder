import { expect, test } from "vitest";
import { commitLoadout } from "./commit";
import { modsFromEditor, type ModsSection } from "./mod-placement";
import type { ModOptionCatalog } from "./mod-options";
import type { SavedLoadoutData } from "./types";
import type { Manifest } from "../manifest/load";
import type { ArmorPiece } from "../armory/normalize";

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
