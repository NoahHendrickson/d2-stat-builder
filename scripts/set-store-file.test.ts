import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { SetStore } from "../src/lib/armory/set-popularity-store";
import { decodeSetStore, encodeSetStore } from "./set-store-file";

const key = randomBytes(32);
const store: SetStore = {
  runs: [{ generatedAt: "2026-10-19T00:00:00Z", reads: 10, samples: 4 }],
  samples: [
    { character: "2305843009301", bucket: "raid", minute: 100, classType: 0, config: { kind: "four", sets: [7] } },
    { character: "2305843009302", bucket: "dungeon", minute: 101, classType: 1, config: { kind: "pair", sets: [7, 9] } },
    { character: "2305843009303", bucket: "gmAlert", minute: 102, classType: 2, config: { kind: "two", sets: [9] } },
    { character: "2305843009304", bucket: "conquest", minute: 103, classType: 3, config: { kind: "none", sets: [] } },
  ],
};

describe("set store file", () => {
  it("round-trips every bucket and kind of setup", () => {
    expect(decodeSetStore(encodeSetStore(store, key), key)).toEqual(store);
  });
  it("is encrypted: the character ids aren't in the file", () => {
    expect(encodeSetStore(store, key).includes(Buffer.from("2305843009301"))).toBe(false);
  });
  it("refuses the wrong key", () => {
    expect(() => decodeSetStore(encodeSetStore(store, key), randomBytes(32))).toThrow("Couldn't decrypt the armor set store");
  });
});
