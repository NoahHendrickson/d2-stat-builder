import { describe, expect, it } from "vitest";
import type {
  DestinyCharacterRecordsComponent,
  DestinyProfileRecordsComponent,
  DestinyRecordComponent,
} from "bungie-api-ts/destiny2";
import { patternFor, patternProgress, patternRecords } from "./patterns";

const record = (progress: number, completionValue: number) =>
  ({
    state: 0,
    objectives: [{ objectiveHash: 1, progress, completionValue, complete: progress >= completionValue, visible: true }],
  }) as unknown as DestinyRecordComponent;

describe("patternRecords", () => {
  it("keeps only named, unredacted Weapon Pattern records", () => {
    const defs = [
      { hash: 1, recordTypeName: "Weapon Pattern", displayProperties: { name: "Funnelweb" }, scope: 0 },
      { hash: 2, recordTypeName: "Triumph", displayProperties: { name: "Funnelweb" }, scope: 0 },
      { hash: 3, recordTypeName: "Weapon Pattern", displayProperties: { name: "Hidden" }, scope: 0, redacted: true },
      { hash: 4, recordTypeName: "Weapon Pattern", displayProperties: { name: "" }, scope: 0 },
      { hash: 5, recordTypeName: "Weapon Pattern", displayProperties: { name: "Fang of Ir Yût" }, scope: 1 },
    ] as Parameters<typeof patternRecords>[0];
    expect(patternRecords(defs)).toEqual([
      { hash: 1, name: "Funnelweb", scope: 0 },
      { hash: 5, name: "Fang of Ir Yût", scope: 1 },
    ]);
  });
});

describe("patternProgress", () => {
  const records = [
    { hash: 1, name: "Funnelweb", scope: 0 },
    { hash: 5, name: "Fang of Ir Yût", scope: 1 },
    { hash: 9, name: "Unseen", scope: 0 },
  ];

  it("reads profile patterns from profile records and raid patterns from the furthest character", () => {
    const profile = { records: { 1: record(2, 5) } } as unknown as DestinyProfileRecordsComponent;
    const characters = {
      a: { records: { 5: record(1, 5) } },
      b: { records: { 5: record(3, 5) } },
      c: { records: {} },
    } as unknown as Record<string, DestinyCharacterRecordsComponent>;
    expect(patternProgress(records, profile, characters)).toEqual({
      Funnelweb: { progress: 2, needed: 5 },
      "Fang of Ir Yût": { progress: 3, needed: 5 },
    });
  });

  it("caps progress at what the pattern needs", () => {
    const profile = { records: { 1: record(7, 5) } } as unknown as DestinyProfileRecordsComponent;
    expect(patternProgress(records, profile, undefined)).toEqual({ Funnelweb: { progress: 5, needed: 5 } });
  });
});

describe("patternFor", () => {
  const patterns = { "Fang of Ir Yût": { progress: 4, needed: 5 }, "Found Verdict": { progress: 1, needed: 5 } };

  it("matches by name, and Adept / Timelost copies to the base pattern", () => {
    expect(patternFor(patterns, "Fang of Ir Yût")).toEqual({ progress: 4, needed: 5 });
    expect(patternFor(patterns, "Fang of Ir Yût (Adept)")).toEqual({ progress: 4, needed: 5 });
    expect(patternFor(patterns, "Found Verdict (Timelost)")).toEqual({ progress: 1, needed: 5 });
    expect(patternFor(patterns, "Funnelweb")).toBeUndefined();
    expect(patternFor(undefined, "Funnelweb")).toBeUndefined();
  });
});
