import type { DestinyProfileResponse } from "bungie-api-ts/destiny2";

type Minted = Pick<
  DestinyProfileResponse,
  "responseMintedTimestamp" | "secondaryComponentsMintedTimestamp"
>;

/**
 * An ETag for a profile: Bungie's two minted timestamps. Bungie serves profiles from
 * its own cache, so a refetch often returns the very snapshot the client already holds
 * (see newerProfile). The client sends the stamps of its copy as If-None-Match and the
 * proxy answers 304 with no body when Bungie's match — the poll stays as frequent and
 * as fresh as before, but an unchanged profile no longer crosses the wire.
 */
export function profileEtag(profile: Partial<Minted> | undefined): string | undefined {
  const response = profile?.responseMintedTimestamp;
  const secondary = profile?.secondaryComponentsMintedTimestamp;
  if (!response || !secondary) return undefined;
  return `"${response}|${secondary}"`;
}

/** Whether an If-None-Match header names `etag` (a list and weak validators allowed). */
export function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  return ifNoneMatch
    .split(",")
    .map((v) => v.trim().replace(/^W\//, ""))
    .some((v) => v === etag || v === "*");
}
