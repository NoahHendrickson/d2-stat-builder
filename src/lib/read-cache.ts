// Shared pieces of the stores that serve per-account reads from Vercel's shared cache
// ("use cache: remote") instead of Neon: every page load and window focus reads them,
// and each read that reaches Neon keeps the database awake. Each store tags its cached
// read per account and expires the tag on every write. The expiry is sent alongside
// the write's response, so a read in that same instant can still get the old answer;
// after that, reads go to Neon. An entry is stamped with when its read *started*, so a
// read overlapping a write can't store the old rows as new. Writes that skip this
// deployment (canary shares the database) show up once the entry ages out: after
// `revalidate` one stale answer refreshes it, and after `expire` it is never served.
// Server-only.
import { revalidateTag } from "next/cache";

export const ACCOUNT_READ_LIFE = { revalidate: 5 * 60, expire: 10 * 60 };

/** A store error already logged, with its real message, where it happened. */
export class LoggedStorageError extends Error {
  constructor(cause: unknown) {
    super("Storage read failed (logged where it happened)", { cause });
    this.name = "LoggedStorageError";
  }
}

export function logStorageError(err: unknown, what: string) {
  console.error(`${what} storage error:`, err instanceof Error ? err.message : err);
}

/**
 * Runs a store read inside a cache scope, logging its error there: production replaces
 * an error thrown out of a cached function with a generic one, and the real message
 * (a Neon quota 402, say) is what the logs need.
 */
export async function loggedRead<T>(what: string, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (err) {
    logStorageError(err, what);
    throw err;
  }
}

/** Awaits a cached read, marking its error as logged so `storageError` doesn't log it again. */
export async function fromCache<T>(read: Promise<T>): Promise<T> {
  try {
    return await read;
  } catch (err) {
    throw new LoggedStorageError(err);
  }
}

/** Runs a write, then expires `tag` whether or not it succeeded: a failed one may still have landed. */
export async function expiring<T>(tag: string, write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } finally {
    revalidateTag(tag, { expire: 0 });
  }
}
