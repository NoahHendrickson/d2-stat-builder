import { expect, it } from "vitest";
import { sortTheoryRecipes } from "./sort-theory";
import type { TheoryRecipe } from "../optimizer/theory";

const recipe = (key: string, weapons: number) =>
  ({ key, stats: [weapons, 0, 0, 0, 0, 0] }) as TheoryRecipe;
const list = [recipe("a", 100), recipe("b", 150), recipe("c", 100)];
const keys = (r: TheoryRecipe[]) => r.map((x) => x.key);

it("keeps the solver's order for best match, and reverses it low to high", () => {
  expect(keys(sortTheoryRecipes(list, { key: "best", asc: false }))).toEqual(["a", "b", "c"]);
  expect(keys(sortTheoryRecipes(list, { key: "best", asc: true }))).toEqual(["c", "b", "a"]);
});

it("sorts by a stat, ties in the solver's order", () => {
  expect(keys(sortTheoryRecipes(list, { key: "weapons", asc: false }))).toEqual(["b", "a", "c"]);
  expect(keys(sortTheoryRecipes(list, { key: "weapons", asc: true }))).toEqual(["a", "c", "b"]);
});
