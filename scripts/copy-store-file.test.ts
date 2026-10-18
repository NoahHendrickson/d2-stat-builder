import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  COPY_FIELDS,
  emptyStore,
  mergeCopies,
  OWNER_FIELDS,
  storeFromCrawl,
  type CopyStore,
} from "../src/lib/weapons/popularity-copies";
import { decodeCopies, decodeOwners, decodeRuns, encodeCopies, MAGIC, seal, storeKey, VERSION } from "./copy-store-file";

const key = randomBytes(32);
const run = (generatedAt: string) => ({
  generatedAt,
  from: generatedAt,
  to: generatedAt,
  players: 1,
  rechecked: 0,
  copies: 1,
  vaults: 1,
  sample: { kind: "recent" as const, minutes: 15 },
  catalog: "0",
});

/** Every owner and every copy, as plain values. */
const contents = (store: CopyStore) => ({
  owners: Object.fromEntries(OWNER_FIELDS.map((field) => [field, [...store.owners[field]]])),
  weapons: Object.fromEntries(
    [...store.weapons].map(([hash, w]) => [
      hash,
      { perks: w.perks, ...Object.fromEntries(COPY_FIELDS.map((field) => [field, [...w[field]]])) },
    ]),
  ),
});

const columnsOf = (hash: number) =>
  hash === 1 ? [{ kind: "Intrinsic" }, { kind: "Barrel" }, { kind: "Trait" }, { kind: "Trait" }] : [{ kind: "Barrel" }];

/**
 * Two crawls merged: two weapons, three players, one of them read whole
 * twice with a copy out of the loadout by the second, so the hazard has a
 * check. `equipped` false everywhere makes the store scripts/fixtures/copy-store-v3.bin
 * was written from, by the encoder before equipped days were kept (24e999f).
 */
function sampleStore(equipped = true) {
  const first = storeFromCrawl(
    [
      { id: BigInt("4611686018467000001"), type: 3, played: 19_999, whole: false },
      { id: BigInt(2), type: 1, played: 20_000, whole: true },
    ],
    new Map([
      [
        1,
        [
          { id: BigInt(1), owner: 1, perks: [undefined, 11, 13, 15], equipped },
          { id: BigInt(7), owner: 0, perks: [undefined, 12, 14, 13], equipped: false },
          { id: BigInt(8), owner: 1, perks: [undefined, 12, 14, 13], equipped },
        ],
      ],
    ]),
    20_000 * 86_400_000,
    run("a"),
  );
  const second = storeFromCrawl(
    [
      { id: BigInt(3), type: 2, played: 20_001, whole: false },
      { id: BigInt(2), type: 1, played: 20_001, whole: true },
    ],
    new Map([
      [4_294_967_295, [{ id: BigInt("18446744073709551615"), owner: 0, perks: [4_000_000_000], equipped }]],
      [1, [{ id: BigInt(1), owner: 1, perks: [undefined, 11, 13, 15], equipped: false }]],
    ]),
    20_001 * 86_400_000 + 3_600_000,
    run("b"),
  );
  return mergeCopies(first, second, columnsOf);
}

describe("encodeCopies / decodeCopies", () => {
  it("round-trips players, copies, days, equipped days, unidentified perks, 64-bit ids, runs and the hazard", () => {
    const store = sampleStore();
    // Copies 1 (stowed now) and 8 (gone), both last equipped a day before: the store week of day 20,001 is 19,999.
    expect(store.hazard).toEqual({ weeks: [{ day: 19_999, checked: [0, 2], gone: [0, 1] }] });
    const file = encodeCopies(store, key);
    const back = decodeCopies(file, key);
    expect(contents(back)).toEqual(contents(store));
    expect(back.runs).toEqual(store.runs);
    expect(back.hazard).toEqual(store.hazard);
    // A crawl only needs the players, and gets the same ones.
    expect(contents({ ...emptyStore(), owners: decodeOwners(file, key) }).owners).toEqual(contents(store).owners);
    expect(decodeRuns(file, key)).toEqual(store.runs);
  });

  it("leaves the hazard out of a crawl's file, which has none", () => {
    const crawl = storeFromCrawl([{ id: BigInt(2), type: 1, played: 20_000, whole: true }], new Map(), 20_000 * 86_400_000, run("a"));
    expect(decodeCopies(encodeCopies(crawl, key), key).hazard).toBeUndefined();
  });

  it("reads version 3, from before equipped days and the hazard were kept", () => {
    // sampleStore(false)'s store as the encoder at 24e999f wrote it, with a key of 32 bytes of 7.
    const file = readFileSync(new URL("./fixtures/copy-store-v3.bin", import.meta.url));
    const back = decodeCopies(file, Buffer.alloc(32, 7));
    const expected = sampleStore(false);
    expect(contents(back)).toEqual(contents(expected));
    expect(back.runs).toEqual(expected.runs);
    expect(back.hazard).toBeUndefined();
  });

  it("round-trips an empty store", () => {
    expect(contents(decodeCopies(encodeCopies(emptyStore(), key), key))).toEqual(contents(emptyStore()));
  });

  it("can't be read without the key", () => {
    const file = encodeCopies(emptyStore(), key);
    expect(() => decodeCopies(file, randomBytes(32))).toThrow("Couldn't decrypt the copy store");
  });

  it("rejects a file that isn't an encrypted copy store", () => {
    expect(() => decodeCopies(gzipSync(Buffer.alloc(64)), key)).toThrow("Not an encrypted copy store.");
    const wrongMagic = Buffer.alloc(16);
    wrongMagic.writeUInt32LE(MAGIC + 1, 0);
    expect(() => decodeCopies(seal(gzipSync(wrongMagic), key), key)).toThrow("Not a copy store.");
    expect(() => decodeCopies(seal(gzipSync(Buffer.alloc(2)), key), key)).toThrow("Not a copy store.");
  });

  it("rejects a version of the format it doesn't read", () => {
    const file = Buffer.alloc(16);
    file.writeUInt32LE(MAGIC, 0);
    file.writeUInt8(VERSION + 1, 4);
    expect(() => decodeCopies(seal(gzipSync(file), key), key)).toThrow(`Copy store version ${VERSION + 1}`);
    file.writeUInt8(2, 4);
    expect(() => decodeCopies(seal(gzipSync(file), key), key)).toThrow("Copy store version 2");
  });
});

describe("storeKey", () => {
  it("takes 32 bytes, base64, and nothing else", () => {
    expect(storeKey({ POPULARITY_STORE_KEY: key.toString("base64") })).toEqual(key);
    expect(() => storeKey({})).toThrow("POPULARITY_STORE_KEY");
    expect(() => storeKey({ POPULARITY_STORE_KEY: randomBytes(16).toString("base64") })).toThrow("POPULARITY_STORE_KEY");
  });
});
