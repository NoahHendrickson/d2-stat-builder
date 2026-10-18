import { randomBytes } from "node:crypto";
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

/** Two crawls merged: two weapons, three players, one of them read whole twice, so the hazard has a count. */
function sampleStore() {
  const first = storeFromCrawl(
    [
      { id: BigInt("4611686018467000001"), type: 3, played: 19_999, whole: false },
      { id: BigInt(2), type: 1, played: 20_000, whole: true },
    ],
    new Map([
      [
        1,
        [
          { id: BigInt(1), owner: 1, perks: [undefined, 11, 13, 15], equipped: true },
          { id: BigInt(7), owner: 0, perks: [undefined, 12, 14, 13], equipped: undefined },
          { id: BigInt(8), owner: 1, perks: [undefined, 12, 14, 13], equipped: false },
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
      [4_294_967_295, [{ id: BigInt("18446744073709551615"), owner: 0, perks: [4_000_000_000], equipped: true }]],
      [1, [{ id: BigInt(1), owner: 1, perks: [undefined, 11, 13, 15], equipped: false }]],
    ]),
    20_001 * 86_400_000 + 3_600_000,
    run("b"),
  );
  return mergeCopies(first, second, columnsOf);
}

describe("encodeCopies / decodeCopies", () => {
  it("round-trips players, copies, days, places, unidentified perks, 64-bit ids, runs and the hazard", () => {
    const store = sampleStore();
    expect(store.hazard).toEqual({ equipped: { kept: [0, 1], gone: [] }, stowed: { kept: [], gone: [0, 1] } });
    const file = encodeCopies(store, key);
    const back = decodeCopies(file, key);
    expect(contents(back)).toEqual(contents(store));
    expect(back.runs).toEqual(store.runs);
    expect(back.hazard).toEqual(store.hazard);
    // A crawl only needs the players, and gets the same ones.
    expect(contents({ ...emptyStore(), owners: decodeOwners(file, key) }).owners).toEqual(contents(store).owners);
    expect(decodeRuns(file, key)).toEqual(store.runs);
  });

  it("reads the version before, where a copy's place wasn't kept and there was no hazard", () => {
    const store = sampleStore();
    const back = decodeCopies(encodeCopies(store, key, VERSION - 1), key);
    const expected = contents(store);
    for (const weapon of Object.values(expected.weapons) as unknown as { place: number[] }[]) weapon.place = weapon.place.map(() => 0);
    expect(contents(back)).toEqual(expected);
    expect(back.runs).toEqual(store.runs);
    expect(back.hazard).toEqual(emptyStore().hazard);
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
    expect(() => encodeCopies(emptyStore(), key, 2)).toThrow("Can't write copy store version 2");
  });
});

describe("storeKey", () => {
  it("takes 32 bytes, base64, and nothing else", () => {
    expect(storeKey({ POPULARITY_STORE_KEY: key.toString("base64") })).toEqual(key);
    expect(() => storeKey({})).toThrow("POPULARITY_STORE_KEY");
    expect(() => storeKey({ POPULARITY_STORE_KEY: randomBytes(16).toString("base64") })).toThrow("POPULARITY_STORE_KEY");
  });
});
