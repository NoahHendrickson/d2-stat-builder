import { expect, test } from "vitest";
import { ROW_STRIP_MIN_PX, characterRowWidth, itemsPagePlan } from "./items-page-plan";
import { DESKTOP_TILE_METRICS, desktopTileMetrics } from "./vault-layout";

/** The plan with every character side by side asked for, unless a test says otherwise. */
const plan = (input: Omit<Parameters<typeof itemsPagePlan>[0], "characterColumns"> & {
  characterColumns?: Parameters<typeof itemsPagePlan>[0]["characterColumns"];
}) => itemsPagePlan({ characterColumns: "all", ...input });

const CHARACTER_ROW_PX = characterRowWidth(DESKTOP_TILE_METRICS);

test("phones get the phone layout whatever is picked, measured or not", () => {
  for (const layout of ["rows", "legacy"] as const) {
    expect(plan({ phone: true, layout, width: 0, tiles: DESKTOP_TILE_METRICS })).toEqual({ kind: "phone" });
    expect(plan({ phone: true, layout, width: 600, tiles: DESKTOP_TILE_METRICS })).toEqual({ kind: "phone" });
  }
});

test("nothing is planned before a wider screen is measured", () => {
  expect(plan({ phone: false, layout: "rows", width: 0, tiles: DESKTOP_TILE_METRICS })).toBeNull();
  expect(plan({ phone: false, layout: "legacy", width: 0, tiles: DESKTOP_TILE_METRICS })).toBeNull();
});

test("character rows put the vault beside them, then below, then fall back to columns", () => {
  expect(plan({ phone: false, layout: "rows", width: 1600, tiles: DESKTOP_TILE_METRICS })).toEqual({ kind: "rows", vault: "beside" });
  expect(plan({ phone: false, layout: "rows", width: CHARACTER_ROW_PX, tiles: DESKTOP_TILE_METRICS })).toEqual({
    kind: "rows",
    vault: "below",
  });
  expect(plan({ phone: false, layout: "rows", width: CHARACTER_ROW_PX - 1, tiles: DESKTOP_TILE_METRICS })).toEqual({
    kind: "columns",
    characters: "tabs",
    vault: "below",
    characterMenu: false,
  });
});

test("legacy columns go side by side from 1634px and align the vault from 778px", () => {
  expect(plan({ phone: false, layout: "legacy", width: 1634, tiles: DESKTOP_TILE_METRICS })).toEqual({
    kind: "columns",
    characters: "all",
    vault: "aligned",
    characterMenu: true,
  });
  expect(plan({ phone: false, layout: "legacy", width: 1633, tiles: DESKTOP_TILE_METRICS })).toEqual({
    kind: "columns",
    characters: "tabs",
    vault: "aligned",
    characterMenu: true,
  });
  expect(plan({ phone: false, layout: "legacy", width: 777, tiles: DESKTOP_TILE_METRICS })).toEqual({
    kind: "columns",
    characters: "tabs",
    vault: "below",
    characterMenu: true,
  });
});

test("smaller tiles fit the character rows, and every legacy column, in less width", () => {
  const small = desktopTileMetrics("small");
  const width = characterRowWidth(small);
  expect(width).toBeLessThan(CHARACTER_ROW_PX);
  // The nameplate strip across the row holds it open past its tiles.
  expect(width).toBe(ROW_STRIP_MIN_PX);
  expect(plan({ phone: false, layout: "rows", width, tiles: small })).toEqual({ kind: "rows", vault: "below" });
  expect(plan({ phone: false, layout: "rows", width, tiles: DESKTOP_TILE_METRICS })).toEqual({
    kind: "columns",
    characters: "tabs",
    vault: "below",
    characterMenu: false,
  });
  expect(plan({ phone: false, layout: "legacy", width: 1500, tiles: small })).toMatchObject({ characters: "all" });
  expect(plan({ phone: false, layout: "legacy", width: 1500, tiles: DESKTOP_TILE_METRICS })).toMatchObject({ characters: "tabs" });
  // One column under tabs leaves the aligned vault as many tiles across at every size.
  expect(plan({ phone: false, layout: "legacy", width: 700, tiles: small })).toMatchObject({ vault: "aligned" });
  expect(plan({ phone: false, layout: "legacy", width: 700, tiles: DESKTOP_TILE_METRICS })).toMatchObject({ vault: "below" });
});

test("legacy columns show just the current character at every width once it's picked", () => {
  const current = { phone: false, layout: "legacy", characterColumns: "current" } as const;
  for (const width of [3000, 1634]) {
    expect(plan({ ...current, width, tiles: DESKTOP_TILE_METRICS })).toEqual({
      kind: "columns",
      characters: "current",
      vault: "aligned",
      characterMenu: true,
    });
  }
  // Narrower than every column side by side, it still shows just that one, no tabs.
  expect(plan({ ...current, width: 1633, tiles: DESKTOP_TILE_METRICS })).toEqual({
    kind: "columns",
    characters: "current",
    vault: "aligned",
    characterMenu: true,
  });
  expect(plan({ ...current, width: 777, tiles: DESKTOP_TILE_METRICS })).toEqual({
    kind: "columns",
    characters: "current",
    vault: "below",
    characterMenu: true,
  });
  // The rows layout doesn't read it.
  expect(plan({ phone: false, layout: "rows", characterColumns: "current", width: 1600, tiles: DESKTOP_TILE_METRICS })).toEqual({
    kind: "rows",
    vault: "beside",
  });
});
