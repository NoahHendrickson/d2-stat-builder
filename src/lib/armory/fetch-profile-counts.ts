import type { DestinyProfileResponse } from "bungie-api-ts/destiny2";
import { countProfileItems, type ProfileItemCounts } from "./profile-counts";

/** Diagnostics-only profile fetch — keeps raw item counts off the core Armory type. */
export async function fetchProfileItemCounts(): Promise<ProfileItemCounts> {
  const res = await fetch("/api/bungie/profile", { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Profile request failed: ${res.status}`);
  }
  const profile = (await res.json()) as DestinyProfileResponse;
  return countProfileItems(profile);
}
