/**
 * Run `fn` once the main thread is idle, or after `timeoutMs` at the latest, so warm-up
 * work (prefetches, chunk imports) doesn't compete with the screen being loaded. Safari
 * has no requestIdleCallback; there it just waits a moment. Returns a cancel.
 */
export function whenIdle(fn: () => void, timeoutMs = 2000): () => void {
  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(fn, { timeout: timeoutMs });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(fn, 200);
  return () => clearTimeout(id);
}
