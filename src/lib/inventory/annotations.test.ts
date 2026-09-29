import { expect, test } from "vitest";
import { parseAnnotations, updateAnnotations } from "./annotations";

test("parseAnnotations keeps only well-formed tags and notes", () => {
  const raw = JSON.stringify({
    a: { tag: "junk" },
    b: { tag: "bogus", notes: "  #pvp roll " },
    c: { notes: "   " },
    d: "nope",
  });
  expect(parseAnnotations(raw)).toEqual({ a: { tag: "junk" }, b: { notes: "  #pvp roll " } });
  expect(parseAnnotations("{not json")).toEqual({});
  expect(parseAnnotations(null)).toEqual({});
});

test("updateAnnotations patches many items and drops empty entries", () => {
  const start = { a: { tag: "keep" as const, notes: "god roll" }, b: { tag: "junk" as const } };
  const tagged = updateAnnotations(start, ["a", "b", "c"], { tag: "infuse" });
  expect(tagged).toEqual({
    a: { tag: "infuse", notes: "god roll" },
    b: { tag: "infuse" },
    c: { tag: "infuse" },
  });
  const cleared = updateAnnotations(tagged, ["a", "b"], { tag: undefined });
  expect(cleared).toEqual({ a: { notes: "god roll" }, c: { tag: "infuse" } });
  expect(updateAnnotations(cleared, ["a"], { notes: "" })).toEqual({ c: { tag: "infuse" } });
  // The input is never mutated.
  expect(start.a.tag).toBe("keep");
});
