import { test, expect } from "vitest";
import type { ArmorPiece } from "@/lib/armory/normalize";
import type { OptimizerLoadout, StatArray } from "@/lib/optimizer/types";
import { BALANCED_TUNING_PLUG_HASH } from "../armory/stats";
import {
  buildDimLoadout,
  buildDimLoadoutUrl,
  decomposeModBonus,
  defaultLoadoutName,
  type DimLoadoutInput,
} from "./loadout-link";

const ZERO: StatArray = [0, 0, 0, 0, 0, 0];

function makePiece(i: number, over: Partial<ArmorPiece> = {}): ArmorPiece {
  return {
    instanceId: `100${i}`,
    itemHash: 2000 + i,
    name: `Piece ${i}`,
    slot: "helmet",
    classType: 1,
    isExotic: false,
    isArtifice: false,
    baseStats: [...ZERO] as StatArray,
    stats: [...ZERO] as StatArray,
    location: "vault",
    ...over,
  };
}

function makeLoadout(over: Partial<OptimizerLoadout> = {}): OptimizerLoadout {
  return {
    pieceIds: ["1000", "1001", "1002", "1003", "1004"],
    baseStats: [...ZERO] as StatArray,
    stats: [...ZERO] as StatArray,
    tuningBonus: [...ZERO] as StatArray,
    tuning: [null, null, null, null, null],
    modBonus: [...ZERO] as StatArray,
    modsUsed: { major: 0, minor: 0 },
    total: 300,
    exotic: false,
    ...over,
  };
}

/** STAT_ORDER-indexed mod hashes: major = 90i0, minor = 90i5. */
const STAT_MOD_HASHES = Array.from({ length: 6 }, (_, i) => ({
  major: 9000 + i * 10,
  minor: 9005 + i * 10,
}));

function makeInput(over: Partial<DimLoadoutInput> = {}): DimLoadoutInput {
  return {
    loadout: makeLoadout(),
    pieces: Array.from({ length: 5 }, (_, i) => makePiece(i)),
    classType: 1,
    targets: [...ZERO],
    statModHashes: STAT_MOD_HASHES,
    tuningPlugHashes: new Map([
      ["0-1", 7001],
      ["3-5", 7035],
    ]),
    name: "Test build",
    ...over,
  };
}

test("decomposeModBonus prefers majors and honors mixed +15 stats", () => {
  const { majors, minors } = decomposeModBonus(
    [15, 10, 0, 5, 0, 0],
    { major: 2, minor: 2 },
  );
  expect(majors).toEqual([1, 1, 0, 0, 0, 0]);
  expect(minors).toEqual([1, 0, 0, 1, 0, 0]);
});

test("decomposeModBonus trades majors for minors to match the optimizer's budget", () => {
  // 20 points on one stat, but the optimizer used 0 majors (4 minors).
  const { majors, minors } = decomposeModBonus(
    [20, 0, 0, 0, 0, 0],
    { major: 0, minor: 4 },
  );
  expect(majors).toEqual([0, 0, 0, 0, 0, 0]);
  expect(minors).toEqual([4, 0, 0, 0, 0, 0]);
});

test("stat mods land in parameters.mods with duplicates", () => {
  const dim = buildDimLoadout(
    makeInput({
      loadout: makeLoadout({
        modBonus: [20, 5, 0, 0, 0, 0],
        modsUsed: { major: 2, minor: 1 },
      }),
    }),
  );
  expect(dim.parameters.mods).toEqual([9000, 9000, 9015]);
});

test("tuning mods: balanced + directional resolve to plug hashes; unknown skipped", () => {
  const dim = buildDimLoadout(
    makeInput({
      loadout: makeLoadout({
        tuning: [
          { kind: "balanced" },
          { kind: "directional", plus: 0, minus: 1 },
          { kind: "directional", plus: 4, minus: 2 }, // not in the map — skipped
          null,
          null,
        ],
      }),
    }),
  );
  expect(dim.parameters.mods).toEqual([BALANCED_TUNING_PLUG_HASH, 7001]);
});

test("equipped carries the 5 pieces with string instance ids", () => {
  const dim = buildDimLoadout(makeInput());
  expect(dim.equipped).toHaveLength(5);
  expect(dim.equipped[0]).toEqual({ id: "1000", hash: 2000 });
  expect(dim.unequipped).toEqual([]);
  expect(dim.classType).toBe(1);
});

test("fragments become a synthetic subclass entry with sequential socketOverrides", () => {
  const dim = buildDimLoadout(
    makeInput({
      subclass: { itemHash: 555, fragmentHashes: [11, 22, 33], socketStart: 7 },
    }),
  );
  expect(dim.equipped).toHaveLength(6);
  expect(dim.equipped[5]).toEqual({
    id: "12345",
    hash: 555,
    socketOverrides: { 7: 11, 8: 22, 9: 33 },
  });
});

test("zero fragments selected omits the subclass entry entirely", () => {
  const dim = buildDimLoadout(
    makeInput({ subclass: { itemHash: 555, fragmentHashes: [], socketStart: 7 } }),
  );
  expect(dim.equipped).toHaveLength(5);
});

test("statConstraints only for targets > 0, clamped to 200", () => {
  const dim = buildDimLoadout(makeInput({ targets: [0, 150, 0, 0, 250, 0] }));
  expect(dim.parameters.statConstraints).toEqual([
    { statHash: 392767087, minStat: 150 }, // health
    { statHash: 144602215, minStat: 200 }, // super, clamped
  ]);
});

test("no targets set omits statConstraints", () => {
  const dim = buildDimLoadout(makeInput());
  expect(dim.parameters.statConstraints).toBeUndefined();
});

test("exotic build pins exoticArmorHash", () => {
  const pieces = Array.from({ length: 5 }, (_, i) =>
    makePiece(i, i === 2 ? { isExotic: true } : {}),
  );
  const dim = buildDimLoadout(
    makeInput({ pieces, loadout: makeLoadout({ exotic: true }) }),
  );
  expect(dim.parameters.exoticArmorHash).toBe(2002);
});

test("URL round-trips through decodeURIComponent + JSON.parse", () => {
  const dim = buildDimLoadout(
    makeInput({
      loadout: makeLoadout({
        modBonus: [10, 0, 0, 0, 0, 0],
        modsUsed: { major: 1, minor: 0 },
        tuning: [{ kind: "balanced" }, null, null, null, null],
      }),
      subclass: { itemHash: 555, fragmentHashes: [11], socketStart: 7 },
    }),
  );
  const url = buildDimLoadoutUrl(dim);
  expect(url.startsWith("https://app.destinyitemmanager.com/loadouts?loadout=")).toBe(
    true,
  );
  const decoded = JSON.parse(
    decodeURIComponent(url.slice(url.indexOf("=") + 1)),
  );
  expect(decoded).toEqual(JSON.parse(JSON.stringify(dim)));
  expect(decoded.parameters.assumeArmorMasterwork).toBe(3);
});

test("defaultLoadoutName includes total and exotic name", () => {
  expect(defaultLoadoutName(makeLoadout({ total: 375 }), "Wormhusk Crown")).toBe(
    "Stat Builder 375 — Wormhusk Crown",
  );
  expect(defaultLoadoutName(makeLoadout({ total: 300 }))).toBe(
    "Stat Builder 300 — no exotic",
  );
});
