import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { endianness } from "node:os";
import { gunzipSync, gzipSync } from "node:zlib";
import type { CrawlSource } from "../src/lib/weapons/perk-popularity";
import {
  allocOwners,
  allocWeapon,
  bytesOf,
  COPY_FIELDS,
  OWNER_FIELDS,
  type AnyArray,
  type CopyStore,
  type Owners,
  type WeaponCopies,
} from "../src/lib/weapons/popularity-copies";
import type { Hazard } from "../src/lib/weapons/popularity-hazard";

/**
 * The copy store's file (src/lib/weapons/popularity-copies.ts). The store lists
 * the players it found, so the file is encrypted (AES-256-GCM, key from the
 * POPULARITY_STORE_KEY environment variable: 32 random bytes, base64) and can
 * sit in a public release: "D2PE", a 12-byte IV, the 16-byte auth tag, then
 * the encrypted gzip of the store.
 * The store itself is little-endian throughout: "D2PC", version, a JSON header
 * (the runs, and the merged store's hazard), the owner count and each of
 * OWNER_FIELDS in turn, then each weapon: hash, column count, perk table, copy
 * count, then each of COPY_FIELDS in turn. Typed arrays are copied in bulk, so
 * this only runs on a little-endian machine (every one the crawl runs on).
 */

/** "D2PC": the store's first four bytes, once decrypted and unzipped. */
export const MAGIC = 0x43503244;
/**
 * 4: each copy's equipped day, and the hazard in the header (2 kept owners'
 * reads to the day; 1 had no owners, and wasn't encrypted). The change is
 * one-way: code from before it can't read a version 4 store, so going back
 * means starting the store over.
 */
export const VERSION = 4;
/**
 * Version 3 (no equipped days, no hazard) is still read, so the store on the
 * release carries over: its copies come out never seen equipped. Needed only
 * until the first version 4 merge rewrites that store, since crawl files
 * always come from the same commit as the merge; drop it, V3_COPY_FIELDS and
 * copyFieldsOf after that.
 */
const OLDEST_READ = 3;
/** COPY_FIELDS a version 3 file has: all but `equipped`. */
const V3_COPY_FIELDS = COPY_FIELDS.filter((field) => field !== "equipped");
const copyFieldsOf = (version: number) => (version >= 4 ? COPY_FIELDS : V3_COPY_FIELDS);
/** "D2PE": the encrypted file's first four bytes. */
const SEALED = Buffer.from("D2PE");

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
  // A crawl's store has no hazard; JSON leaves the field out.
  const header = Buffer.from(JSON.stringify({ runs: store.runs, hazard: store.hazard }));
  const ownerArrays = OWNER_FIELDS.map((field) => store.owners[field]);
  const copyArrays = (weapon: WeaponCopies) => COPY_FIELDS.map((field) => weapon[field]);
  const bytes = (arrays: AnyArray[]) => arrays.reduce((sum, array) => sum + array.byteLength, 0);
  let size = 4 + 1 + 4 + header.length + 4 + bytes(ownerArrays) + 4;
  for (const weapon of store.weapons.values())
    size += 4 + 1 + 1 + weapon.perks.length * 4 + 4 + bytes(copyArrays(weapon));
  const out = Buffer.alloc(size);
  let at = out.writeUInt32LE(MAGIC, 0);
  at = out.writeUInt8(VERSION, at);
  at = out.writeUInt32LE(header.length, at);
  at += header.copy(out, at);
  const put = (array: AnyArray) => {
    out.set(bytesOf(array), at);
    at += array.byteLength;
  };
  at = out.writeUInt32LE(store.owners.ids.length, at);
  ownerArrays.forEach(put);
  at = out.writeUInt32LE(store.weapons.size, at);
  for (const [hash, weapon] of store.weapons) {
    at = out.writeUInt32LE(hash, at);
    at = out.writeUInt8(weapon.columns, at);
    at = out.writeUInt8(weapon.perks.length, at);
    for (const perk of weapon.perks) at = out.writeUInt32LE(perk, at);
    at = out.writeUInt32LE(weapon.ids.length, at);
    copyArrays(weapon).forEach(put);
  }
  return seal(gzipSync(out), key);
}

/** Fills `array` (its own, aligned memory) from `data` at `at`; returns where it ended. */
function fill(array: AnyArray, data: Buffer, at: number) {
  bytesOf(array).set(data.subarray(at, at + array.byteLength));
  return at + array.byteLength;
}

/** Reads the file through the owners; `weapons` then reads on from there, if it's wanted. */
function readStore<T>(file: Buffer, key: Buffer, weapons: (data: Buffer, at: number, version: number) => T) {
  littleEndianOnly();
  const data = gunzipSync(unseal(file, key));
  if (data.length < 5 || data.readUInt32LE(0) !== MAGIC) throw new Error("Not a copy store.");
  const version = data.readUInt8(4);
  if (version < OLDEST_READ || version > VERSION)
    throw new Error(`Copy store version ${version}; this reads ${OLDEST_READ} to ${VERSION}.`);
  let at = 5;
  const headerLength = data.readUInt32LE(at);
  at += 4;
  const header = JSON.parse(data.toString("utf8", at, at + headerLength)) as { runs: CrawlSource[]; hazard?: Hazard };
  at += headerLength;
  const owners = allocOwners(data.readUInt32LE(at));
  at += 4;
  for (const field of OWNER_FIELDS) at = fill(owners[field], data, at);
  return { runs: header.runs, hazard: header.hazard, owners, weapons: weapons(data, at, version) };
}

function readWeapons(data: Buffer, start: number, version: number) {
  let at = start;
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
    // A version 3 weapon has no equipped days: its copies keep allocWeapon's 0, never seen equipped.
    const weapon = allocWeapon(columns, perks, data.readUInt32LE(at));
    at += 4;
    for (const field of copyFieldsOf(version)) at = fill(weapon[field], data, at);
    weapons.set(hash, weapon);
  }
  return weapons;
}

export const decodeCopies = (file: Buffer, key: Buffer): CopyStore => readStore(file, key, readWeapons);

/** Just the store's players: all a crawl needs from it, without building every weapon's copies. */
export const decodeOwners = (file: Buffer, key: Buffer): Owners => readStore(file, key, () => undefined).owners;

/** Just the store's crawls. */
export const decodeRuns = (file: Buffer, key: Buffer): CrawlSource[] => readStore(file, key, () => undefined).runs;
