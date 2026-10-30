import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { SITE_ICONS } from "./site-icon";

// The icons are Figma exports, and a fresh export can undo a hand fix, so check the art
// itself: every pixel on the 24×24 grid, and the gold frame painted over the art.
const icons = SITE_ICONS.map((icon) => ({
  id: icon.id,
  svg: readFileSync(join(process.cwd(), "public", icon.src), "utf8"),
}));

test.each(icons)("$id draws the frame after every art pixel", ({ svg }) => {
  const frame = svg.indexOf('stroke="url(#paint0');
  expect(frame).toBeGreaterThan(-1);
  expect(svg.lastIndexOf('<rect id="Rectangle')).toBeLessThan(frame);
});

test.each(icons)("$id keeps every art pixel on the grid", ({ svg }) => {
  for (const [rect] of svg.matchAll(/<rect id="Rectangle[^>]*>/g)) {
    for (const [, value] of rect.matchAll(/ (?:x|y|width|height)="([^"]*)"/g)) {
      expect(Number.isInteger(Number(value)), rect).toBe(true);
    }
    expect(rect).not.toMatch(/rotate\(|skew/);
    // Figma writes flipped pixels as matrix(±1 0 0 ±1 x y); anything else is off-grid.
    const matrix = rect.match(/matrix\(([^)]*)\)/);
    if (matrix) {
      const [a, b, c, d, tx, ty] = matrix[1].split(/[\s,]+/).map(Number);
      expect([Math.abs(a), b, c, Math.abs(d)], rect).toEqual([1, 0, 0, 1]);
      expect(Number.isInteger(tx) && Number.isInteger(ty), rect).toBe(true);
    }
  }
});
