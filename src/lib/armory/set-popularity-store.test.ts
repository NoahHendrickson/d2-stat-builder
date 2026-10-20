import { describe, expect, it } from "vitest";
import {
  mergeSetStores,
  pruneSetStore,
  setPopularitySnapshot,
  type SetSample,
  type SetStore,
} from "./set-popularity-store";

const sample = (character: string, minute: number, over: Partial<SetSample> = {}): SetSample => ({
  character,
  bucket: "raid",
  minute,
  classType: 0,
  config: { kind: "four", sets: [7] },
  ...over,
});
const crawl = (generatedAt: string, samples: SetSample[]): SetStore => ({
  runs: [{ generatedAt, reads: samples.length, samples: samples.length }],
  samples,
});
const configOf = (store: SetStore, character: string, bucket = "raid") =>
  store.samples.find((s) => s.character === character && s.bucket === bucket)?.config;

// Two crawls on one day: 08:00 saw set 7, 12:00 saw set 9.
const MORNING = 480;
const NOON = 720;
const morning = crawl("1970-01-01T08:00:00Z", [sample("a", MORNING, { config: { kind: "four", sets: [7] } })]);
const noon = crawl("1970-01-01T12:00:00Z", [sample("a", NOON, { config: { kind: "four", sets: [9] } })]);

describe("mergeSetStores", () => {
  it("keeps each character's latest sample per bucket", () => {
    const merged = mergeSetStores(morning, noon);
    expect(configOf(merged, "a")).toEqual({ kind: "four", sets: [9] });
    expect(merged.runs).toHaveLength(2);
  });

  it("keeps a character's buckets apart", () => {
    const dungeon = crawl("1970-01-01T13:00:00Z", [sample("a", 780, { bucket: "dungeon", config: { kind: "none", sets: [] } })]);
    const merged = mergeSetStores(mergeSetStores(morning, noon), dungeon);
    expect(configOf(merged, "a")).toEqual({ kind: "four", sets: [9] });
    expect(configOf(merged, "a", "dungeon")).toEqual({ kind: "none", sets: [] });
  });

  it("goes by when a sample was read, not the order the crawls come in", () => {
    expect(configOf(mergeSetStores(noon, morning), "a")).toEqual({ kind: "four", sets: [9] });
  });

  it("doesn't roll back when a crawl already merged is folded in again (A → B → A)", () => {
    const once = mergeSetStores(mergeSetStores(morning, noon), morning);
    expect(configOf(once, "a")).toEqual({ kind: "four", sets: [9] });
    expect(once.runs).toHaveLength(2);
  });

  it("changes nothing when the same crawl is merged twice", () => {
    const merged = mergeSetStores(morning, morning);
    expect(merged).toBe(morning);
  });
});

describe("pruneSetStore", () => {
  it("drops samples read and runs made before the window", () => {
    const day = 1_440;
    const store: SetStore = {
      runs: [
        { generatedAt: "1970-01-11T00:00:00Z", reads: 1, samples: 1 },
        { generatedAt: "1970-01-13T00:00:00Z", reads: 1, samples: 1 },
      ],
      samples: [sample("a", 10 * day), sample("b", 12 * day + 5)],
    };
    const pruned = pruneSetStore(store, 11);
    expect(pruned.samples.map((s) => s.character)).toEqual(["b"]);
    expect(pruned.runs.map((r) => r.generatedAt)).toEqual(["1970-01-13T00:00:00Z"]);
  });
});

describe("setPopularitySnapshot", () => {
  it("tallies each bucket apart, keyed by kind and sets", () => {
    const store: SetStore = {
      runs: [],
      samples: [
        sample("a", 1, { config: { kind: "four", sets: [7] } }),
        sample("b", 1, { config: { kind: "four", sets: [7] } }),
        sample("c", 1, { config: { kind: "pair", sets: [7, 9] } }),
        sample("d", 1, { config: { kind: "two", sets: [9] } }),
        sample("e", 1, { config: { kind: "none", sets: [] } }),
        sample("f", 1, { bucket: "dungeon", config: { kind: "two", sets: [9] } }),
      ],
    };
    const snapshot = setPopularitySnapshot(store, "2026-10-19T00:00:00Z", 14);
    expect(snapshot).toMatchObject({ schema: 1, days: 14 });
    expect(snapshot.buckets.raid).toEqual({
      samples: 5,
      counts: { none: { "": 1 }, two: { 9: 1 }, pair: { "7,9": 1 }, four: { 7: 2 } },
    });
    expect(snapshot.buckets.dungeon?.samples).toBe(1);
    expect(snapshot.buckets.gmAlert).toBeUndefined();
  });
});
