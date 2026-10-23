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

test("legacy columns go side by side from 1580px and align the vault from 760px", () => {
  expect(itemsPagePlan({ phone: false, layout: "legacy", width: 1580, tiles: DESKTOP_TILE_METRICS })).toEqual({
    kind: "columns",
    compact: false,
    vault: "aligned",
  });
  expect(itemsPagePlan({ phone: false, layout: "legacy", width: 1579, tiles: DESKTOP_TILE_METRICS })).toEqual({
    kind: "columns",
    compact: true,
    vault: "aligned",
  });
  expect(itemsPagePlan({ phone: false, layout: "legacy", width: 759, tiles: DESKTOP_TILE_METRICS })).toEqual({
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
});
