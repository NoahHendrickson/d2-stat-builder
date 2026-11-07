import { expect, test } from "vitest";
import { listAnd } from "./format-list";

test("listAnd joins names without an Oxford comma", () => {
  expect(listAnd([])).toBe("");
  expect(listAnd(["Arms"])).toBe("Arms");
  expect(listAnd(["Arms", "Legs"])).toBe("Arms and Legs");
  expect(listAnd(["Helmet", "Arms", "Legs"])).toBe("Helmet, Arms and Legs");
});
