// Server half of the inventory manager's moves (POST /api/bungie/move): runs a planned
// move against Bungie one call at a time, backing off when Bungie throttles us.
import type { HttpClient } from "bungie-api-ts/http";
import {
  equipItem,
  pullFromPostmaster,
  transferItem,
  type BungieMembershipType,
} from "bungie-api-ts/destiny2";
import { BungieHttpError } from "./http";
import { ACTION_SPACING_MS, EQUIP_MESSAGES, transferMessage } from "./equip-server";
import { landingAfter, planMove, type Landing, type MoveRequest, type MoveStep } from "./move-plan";

export type MoveResult =
  | { ok: true; landed: Landing }
  | {
      ok: false;
      error: string;
      /** Where the item was left when a later step failed; null when it never moved. */
      landed: Landing | null;
    };

/** PlatformErrorCodes that mean "slow down" rather than "no". */
const THROTTLE_CODES = new Set([
  31, // ThrottleLimitExceeded
  36, // ThrottleLimitExceededMomentarily
  37, // ThrottleLimitExceededSeconds
  51, // PerEndpointRequestThrottleExceeded
  1672, // DestinyThrottledByGameServer
]);
/** ThrottleLimitExceededMinutes: not worth holding the request open for. */
const THROTTLED_MINUTES = 35;
const MAX_THROTTLE_RETRIES = 2;
/** Longest we wait out a throttle inside one request. */
const MAX_THROTTLE_WAIT_MS = 5000;
export const THROTTLED_MESSAGE = "Bungie is limiting item moves — wait a moment and try again";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
      await sleep(Math.min((err.throttleSeconds || 1) * 1000, MAX_THROTTLE_WAIT_MS));
    }
  }
}

function stepMessage(step: MoveStep, err: unknown): string {
  if (isThrottled(err)) return THROTTLED_MESSAGE;
  if (step.kind === "equip") {
    const code = err instanceof BungieHttpError ? err.code : undefined;
    return (
      (code !== undefined ? EQUIP_MESSAGES[code] : undefined) ??
      (err instanceof Error ? err.message : "Equip failed")
    );
  }
  return transferMessage(err, step.kind === "toVault");
}

/**
 * Run one move. Bungie 401s are re-thrown (the route clears the session); every other
 * failure becomes `{ ok: false }` with where the item ended up, so the client can show
 * it there instead of snapping it back.
 */
export async function runMove({
  http,
  membershipType,
  request,
}: {
  http: HttpClient;
  membershipType: BungieMembershipType;
  request: MoveRequest;
}): Promise<MoveResult> {
  let steps: MoveStep[];
  try {
    steps = planMove(request);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Can't move that", landed: null };
  }

  const { itemId, itemHash, stackSize } = request;
  const call = (step: MoveStep) => {
    const base = { itemId, characterId: step.characterId, membershipType };
    switch (step.kind) {
      case "pull":
        return pullFromPostmaster(http, { ...base, itemReferenceHash: itemHash, stackSize });
      case "toVault":
      case "fromVault":
        return transferItem(http, {
          ...base,
          itemReferenceHash: itemHash,
          stackSize,
          transferToVault: step.kind === "toVault",
        });
      case "equip":
        return equipItem(http, base);
    }
  };

  let landed: Landing | null = null;
  for (const [i, step] of steps.entries()) {
    if (i > 0) await sleep(ACTION_SPACING_MS);
    try {
      await withThrottleRetry(() => call(step));
    } catch (err) {
      if (err instanceof BungieHttpError && err.status === 401) throw err;
      return { ok: false, error: stepMessage(step, err), landed };
    }
    landed = landingAfter(step);
  }

  // A no-op plan (already there) lands where it started.
  if (!landed) {
    landed =
      request.to.kind === "vault"
        ? { kind: "vault" }
        : { kind: "character", characterId: request.to.characterId, equipped: request.to.equip };
  }
  return { ok: true, landed };
}
