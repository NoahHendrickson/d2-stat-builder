import { expect, test } from "vitest";
import { loadoutPower } from "../optimizer/power";
import { armorPowerSpan, reachableGearPower, seedPowerRange } from "./power-span";

/** A legendary at `power` (undefined = a theoretical roll with no known power). */
const p = (power?: number) => ({ power, isExotic: false });
/** An exotic at `power`. */
const x = (power?: number) => ({ power, isExotic: true });

/** Five slots, one 300 legendary each. */
const flat300 = () => [[p(300)], [p(300)], [p(300)], [p(300)], [p(300)]];

test("armorPowerSpan keeps each slot's legendary / exotic extremes and skips slots with no known power", () => {
  expect(
    armorPowerSpan([
      [p(300), p(280), x(310)],
      [p(290)],
      [p(), p(285)],
      [p()],
      [x(295), x(250)],
    ]),
  ).toEqual([
    { legendary: { lo: 280, hi: 300 }, exotic: { lo: 310, hi: 310 }, excludable: false },
    { legendary: { lo: 290, hi: 290 }, exotic: null, excludable: false },
    { legendary: { lo: 285, hi: 285 }, exotic: null, excludable: true },
    { legendary: null, exotic: { lo: 250, hi: 295 }, excludable: false },
  ]);
  expect(armorPowerSpan([[p()], [p()]])).toBeNull();
  expect(armorPowerSpan([])).toBeNull();
});

test("reachableGearPower is the floored mean of the extremes plus the weapons", () => {
  const span = armorPowerSpan([
    [p(200), p(298)],
    [p(200), p(298)],
    [p(200), p(298)],
    [p(200), p(298)],
    [p(200), p(298)],
  ])!;
  expect(reachableGearPower(span, [])).toEqual({ min: 200, max: 298 });
  // (1490 + 3·300) / 8 = 298.75 → 298; (1000 + 900) / 8 = 237.5 → 237.
  expect(reachableGearPower(span, [300, 300, 300])).toEqual({ min: 237, max: 298 });
});

test("a slot with an unknown-power piece can be left out of the mean, as the solver does", () => {
  // Four 300s plus a class-item slot offering a 200 legendary or a synthetic roll with no
  // power: the solver counts only the four when it picks the synthetic, so 300 is reachable.
  const span = armorPowerSpan([...flat300().slice(0, 4), [p(200), p()]])!;
  expect(reachableGearPower(span, [])).toEqual({ min: 280, max: 300 });
  // With weapons, leaving the slot out still changes the denominator: (1200 + 250) / 5 = 290.
  expect(reachableGearPower(span, [250])).toEqual({ min: 275, max: 290 });
  // Leaving every slot out gives a null power — not a level, so only the counted filling spans.
  expect(
    reachableGearPower([{ legendary: { lo: 300, hi: 300 }, exotic: null, excludable: true }], []),
  ).toEqual({ min: 300, max: 300 });
});

test("at most one exotic joins the mean", () => {
  // A 300 exotic and a 200 legendary in every slot: only one exotic fits, so 220 tops out.
  const slots = [
    [x(300), p(200)],
    [x(300), p(200)],
    [x(300), p(200)],
    [x(300), p(200)],
    [x(300), p(200)],
  ];
  expect(reachableGearPower(armorPowerSpan(slots)!, [])).toEqual({ min: 200, max: 220 });
  // A slot with only exotics forces the exotic there, so no other slot can take one.
  const forced = [[x(300)], [x(300), p(200)], [p(200)], [p(200)], [p(200)]];
  expect(reachableGearPower(armorPowerSpan(forced)!, [])).toEqual({ min: 220, max: 220 });
  // Two exotic-only slots: no legal loadout at all.
  const impossible = [[x(300)], [x(300)], [p(200)], [p(200)], [p(200)]];
  expect(reachableGearPower(armorPowerSpan(impossible)!, [])).toBeNull();
});

test("reachableGearPower matches a brute-force walk of the solver's power arithmetic", () => {
  const slots = [
    [p(300), p(250), x(310)],
    [p(290), x(200)],
    [p(), p(285)],
    [p(0), p(270)],
    [x(21), p(295), p()],
  ];
  const weaponSets: number[][] = [[], [300], [250, 300, 310]];
  for (const weapons of weaponSets) {
    let min = Infinity;
    let max = -Infinity;
    const walk = (k: number, chosen: { power?: number; isExotic: boolean }[]): void => {
      if (k === slots.length) {
        if (chosen.filter((c) => c.isExotic).length > 1) return;
        const power = loadoutPower(chosen, weapons);
        if (power === null) return;
        min = Math.min(min, power);
        max = Math.max(max, power);
        return;
      }
      for (const c of slots[k]) walk(k + 1, [...chosen, c]);
    };
    walk(0, []);
    expect(reachableGearPower(armorPowerSpan(slots)!, weapons)).toEqual({ min, max });
  }
});

test("seedPowerRange is the top five reachable levels; one outlier piece doesn't set it", () => {
  // One 300 helmet, everything else 250: the old single-piece seed (295–300) was unreachable.
  const span = armorPowerSpan([[p(300), p(250)], [p(250)], [p(250)], [p(250)], [p(250)]])!;
  expect(reachableGearPower(span, [])).toEqual({ min: 250, max: 260 });
  expect(seedPowerRange(span, [])).toEqual({ min: 255, max: 260 });
  // Reach narrower than five levels: clamp the minimum to what's reachable.
  const flat = armorPowerSpan([[p(290)], [p(290)], [p(290)], [p(290)], [p(291)]])!;
  expect(seedPowerRange(flat, [])).toEqual({ min: 290, max: 290 });
  // A 300 exotic in every slot over 200 legendaries seeds around 220, not 300.
  const exotics = armorPowerSpan([
    [x(300), p(200)],
    [x(300), p(200)],
    [x(300), p(200)],
    [x(300), p(200)],
    [x(300), p(200)],
  ])!;
  expect(seedPowerRange(exotics, [])).toEqual({ min: 215, max: 220 });
  expect(seedPowerRange([{ legendary: null, exotic: { lo: 1, hi: 1 }, excludable: false }, { legendary: null, exotic: { lo: 1, hi: 1 }, excludable: false }], [])).toBeNull();
});
