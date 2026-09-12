import { expect, test } from "vitest";
import { lightTintFromPixels } from "./light-tint";

function pixels(rgba: number[]): Uint8ClampedArray {
  return new Uint8ClampedArray(rgba);
}

test("lightTintFromPixels ignores empty and plate-only images", () => {
  expect(lightTintFromPixels(pixels([0, 0, 0, 0, 8, 8, 8, 255]))).toBeUndefined();
});

test("lightTintFromPixels turns a saturated color into a hue+sat token", () => {
  // Solar-ish orange on a black plate.
  const tint = lightTintFromPixels(
    pixels([0, 0, 0, 255, 232, 120, 24, 255, 240, 140, 40, 255]),
  );
  expect(tint).toMatch(/^(\d+) (\d+)%$/);
  const hue = Number(tint!.match(/^(\d+)/)?.[1]);
  expect(hue).toBeGreaterThanOrEqual(15);
  expect(hue).toBeLessThanOrEqual(45);
});

test("lightTintFromPixels prefers the colorful glyph over gray plate pixels", () => {
  const gray = [90, 90, 90, 255];
  const voidPurple = [140, 70, 220, 255];
  const tint = lightTintFromPixels(
    pixels([...gray, ...gray, ...gray, ...voidPurple, ...voidPurple]),
  );
  const hue = Number(tint!.match(/^(\d+)/)?.[1]);
  expect(hue).toBeGreaterThanOrEqual(250);
  expect(hue).toBeLessThanOrEqual(290);
});
