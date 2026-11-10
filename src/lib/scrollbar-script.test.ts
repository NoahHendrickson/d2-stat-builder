import { describe, expect, it, vi } from "vitest";
import { SCROLLBAR_SCRIPT } from "./scrollbar-script";

/** Runs the head script against a stub document whose probe measures `offset`/`client` wide. */
function run(offsetWidth: number, clientWidth: number) {
  const probe = { style: { cssText: "" }, offsetWidth, clientWidth };
  const dataset: Record<string, string> = {};
  const documentElement = { dataset, appendChild: vi.fn(), removeChild: vi.fn() };
  const document = { documentElement, createElement: () => probe };
  new Function("document", SCROLLBAR_SCRIPT)(document);
  return { dataset, documentElement, probe };
}

describe("SCROLLBAR_SCRIPT", () => {
  it("flags scrollbars that take up room as classic", () => {
    const { dataset, documentElement, probe } = run(117, 100);
    expect(dataset.scrollbars).toBe("classic");
    expect(documentElement.appendChild).toHaveBeenCalledWith(probe);
    expect(documentElement.removeChild).toHaveBeenCalledWith(probe);
  });

  it("leaves overlay scrollbars unflagged", () => {
    const { dataset, documentElement, probe } = run(100, 100);
    expect(dataset.scrollbars).toBeUndefined();
    expect(documentElement.removeChild).toHaveBeenCalledWith(probe);
  });
});
