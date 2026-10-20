import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";

/**
 * The popularity stores' encrypted files (the weapon copy store,
 * scripts/copy-store-file.ts, and the armor set store,
 * scripts/set-store-file.ts). The stores list the players they found, so their
 * files are encrypted (AES-256-GCM, key from the POPULARITY_STORE_KEY
 * environment variable: 32 random bytes, base64) and can sit in a public
 * release: "D2PE", a 12-byte IV, the 16-byte auth tag, then the encrypted data.
 */

/** "D2PE": an encrypted file's first four bytes. */
const SEALED = Buffer.from("D2PE");

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

/** `file` decrypted with `key`; throws on the wrong key or a damaged file, naming `what` it should be. */
export function unseal(file: Buffer, key: Buffer, what: string) {
  if (file.length < 32 || !file.subarray(0, 4).equals(SEALED)) throw new Error(`Not an encrypted ${what}.`);
  const decipher = createDecipheriv("aes-256-gcm", key, file.subarray(4, 16));
  decipher.setAuthTag(file.subarray(16, 32));
  try {
    return Buffer.concat([decipher.update(file.subarray(32)), decipher.final()]);
  } catch {
    throw new Error(`Couldn't decrypt the ${what}: wrong POPULARITY_STORE_KEY, or the file is damaged.`);
  }
}

/** The store at `path`, decoded, or `empty()` when there's no file there yet (logged, naming `what`). */
export async function readStoreOr<T>(path: string, decode: (file: Buffer) => T, empty: () => T, what: string): Promise<T> {
  return readFile(path).then(decode, (error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    console.log(`No ${what} at ${path} yet; starting one.`);
    return empty();
  });
}
