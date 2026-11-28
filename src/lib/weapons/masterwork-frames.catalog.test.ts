// The shipped catalog's crafted frames: each one counts under exactly one of its
// weapon's masterworks, or masterworkLookup would credit it to whichever came last.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { CompactWeaponIndex } from "./transport";

const catalog = JSON.parse(readFileSync(join(process.cwd(), "public/data/weapons.json"), "utf8")) as CompactWeaponIndex;

describe("shipped masterworkFrames", () => {
  it("lists no frame under two of a weapon's masterworks", () => {
    const repeated = catalog.weapons.flatMap((weapon) => {
      const frames = (weapon.masterworkFrames ?? []).flat();
      return new Set(frames).size === frames.length ? [] : [weapon.name];
    });
    expect(catalog.weapons.some((weapon) => weapon.masterworkFrames?.length)).toBe(true);
    expect(repeated).toEqual([]);
  });
});
