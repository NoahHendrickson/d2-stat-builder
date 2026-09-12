import type { Manifest } from "./load";

/**
 * Memoize a manifest-derived lookup per manifest instance. The manifest is immutable
 * for the page session, so a full-table scan (10–20 ms each over the item table) only
 * needs to happen once per session rather than once per component mount.
 */
export function memoByManifest<T>(compute: (manifest: Manifest) => T) {
  const cache = new WeakMap<Manifest, T>();
  return (manifest: Manifest): T => {
    let value = cache.get(manifest);
    if (value === undefined) {
      value = compute(manifest);
      cache.set(manifest, value);
    }
    return value;
  };
}
