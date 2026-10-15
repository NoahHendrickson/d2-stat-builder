import { expect, test } from "vitest";
import { CHARACTER_ROW_PX, itemsPagePlan } from "./items-page-plan";

test("phones get the phone layout whatever is picked, measured or not", () => {
  for (const layout of ["rows", "legacy"] as const) {
    expect(itemsPagePlan({ phone: true, layout, width: 0 })).toEqual({ kind: "phone" });
    expect(itemsPagePlan({ phone: true, layout, width: 600 })).toEqual({ kind: "phone" });
  }
});

test("nothing is planned before a wider screen is measured", () => {
  expect(itemsPagePlan({ phone: false, layout: "rows", width: 0 })).toBeNull();
  expect(itemsPagePlan({ phone: false, layout: "legacy", width: 0 })).toBeNull();
});

test("character rows put the vault beside them, then below, then fall back to columns", () => {
  expect(itemsPagePlan({ phone: false, layout: "rows", width: 1600 })).toEqual({ kind: "rows", vault: "beside" });
  expect(itemsPagePlan({ phone: false, layout: "rows", width: CHARACTER_ROW_PX })).toEqual({
    kind: "rows",
    vault: "below",
  });
  expect(itemsPagePlan({ phone: false, layout: "rows", width: CHARACTER_ROW_PX - 1 })).toEqual({
    kind: "columns",
    compact: true,
    vault: "below",
  });
});

test("legacy columns go side by side from 1580px and align the vault from 760px", () => {
  expect(itemsPagePlan({ phone: false, layout: "legacy", width: 1580 })).toEqual({
    kind: "columns",
    compact: false,
    vault: "aligned",
  });
  expect(itemsPagePlan({ phone: false, layout: "legacy", width: 1579 })).toEqual({
    kind: "columns",
    compact: true,
    vault: "aligned",
  });
  expect(itemsPagePlan({ phone: false, layout: "legacy", width: 759 })).toEqual({
    kind: "columns",
    compact: true,
    vault: "below",
  });
});
