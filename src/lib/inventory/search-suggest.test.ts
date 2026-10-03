import { expect, test } from "vitest";
import { applySuggestion, suggestSearch, type SearchVocab } from "./search-suggest";

const vocab: SearchVocab = {
  types: () => ["Auto Rifle", "Hand Cannon", "Helmet"],
  perks: () => ["kill clip", "killing wind", "outlaw", "rapid hit"],
  origins: () => ["veist stinger"],
  names: () => ["Calus Mini-Tool", "Fatebringer"],
  stats: () => ["handling", "range", "reloadspeed"],
};

const texts = (query: string, caret = query.length) =>
  suggestSearch(query, caret, vocab)?.items.map((s) => s.text);

test("completes is: keywords, exact match first", () => {
  expect(texts("is:craft")).toEqual(["is:crafted", "is:craftable"]);
  expect(texts("not:lock")).toEqual(["not:locked", "not:unlocked", "not:warlock"]);
  // Already typed out and nothing else matches: nothing to offer.
  expect(texts("is:craftable")).toBeUndefined();
});

test("completes fixed and open-ended values, quoting multi-word ones", () => {
  expect(texts("tag:j")).toEqual(["tag:junk"]);
  expect(texts("champion:ov")).toEqual(["champion:overload"]);
  expect(texts("perk:kil")).toEqual(['perk:"kill clip"', 'perk:"killing wind"']);
  expect(texts('perk:"kill c')).toEqual(['perk:"kill clip"']);
  expect(texts("type:cannon")).toEqual(['type:"Hand Cannon"']);
  expect(texts("origin:vei")).toEqual(['origin:"veist stinger"']);
  expect(texts("stat:ra")).toEqual(["stat:range:"]);
  expect(texts("stat:range:>5")).toBeUndefined();
  expect(texts("power:4")).toBeUndefined();
});

test("a bare word suggests keys, keywords, and the account's types, perks, and items", () => {
  expect(texts("pe")).toEqual(["perk:"]);
  expect(texts("craf")).toEqual(["is:crafted", "is:craftable"]);
  expect(texts("fate")).toEqual(["name:Fatebringer"]);
  expect(texts("out")).toEqual(["perk:outlaw"]);
  expect(texts("-is:ex")).toEqual(["-is:exotic"]);
});

test("only the term the caret ends, and never operators", () => {
  expect(texts("is:weapon kil")).toEqual(['perk:"kill clip"', 'perk:"killing wind"']);
  expect(texts("is:weapon kil", 4)).toBeUndefined();
  expect(texts("(is:ex")).toEqual(["is:exotic"]);
  expect(texts("a or")).toBeUndefined();
  expect(texts("is:weapon ")).toBeUndefined();
  expect(suggestSearch("is:weapon kil", 13, vocab)).toMatchObject({ start: 10, end: 13 });
});

test("applying a suggestion replaces the term and places the caret", () => {
  expect(applySuggestion("is:weapon kil", { start: 10, end: 13 }, 'perk:"kill clip"')).toEqual({
    query: 'is:weapon perk:"kill clip" ',
    caret: 27,
  });
  expect(applySuggestion("pe", { start: 0, end: 2 }, "perk:")).toEqual({ query: "perk:", caret: 5 });
  expect(applySuggestion("is:ex is:weapon", { start: 0, end: 5 }, "is:exotic")).toEqual({
    query: "is:exotic is:weapon",
    caret: 10,
  });
});
