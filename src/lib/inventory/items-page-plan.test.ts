import { expect, test } from "vitest";
import { ROW_STRIP_MIN_PX, characterRowWidth, itemsPagePlan } from "./items-page-plan";
import { DESKTOP_TILE_METRICS, desktopTileMetrics } from "./vault-layout";

const CHARACTER_ROW_PX = characterRowWidth(DESKTOP_TILE_METRICS);

test("phones get the phone layout whatever is picked, measured or not", () => {
  for (const layout of ["rows", "legacy"] as const) {
    expect(itemsPagePlan({ phone: true, layout, width: 0, tiles: DESKTOP_TILE_METRICS })).toEqual({ kind: "phone" });
    expect(itemsPagePlan({ phone: true, layout, width: 600, tiles: DESKTOP_TILE_METRICS })).toEqual({ kind: "phone" });
  }
});

test("nothing is planned before a wider screen is measured", () => {
  expect(itemsPagePlan({ phone: false, layout: "rows", width: 0, tiles: DESKTOP_TILE_METRICS })).toBeNull();
  expect(itemsPagePlan({ phone: false, layout: "legacy", width: 0, tiles: DESKTOP_TILE_METRICS })).toBeNull();
});

test("character rows put the vault beside them, then below, then fall back to columns", () => {
  expect(itemsPagePlan({ phone: false, layout: "rows", width: 1600, tiles: DESKTOP_TILE_METRICS })).toEqual({ kind: "rows", vault: "beside" });
  expect(itemsPagePlan({ phone: false, layout: "rows", width: CHARACTER_ROW_PX, tiles: DESKTOP_TILE_METRICS })).toEqual({
    kind: "rows",
    vault: "below",
  });
  expect(itemsPagePlan({ phone: false, layout: "rows", width: CHARACTER_ROW_PX - 1, tiles: DESKTOP_TILE_METRICS })).toEqual({
    kind: "columns",
    compact: true,
    vault: "below",
  });
});

test("legacy columns go side by side from 1634px and align the vault from 778px", () => {
  expect(itemsPagePlan({ phone: false, layout: "legacy", width: 1634, tiles: DESKTOP_TILE_METRICS })).toEqual({
    kind: "columns",
    compact: false,
    vault: "aligned",
  });
  expect(itemsPagePlan({ phone: false, layout: "legacy", width: 1633, tiles: DESKTOP_TILE_METRICS })).toEqual({
    kind: "columns",
    compact: true,
    vault: "aligned",
  });
  expect(itemsPagePlan({ phone: false, layout: "legacy", width: 777, tiles: DESKTOP_TILE_METRICS })).toEqual({
    kind: "columns",
    compact: true,
    vault: "below",
  });
});

test("smaller tiles fit the character rows, and every legacy column, in less width", () => {
  const small = desktopTileMetrics("small");
  const width = characterRowWidth(small);
  expect(width).toBeLessThan(CHARACTER_ROW_PX);
  // The nameplate strip across the row holds it open past its tiles.
  expect(width).toBe(ROW_STRIP_MIN_PX);
  expect(itemsPagePlan({ phone: false, layout: "rows", width, tiles: small })).toEqual({ kind: "rows", vault: "below" });
  expect(itemsPagePlan({ phone: false, layout: "rows", width, tiles: DESKTOP_TILE_METRICS })).toEqual({
    kind: "columns",
    compact: true,
    vault: "below",
  });
  expect(itemsPagePlan({ phone: false, layout: "legacy", width: 1500, tiles: small })).toMatchObject({ compact: false });
  expect(itemsPagePlan({ phone: false, layout: "legacy", width: 1500, tiles: DESKTOP_TILE_METRICS })).toMatchObject({ compact: true });
  // One column under tabs leaves the aligned vault as many tiles across at every size.
  expect(itemsPagePlan({ phone: false, layout: "legacy", width: 700, tiles: small })).toMatchObject({ vault: "aligned" });
  expect(itemsPagePlan({ phone: false, layout: "legacy", width: 700, tiles: DESKTOP_TILE_METRICS })).toMatchObject({ vault: "below" });
});

test("legacy columns can show one character at a time at any width", () => {
  for (const width of [3000, 1634, 778]) {
    expect(
      itemsPagePlan({ phone: false, layout: "legacy", characterColumns: "one", width, tiles: DESKTOP_TILE_METRICS }),
    ).toEqual({ kind: "columns", compact: true, vault: "aligned" });
  }
  expect(
    itemsPagePlan({ phone: false, layout: "legacy", characterColumns: "one", width: 777, tiles: DESKTOP_TILE_METRICS }),
  ).toEqual({ kind: "columns", compact: true, vault: "below" });
  // The rows layout doesn't read it.
  expect(
    itemsPagePlan({ phone: false, layout: "rows", characterColumns: "one", width: 1600, tiles: DESKTOP_TILE_METRICS }),
  ).toEqual({ kind: "rows", vault: "beside" });
});
