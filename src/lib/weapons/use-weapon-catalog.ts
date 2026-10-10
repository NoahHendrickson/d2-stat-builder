"use client";

import { useQuery } from "@tanstack/react-query";
import { createWeaponCatalog } from "./catalog";
import { expandWeaponIndex, type CompactWeaponIndex } from "./transport";

export function useWeaponCatalog() {
  return useQuery({
    queryKey: ["weapon-catalog"],
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: async ({ signal }) => {
      const response = await fetch("/data/weapons.json", {
        signal,
        // A hard reload doesn't reach fetches made after load, so in dev always
        // revalidate: a regenerated snapshot shows up on the next reload.
        cache: process.env.NODE_ENV === "development" ? "no-cache" : "default",
      });
      if (!response.ok)
        throw new Error(
          `Weapon catalog could not be loaded (${response.status}).`,
        );
      const data = (await response.json()) as CompactWeaponIndex;
      return createWeaponCatalog(expandWeaponIndex(data));
    },
  });
}
