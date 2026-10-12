import { describe, expect, it } from "vitest";
import { decodeBugReport, MAX_DESCRIPTION_LENGTH, MAX_TITLE_LENGTH } from "./bug-report";

const context = { path: "/armor", viewport: "1440×900 @2x", theme: "scene" };

describe("decodeBugReport", () => {
  it("trims the text and keeps the context", () => {
    expect(
      decodeBugReport({ title: "  Equip   skips\nhelmet ", description: " It skips it. ", context }),
    ).toEqual({ title: "Equip skips helmet", description: "It skips it.", context, website: "" });
  });

  it("needs a title and a description", () => {
    expect(decodeBugReport({ title: " ", description: "x", context })).toBeNull();
    expect(decodeBugReport({ title: "x", description: "" })).toBeNull();
    expect(decodeBugReport({ title: 1, description: "x" })).toBeNull();
    expect(decodeBugReport(null)).toBeNull();
  });

  it("refuses text over the limits rather than cutting it", () => {
    const long = (n: number) => "a".repeat(n + 1);
    expect(decodeBugReport({ title: long(MAX_TITLE_LENGTH), description: "x" })).toBeNull();
    expect(decodeBugReport({ title: "x", description: long(MAX_DESCRIPTION_LENGTH) })).toBeNull();
  });

  it("drops a path that isn't one and tolerates missing context", () => {
    const r = decodeBugReport({ title: "x", description: "y", context: { path: "https://x.y/" } });
    expect(r?.context).toEqual({ path: "", viewport: "", theme: "" });
    expect(decodeBugReport({ title: "x", description: "y" })?.context.path).toBe("");
  });

  it("passes the honeypot through for the route to act on", () => {
    expect(decodeBugReport({ title: "x", description: "y", website: "spam.biz" })?.website).toBe(
      "spam.biz",
    );
  });
});
