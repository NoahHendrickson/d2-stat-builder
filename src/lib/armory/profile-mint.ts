import type { DestinyProfileResponse } from "bungie-api-ts/destiny2";

/** The two stamps Bungie puts on every profile: when the snapshot was generated. */
export const MINTED_KEYS = [
  "responseMintedTimestamp",
  "secondaryComponentsMintedTimestamp",
] as const;

export type Minted = Pick<DestinyProfileResponse, (typeof MINTED_KEYS)[number]>;

/**
 * Bump when the proxy's output for the same Bungie snapshot changes — the component
 * list or slimProfile in app/api/bungie/profile/route.ts — so a client holding the old
 * shape gets a full body instead of a 304 until Bungie mints a new snapshot.
 */
export const PROFILE_SHAPE_VERSION = 1;

/** Request header the client sends with the stamps of the profile it already holds. */
export const HELD_PROFILE_HEADER = "X-Profile-Held";

/**
 * Whether `next` was minted later than `prev` — either stamp strictly later. Bungie
 * serves profiles from a cache, so a refetch can come back the same snapshot, or an
 * older one; neither should replace what the client has. A missing or unreadable
 * stamp is NaN, which never compares as older, so `next` counts as newer.
 */
export function isNewerMint(prev: Partial<Minted>, next: Partial<Minted>): boolean {
  return !MINTED_KEYS.every((key) => Date.parse(next[key] ?? "") <= Date.parse(prev[key] ?? ""));
}

/** The header value for a held profile, or undefined when it has no stamps to send. */
export function encodeHeldProfile(held: Partial<Minted> | undefined): string | undefined {
  const [response, secondary] = MINTED_KEYS.map((key) => held?.[key]);
  if (!response || !secondary) return undefined;
  return [PROFILE_SHAPE_VERSION, response, secondary].join(" ");
}

/**
 * The stamps a request's header names, or undefined when there is no header, it is
 * malformed, or it was written for another shape of the proxy's output.
 */
export function parseHeldProfile(header: string | null): Minted | undefined {
  if (!header) return undefined;
  const [version, response, secondary, ...rest] = header.trim().split(/\s+/);
  if (Number(version) !== PROFILE_SHAPE_VERSION || !response || !secondary || rest.length) {
    return undefined;
  }
  return { responseMintedTimestamp: response, secondaryComponentsMintedTimestamp: secondary };
}
