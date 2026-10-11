/** Bungie Platform API envelope — HTTP 200 responses can still carry ErrorCode != 1. */
export interface BungiePlatformEnvelope<T = unknown> {
  Response?: T;
  ErrorCode?: number;
  ErrorStatus?: string;
  Message?: string;
}

export const BUNGIE_SUCCESS = 1;

const PROFILE_ERROR_MESSAGES: Record<number, string> = {
  5: "Bungie services are temporarily disabled — try again later",
  10: "Session expired — sign in again",
  11: "Destiny profile not found for this account",
  12: "Bungie denied access — check your Destiny privacy settings (inventory must be visible to third-party apps)",
  31: "Bungie rate limit hit — wait a moment and refresh your gear",
  1601: "No Destiny 2 account on this Bungie.net login — sign in with the account linked to the platform you play on",
};

/** User-facing text for a failed GetProfile platform response. */
export function profileErrorMessage(res: BungiePlatformEnvelope): string {
  const code = res.ErrorCode ?? 0;
  const known = PROFILE_ERROR_MESSAGES[code];
  const bungie = res.Message?.trim();
  const status = res.ErrorStatus?.trim();

  if (known && bungie) return `${known} (${status ?? "Bungie"}: ${bungie})`;
  if (known) return known;
  if (bungie) return `${status ?? "Bungie error"}: ${bungie}`;
  if (status) return `${status} (error ${code})`;
  return `Bungie profile request failed (error ${code})`;
}

/** Some Bungie platform errors mean the stored OAuth session is dead. */
export function shouldClearSessionOnBungieError(code: number): boolean {
  return code === 10; // AuthenticationInvalid
}

/** Structured server log for Vercel — the status column stays 200 without this. */
export function logBungiePlatformError(
  route: string,
  res: BungiePlatformEnvelope,
  extra?: Record<string, unknown>,
): void {
  console.error(`${route}: Bungie platform error`, {
    errorCode: res.ErrorCode,
    errorStatus: res.ErrorStatus,
    message: res.Message,
    ...extra,
  });
}
