// Bungie's "slow down" errors, shared by every server path that moves, equips, or
// sockets items. A burst of item actions (e.g. a loadout right after another) can trip
// the game server's per-account limit; a short wait clears it.
import { BungieHttpError } from "./http";

/** PlatformErrorCodes that mean "slow down" rather than "no". */
export const THROTTLE_CODES = new Set([
  31, // ThrottleLimitExceeded
  36, // ThrottleLimitExceededMomentarily
  37, // ThrottleLimitExceededSeconds
  51, // PerEndpointRequestThrottleExceeded
  1672, // DestinyThrottledByGameServer
]);
/** ThrottleLimitExceededMinutes: not worth holding the request open for. */
const THROTTLED_MINUTES = 35;
export const MAX_THROTTLE_RETRIES = 2;
/** Longest we wait out a throttle inside one request. */
const MAX_THROTTLE_WAIT_MS = 5000;
export const THROTTLED_MESSAGE = "Bungie is limiting item moves — wait a moment and try again";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** How long to back off for Bungie's `ThrottleSeconds` (1s when it doesn't say). */
export const throttleWait = (seconds?: number) =>
  sleep(Math.min((seconds || 1) * 1000, MAX_THROTTLE_WAIT_MS));

export function isThrottled(err: unknown): boolean {
  return (
    err instanceof BungieHttpError &&
    err.code !== undefined &&
    (THROTTLE_CODES.has(err.code) || err.code === THROTTLED_MINUTES)
  );
}

/**
 * Run one Bungie action, waiting out a short throttle (up to MAX_THROTTLE_RETRIES times)
 * before giving up. Any other error is thrown as is.
 */
export async function withThrottleRetry<T>(call: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (err) {
      const retryable =
        err instanceof BungieHttpError && err.code !== undefined && THROTTLE_CODES.has(err.code);
      if (!retryable || attempt >= MAX_THROTTLE_RETRIES) throw err;
      await throttleWait(err.throttleSeconds);
    }
  }
}
