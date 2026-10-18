import { endianness } from "node:os";
import { gunzipSync, gzipSync } from "node:zlib";
import type { CrawlSource } from "../src/lib/weapons/perk-popularity";
import { allocWeapon, type CopyStore, type WeaponCopies } from "../src/lib/weapons/popularity-copies";

/**
 * The copy store's file (src/lib/weapons/popularity-copies.ts): one gzipped
 * binary file, millions of copies that JSON in git couldn't carry. Little-endian
 * throughout: magic, version, a JSON header (the runs), then each weapon: hash,
 * column count, perk table, copy count, then its ids, last-seen days and picks.
 * Ids and days are copied in bulk straight from the typed arrays, so this only
 * runs on a little-endian machine (every one the crawl runs on).
 */

/** "D2PC": the file's first four bytes. */
export const MAGIC = 0x43503244;
export const VERSION = 1;

/** The bytes behind a typed array, as they are in memory. */
const bytesOf = (array: BigUint64Array | Uint16Array) => new Uint8Array(array.buffer, array.byteOffset, array.byteLength);

function littleEndianOnly() {
  if (endianness() !== "LE") throw new Error("The copy store file is little-endian; this machine isn't.");
}

export function encodeCopies(store: CopyStore): Buffer {
  littleEndianOnly();
  const header = Buffer.from(JSON.stringify({ runs: store.runs }));
  let size = 4 + 1 + 4 + header.length + 4;
  for (const weapon of store.weapons.values())
    size += 4 + 1 + 1 + weapon.perks.length * 4 + 4 + weapon.ids.length * (8 + 2 + weapon.columns);
  const out = Buffer.alloc(size);
  let at = out.writeUInt32LE(MAGIC, 0);
  at = out.writeUInt8(VERSION, at);
  at = out.writeUInt32LE(header.length, at);
  at += header.copy(out, at);
  at = out.writeUInt32LE(store.weapons.size, at);
  for (const [hash, weapon] of store.weapons) {
    at = out.writeUInt32LE(hash, at);
    at = out.writeUInt8(weapon.columns, at);
    at = out.writeUInt8(weapon.perks.length, at);
    for (const perk of weapon.perks) at = out.writeUInt32LE(perk, at);
    at = out.writeUInt32LE(weapon.ids.length, at);
    for (const array of [bytesOf(weapon.ids), bytesOf(weapon.seen), weapon.picks]) {
      out.set(array, at);
      at += array.length;
    }
  }
  return gzipSync(out);
}

export function decodeCopies(file: Buffer): CopyStore {
  littleEndianOnly();
  const data = gunzipSync(file);
  if (data.length < 5 || data.readUInt32LE(0) !== MAGIC) throw new Error("Not a copy store.");
  const version = data.readUInt8(4);
  if (version !== VERSION) throw new Error(`Copy store version ${version}; this reads ${VERSION}.`);
  let at = 5;
  const headerLength = data.readUInt32LE(at);
  at += 4;
  const header = JSON.parse(data.toString("utf8", at, at + headerLength)) as { runs: CrawlSource[] };
  at += headerLength;
  const weapons = new Map<number, WeaponCopies>();
  const count = data.readUInt32LE(at);
  at += 4;
  for (let w = 0; w < count; w++) {
    const hash = data.readUInt32LE(at);
    const columns = data.readUInt8(at + 4);
    const perkCount = data.readUInt8(at + 5);
    at += 6;
    const perks = Array.from({ length: perkCount }, (_, i) => data.readUInt32LE(at + i * 4));
    at += perkCount * 4;
    const weapon = allocWeapon(columns, perks, data.readUInt32LE(at));
    at += 4;
    // Into the arrays' own (aligned) memory, not views of the file's.
    for (const array of [bytesOf(weapon.ids), bytesOf(weapon.seen), weapon.picks]) {
      array.set(data.subarray(at, at + array.length));
      at += array.length;
    }
    weapons.set(hash, weapon);
  }
  return { weapons, runs: header.runs };
}
