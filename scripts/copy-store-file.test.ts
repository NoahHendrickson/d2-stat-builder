import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { emptyStore, mergeCopies, storeFromCopies, type CopyStore } from "../src/lib/weapons/popularity-copies";
import { decodeCopies, encodeCopies, MAGIC, VERSION } from "./copy-store-file";

const crawl = (generatedAt: string) => ({
  generatedAt,
  from: generatedAt,
  to: generatedAt,
  players: 1,
  copies: 1,
  vaults: 1,
  sample: { kind: "recent" as const, minutes: 15 },
});

/** Every copy as [id, day, picks], by weapon. */
const contents = (store: CopyStore) =>
  Object.fromEntries(
    [...store.weapons].map(([hash, w]) => [hash, { perks: w.perks, rows: Array.from(w.ids, (id, i) => [id, w.seen[i], [...w.picks.subarray(i * w.columns, (i + 1) * w.columns)]]) }]),
  );

describe("encodeCopies / decodeCopies", () => {
  it("round-trips copies, days, unidentified perks, 64-bit ids and runs", () => {
    const columnsOf = (hash: number) => (hash === 1 ? [{ kind: "Intrinsic" }, { kind: "Barrel" }, { kind: "Trait" }, { kind: "Trait" }] : [{ kind: "Barrel" }]);
    const store = mergeCopies(
      storeFromCopies(
        new Map([[1, [{ id: BigInt(1), perks: [undefined, 11, 13, 15] }, { id: BigInt(7), perks: [undefined, 12, 14, 13] }]]]),
        20_000,
        crawl("a"),
      ),
      storeFromCopies(new Map([[4_294_967_295, [{ id: BigInt("18446744073709551615"), perks: [4_000_000_000] }]]]), 20_001, crawl("b")),
      columnsOf,
    );
    const back = decodeCopies(encodeCopies(store));
    expect(contents(back)).toEqual(contents(store));
    expect(back.runs).toEqual(store.runs);
  });

  it("round-trips an empty store", () => {
    expect(decodeCopies(encodeCopies(emptyStore()))).toEqual(emptyStore());
  });

  it("rejects a file that isn't a copy store", () => {
    const wrongMagic = Buffer.alloc(16);
    wrongMagic.writeUInt32LE(MAGIC + 1, 0);
    expect(() => decodeCopies(gzipSync(wrongMagic))).toThrow("Not a copy store.");
    expect(() => decodeCopies(gzipSync(Buffer.alloc(2)))).toThrow("Not a copy store.");
  });

  it("rejects another version of the format", () => {
    const file = Buffer.alloc(16);
    file.writeUInt32LE(MAGIC, 0);
    file.writeUInt8(VERSION + 1, 4);
    expect(() => decodeCopies(gzipSync(file))).toThrow(`Copy store version ${VERSION + 1}`);
  });
});
