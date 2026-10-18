import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { endianness } from "node:os";
import { gunzipSync, gzipSync } from "node:zlib";
import type { CrawlSource } from "../src/lib/weapons/perk-popularity";
import { allocOwners, allocWeapon, type CopyStore, type WeaponCopies } from "../src/lib/weapons/popularity-copies";

/**
 * The copy store's file (src/lib/weapons/popularity-copies.ts). The store lists
 * the players it found, so the file is encrypted (AES-256-GCM, key from the
 * POPULARITY_STORE_KEY environment variable: 32 random bytes, base64) and can
 * sit in a public release: "D2PE", a 12-byte IV, the 16-byte auth tag, then
 * the encrypted gzip of the store.
 * The store itself is little-endian throughout: "D2PC", version, a JSON header
 * (the runs), the owners (count, then ids, types, last-played days, last-read
 * days, whole flags), then each weapon: hash, column count, perk table, copy
 * count, then its ids, last-seen days, owners and picks. Typed arrays are
 * copied in bulk, so this only runs on a little-endian machine (every one the
 * crawl runs on).
 */

/** "D2PC": the store's first four bytes, once decrypted and unzipped. */
export const MAGIC = 0x43503244;
/** 2: owners (1 had none, and wasn't encrypted). */
export const VERSION = 2;
/** "D2PE": the encrypted file's first four bytes. */
const SEALED = Buffer.from("D2PE");

/** The bytes behind a typed array, as they are in memory. */
const bytesOf = (array: BigUint64Array | Uint32Array | Uint16Array | Uint8Array) =>
  new Uint8Array(array.buffer, array.byteOffset, array.byteLength);

function littleEndianOnly() {
  if (endianness() !== "LE") throw new Error("The copy store file is little-endian; this machine isn't.");
}

/** The key from POPULARITY_STORE_KEY. */
export function storeKey(env: Record<string, string | undefined> = process.env): Buffer {
  const key = Buffer.from(env.POPULARITY_STORE_KEY ?? "", "base64");
  if (key.length !== 32)
    throw new Error("Set POPULARITY_STORE_KEY to 32 random bytes, base64 (openssl rand -base64 32).");
  return key;
}

/** `data` encrypted with `key`, as the file holds it. */
export function seal(data: Buffer, key: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const sealed = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([SEALED, iv, cipher.getAuthTag(), sealed]);
}

function unseal(file: Buffer, key: Buffer) {
  if (file.length < 32 || !file.subarray(0, 4).equals(SEALED)) throw new Error("Not an encrypted copy store.");
  const decipher = createDecipheriv("aes-256-gcm", key, file.subarray(4, 16));
  decipher.setAuthTag(file.subarray(16, 32));
  try {
    return Buffer.concat([decipher.update(file.subarray(32)), decipher.final()]);
  } catch {
    throw new Error("Couldn't decrypt the copy store: wrong POPULARITY_STORE_KEY, or the file is damaged.");
  }
}

export function encodeCopies(store: CopyStore, key: Buffer): Buffer {
  littleEndianOnly();
  const header = Buffer.from(JSON.stringify({ runs: store.runs }));
  const { owners } = store;
  const ownerArrays = [owners.ids, owners.types, owners.played, owners.read, owners.whole];
  let size = 4 + 1 + 4 + header.length + 4 + ownerArrays.reduce((sum, array) => sum + array.byteLength, 0) + 4;
  for (const weapon of store.weapons.values())
    size += 4 + 1 + 1 + weapon.perks.length * 4 + 4 + weapon.ids.length * (8 + 2 + 4 + weapon.columns);
  const out = Buffer.alloc(size);
  let at = out.writeUInt32LE(MAGIC, 0);
  at = out.writeUInt8(VERSION, at);
  at = out.writeUInt32LE(header.length, at);
  at += header.copy(out, at);
  at = out.writeUInt32LE(owners.ids.length, at);
  for (const array of ownerArrays) {
    out.set(bytesOf(array), at);
    at += array.byteLength;
  }
  at = out.writeUInt32LE(store.weapons.size, at);
  for (const [hash, weapon] of store.weapons) {
    at = out.writeUInt32LE(hash, at);
    at = out.writeUInt8(weapon.columns, at);
    at = out.writeUInt8(weapon.perks.length, at);
    for (const perk of weapon.perks) at = out.writeUInt32LE(perk, at);
    at = out.writeUInt32LE(weapon.ids.length, at);
    for (const array of [weapon.ids, weapon.seen, weapon.owners, weapon.picks]) {
      out.set(bytesOf(array), at);
      at += array.byteLength;
    }
  }
  return seal(gzipSync(out), key);
}

export function decodeCopies(file: Buffer, key: Buffer): CopyStore {
  littleEndianOnly();
  const data = gunzipSync(unseal(file, key));
  if (data.length < 5 || data.readUInt32LE(0) !== MAGIC) throw new Error("Not a copy store.");
  const version = data.readUInt8(4);
  if (version !== VERSION) throw new Error(`Copy store version ${version}; this reads ${VERSION}.`);
  let at = 5;
  const headerLength = data.readUInt32LE(at);
  at += 4;
  const header = JSON.parse(data.toString("utf8", at, at + headerLength)) as { runs: CrawlSource[] };
  at += headerLength;
  /** Fills `array` (its own, aligned memory) from the file. */
  const fill = (array: BigUint64Array | Uint32Array | Uint16Array | Uint8Array) => {
    bytesOf(array).set(data.subarray(at, at + array.byteLength));
    at += array.byteLength;
  };
  const owners = allocOwners(data.readUInt32LE(at));
  at += 4;
  for (const array of [owners.ids, owners.types, owners.played, owners.read, owners.whole]) fill(array);
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
    for (const array of [weapon.ids, weapon.seen, weapon.owners, weapon.picks]) fill(array);
    weapons.set(hash, weapon);
  }
  return { owners, weapons, runs: header.runs };
}
