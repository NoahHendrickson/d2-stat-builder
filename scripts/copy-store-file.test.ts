import { randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { emptyStore, mergeCopies, storeFromCrawl, type CopyStore } from "../src/lib/weapons/popularity-copies";
import { decodeCopies, encodeCopies, MAGIC, seal, storeKey, VERSION } from "./copy-store-file";

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
});

/** Every owner and every copy, as plain values. */
const contents = (store: CopyStore) => ({
  owners: Object.fromEntries(Object.entries(store.owners).map(([field, array]) => [field, Array.from(array as ArrayLike<unknown>)])),
  weapons: Object.fromEntries(
    [...store.weapons].map(([hash, w]) => [
      hash,
      { perks: w.perks, ids: [...w.ids], seen: [...w.seen], owners: [...w.owners], picks: [...w.picks] },
    ]),
  ),
});

describe("encodeCopies / decodeCopies", () => {
  it("round-trips players, copies, days, unidentified perks, 64-bit ids and runs", () => {
    const columnsOf = (hash: number) =>
      hash === 1 ? [{ kind: "Intrinsic" }, { kind: "Barrel" }, { kind: "Trait" }, { kind: "Trait" }] : [{ kind: "Barrel" }];
    const store = mergeCopies(
      storeFromCrawl(
        [
          { id: BigInt("4611686018467000001"), type: 3, played: 19_999, whole: false },
          { id: BigInt(2), type: 1, played: 20_000, whole: true },
        ],
        new Map([
          [
            1,
            [
              { id: BigInt(1), owner: 1, perks: [undefined, 11, 13, 15] },
              { id: BigInt(7), owner: 0, perks: [undefined, 12, 14, 13] },
            ],
          ],
        ]),
        20_000,
        run("a"),
      ),
      storeFromCrawl(
        [{ id: BigInt(3), type: 2, played: 20_001, whole: false }],
        new Map([[4_294_967_295, [{ id: BigInt("18446744073709551615"), owner: 0, perks: [4_000_000_000] }]]]),
        20_001,
        run("b"),
      ),
      columnsOf,
    );
    const back = decodeCopies(encodeCopies(store, key), key);
    expect(contents(back)).toEqual(contents(store));
    expect(back.runs).toEqual(store.runs);
  });

  it("round-trips an empty store", () => {
    expect(contents(decodeCopies(encodeCopies(emptyStore(), key), key))).toEqual(contents(emptyStore()));
  });

  it("can't be read without the key", () => {
    const file = encodeCopies(emptyStore(), key);
    expect(() => decodeCopies(file, randomBytes(32))).toThrow("Couldn't decrypt the copy store");
    // Nor is it the gzip of the store in plain sight.
    expect(file.includes(Buffer.from([0x1f, 0x8b]), 4)).toBe(false);
  });

  it("rejects a file that isn't an encrypted copy store", () => {
    expect(() => decodeCopies(gzipSync(Buffer.alloc(64)), key)).toThrow("Not an encrypted copy store.");
    const wrongMagic = Buffer.alloc(16);
    wrongMagic.writeUInt32LE(MAGIC + 1, 0);
    expect(() => decodeCopies(seal(gzipSync(wrongMagic), key), key)).toThrow("Not a copy store.");
    expect(() => decodeCopies(seal(gzipSync(Buffer.alloc(2)), key), key)).toThrow("Not a copy store.");
  });

  it("rejects another version of the format", () => {
    const file = Buffer.alloc(16);
    file.writeUInt32LE(MAGIC, 0);
    file.writeUInt8(VERSION + 1, 4);
    expect(() => decodeCopies(seal(gzipSync(file), key), key)).toThrow(`Copy store version ${VERSION + 1}`);
  });
});

describe("storeKey", () => {
  it("takes 32 bytes, base64, and nothing else", () => {
    expect(storeKey({ POPULARITY_STORE_KEY: key.toString("base64") })).toEqual(key);
    expect(() => storeKey({})).toThrow("POPULARITY_STORE_KEY");
    expect(() => storeKey({ POPULARITY_STORE_KEY: randomBytes(16).toString("base64") })).toThrow("POPULARITY_STORE_KEY");
  });
});
