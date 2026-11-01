// Shared plumbing for the Neon stores. Server-only.
//
// Every table is created lazily on first use (`CREATE TABLE IF NOT EXISTS`); there is no
// migration tooling. Add a real migration step if a schema ever changes shape.

/**
 * Runs `create` once per process, the first time the returned function is called. A
 * failure is not remembered, so the next call tries again.
 */
export function lazySchema(create: () => Promise<unknown>): () => Promise<void> {
  let ready: Promise<void> | null = null;
  return () => {
    ready ??= create().then(
      () => undefined,
      (err) => {
        ready = null;
        throw err;
      },
    );
    return ready;
  };
}

/** A per-process store built from `DATABASE_URL` on first call, or null when it isn't set. */
export function fromDatabaseUrl<T>(create: (url: string) => T): () => T | null {
  let store: T | null | undefined;
  return () => {
    if (store === undefined) {
      const url = process.env.DATABASE_URL;
      store = url ? create(url) : null;
    }
    return store;
  };
}
