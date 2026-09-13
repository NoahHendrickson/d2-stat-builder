import { expect, test } from "vitest";
import { armorPowerSpan, reachableGearPower, seedPowerRange } from "./power-span";

const p = (power?: number) => ({ power });

test("armorPowerSpan sums each slot's extremes and skips slots with no known power", () => {
  expect(
    armorPowerSpan([
      [p(300), p(280)],
      [p(290)],
      [p(), p(285)],
      [p()],
      [p(295), p(250)],
    ]),
  ).toEqual({ minSum: 280 + 290 + 285 + 250, maxSum: 300 + 290 + 285 + 295, slots: 4 });
  expect(armorPowerSpan([[p()], [p()]])).toBeNull();
  expect(armorPowerSpan([])).toBeNull();
});

test("reachableGearPower is the floored mean of the extremes plus the weapons", () => {
  const span = { minSum: 5 * 200, maxSum: 5 * 298, slots: 5 };
  expect(reachableGearPower(span, [])).toEqual({ min: 200, max: 298 });
  // (1490 + 3·300) / 8 = 298.75 → 298; (1000 + 900) / 8 = 237.5 → 237.
  expect(reachableGearPower(span, [300, 300, 300])).toEqual({ min: 237, max: 298 });
});

test("seedPowerRange is the top five reachable levels; one outlier piece doesn't set it", () => {
  // One 300 helmet, everything else 250: the old single-piece seed (295–300) was unreachable.
  const span = armorPowerSpan([[p(300), p(250)], [p(250)], [p(250)], [p(250)], [p(250)]])!;
  expect(reachableGearPower(span, [])).toEqual({ min: 250, max: 260 });
  expect(seedPowerRange(span, [])).toEqual({ min: 255, max: 260 });
  // Reach narrower than five levels: clamp the minimum to what's reachable.
  const flat = armorPowerSpan([[p(290)], [p(290)], [p(290)], [p(290)], [p(291)]])!;
  expect(seedPowerRange(flat, [])).toEqual({ min: 290, max: 290 });
});
