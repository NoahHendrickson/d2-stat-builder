import { expect, test } from "vitest";
import { BUCKETS } from "./buckets";
import { maxPower, type PowerItem } from "./max-power";

const it = (bucketHash: number, power: number, extra: Partial<PowerItem> = {}): PowerItem => ({
  bucketHash,
  power,
  classType: 3,
  tierType: 5,
  ...extra,
});

const fullSet = (power: number, classType = 1): PowerItem[] => [
  it(BUCKETS.kinetic, power),
  it(BUCKETS.energy, power),
  it(BUCKETS.power, power),
  it(BUCKETS.helmet, power, { classType }),
  it(BUCKETS.arms, power, { classType }),
  it(BUCKETS.chest, power, { classType }),
  it(BUCKETS.legs, power, { classType }),
  it(BUCKETS.classItem, power, { classType }),
];

test("averages the best item per slot, floored", () => {
  const items = [...fullSet(400), it(BUCKETS.kinetic, 407)];
  expect(maxPower(items, 1)).toBe(400); // 3207 / 8 = 400.875
  expect(maxPower([...items, it(BUCKETS.energy, 401)], 1)).toBe(401);
});

test("allows one exotic weapon and one exotic armor piece, placed where they gain most", () => {
  const items = [
    ...fullSet(400),
    it(BUCKETS.kinetic, 410, { tierType: 6 }),
    it(BUCKETS.energy, 420, { tierType: 6 }),
    it(BUCKETS.helmet, 416, { tierType: 6, classType: 1 }),
    it(BUCKETS.chest, 408, { tierType: 6, classType: 1 }),
  ];
  // Energy exotic (+20) and helmet exotic (+16): 3236 / 8 = 404.5.
  expect(maxPower(items, 1)).toBe(404);
});

test("ignores other classes' armor and counts a missing slot as 0", () => {
  const items = [...fullSet(400), it(BUCKETS.helmet, 480, { classType: 0 })];
  expect(maxPower(items, 1)).toBe(400);
  expect(maxPower(fullSet(400).slice(0, 7), 1)).toBe(350);
  expect(maxPower([], 1)).toBeUndefined();
});
