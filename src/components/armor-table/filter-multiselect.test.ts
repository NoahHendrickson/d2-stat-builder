import { test, expect } from "vitest";
import {
  selectedLabels,
  selectionSummaryText,
} from "./filter-multiselect";

const options = [
  { value: 0, label: "Titan" },
  { value: 1, label: "Hunter" },
  { value: 2, label: "Warlock" },
];

test("selectedLabels maps values in selection order", () => {
  expect(selectedLabels([2, 0], options)).toEqual(["Warlock", "Titan"]);
});

test("selectionSummaryText is null when nothing is selected", () => {
  expect(selectionSummaryText([], options)).toBeNull();
});

test("selectionSummaryText lists every selected label", () => {
  expect(selectionSummaryText([2], options)).toBe("Warlock");
  expect(selectionSummaryText([2, 0, 1], options)).toBe(
    "Warlock, Titan, Hunter",
  );
});
