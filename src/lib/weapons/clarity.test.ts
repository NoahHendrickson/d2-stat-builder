import { describe, expect, it } from "vitest";
import {
  clarityLines,
  lineText,
  mergeLineNumbers,
  type ClarityMap,
} from "./clarity";

// Kill Clip as Clarity publishes it: base 1015611457, enhanced 2923251173.
const map: ClarityMap = {
  "1015611457": {
    hash: 1015611457,
    name: "Kill Clip",
    descriptions: {
      en: [
        {
          linesContent: [
            {
              text: "Finishing a reload within 3.6 seconds of a kill grants 25% increased damage for 5 seconds.",
            },
          ],
        },
        { classNames: ["spacer"] },
        { linesContent: [{ text: "Stowing the weapon removes the buff." }] },
      ],
    },
  },
  "2923251173": {
    hash: 2923251173,
    name: "Kill Clip",
    descriptions: {
      en: [
        {
          linesContent: [
            {
              text: "Finishing a reload within 3.6 seconds of a kill grants 25% increased damage for ",
            },
            { text: "", classNames: ["enhancedArrow"] },
            { text: "5.5 seconds." },
          ],
        },
        { classNames: ["spacer"] },
        { linesContent: [{ text: "Stowing the weapon removes the buff." }] },
        { classNames: ["spacer"] },
        {
          linesContent: [
            { text: "", classNames: ["enhancedArrow"] },
            { text: " Buff Duration is increased by 0.5 seconds." },
          ],
        },
      ],
    },
  },
};

describe("clarityLines", () => {
  it("merges the enhanced tier's numbers into the base lines", () => {
    const lines = clarityLines(map, {
      hash: 1015611457,
      alternateHashes: [2923251173],
    });
    expect(lines?.map(lineText)).toEqual([
      "Finishing a reload within 3.6 seconds of a kill grants 25% increased damage for 5 (↑ 5.5) seconds.",
      "",
      "Stowing the weapon removes the buff.",
    ]);
  });

  it("shows a single tier as-is", () => {
    expect(clarityLines(map, { hash: 1015611457 })?.length).toBe(3);
  });

  it("returns nothing when Clarity has no entry or hasn't loaded", () => {
    expect(clarityLines(map, { hash: 1 })).toBeUndefined();
    expect(clarityLines(undefined, { hash: 1015611457 })).toBeUndefined();
  });
});

describe("mergeLineNumbers", () => {
  it("leaves lines alone when the numbers don't pair up", () => {
    expect(mergeLineNumbers("Lasts 5 seconds.", "Lasts 5 or 6 seconds.")).toBe(
      "Lasts 5 seconds.",
    );
  });
});
