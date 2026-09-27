import { describe, expect, it } from "vitest";
import { defaultLinkName, normalizeLinkUrl, parseStoredLinks } from "./links";

describe("normalizeLinkUrl", () => {
  it("keeps absolute http(s) URLs", () => {
    expect(normalizeLinkUrl("https://docs.google.com/spreadsheets/d/abc/edit")).toBe(
      "https://docs.google.com/spreadsheets/d/abc/edit",
    );
    expect(normalizeLinkUrl("http://example.com")).toBe("http://example.com/");
  });

  it("adds https:// to a bare host", () => {
    expect(normalizeLinkUrl("  d2foundry.gg/w/123 ")).toBe("https://d2foundry.gg/w/123");
    expect(normalizeLinkUrl("localhost:3000/x")).toBe("https://localhost:3000/x");
  });

  it("refuses non-web schemes and junk", () => {
    expect(normalizeLinkUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeLinkUrl("data:text/html,hi")).toBeNull();
    expect(normalizeLinkUrl("file:///etc/passwd")).toBeNull();
    expect(normalizeLinkUrl("not a url")).toBeNull();
    expect(normalizeLinkUrl("")).toBeNull();
  });
});

describe("defaultLinkName", () => {
  it("names Google apps by type", () => {
    expect(defaultLinkName("https://docs.google.com/spreadsheets/d/abc/edit")).toBe(
      "Google Sheet",
    );
    expect(defaultLinkName("https://docs.google.com/document/d/abc/edit")).toBe("Google Doc");
  });

  it("falls back to the host without www", () => {
    expect(defaultLinkName("https://www.light.gg/db/")).toBe("light.gg");
  });
});

describe("parseStoredLinks", () => {
  it("drops malformed entries and unsafe URLs", () => {
    const raw = JSON.stringify([
      { id: "a", name: "Sheet", url: "https://docs.google.com/spreadsheets/d/x" },
      { id: "b", name: "Bad", url: "javascript:alert(1)" },
      { id: 3, name: "Bad id", url: "https://example.com" },
      null,
    ]);
    expect(parseStoredLinks(raw)).toEqual([
      { id: "a", name: "Sheet", url: "https://docs.google.com/spreadsheets/d/x" },
    ]);
  });

  it("tolerates missing or corrupt storage", () => {
    expect(parseStoredLinks(null)).toEqual([]);
    expect(parseStoredLinks("{oops")).toEqual([]);
    expect(parseStoredLinks('{"a":1}')).toEqual([]);
  });
});
