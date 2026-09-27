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
      const response = await fetch("/data/weapons.json", { signal });
      if (!response.ok)
        throw new Error(
          `Weapon catalog could not be loaded (${response.status}).`,
        );
      const data = (await response.json()) as CompactWeaponIndex;
      return createWeaponCatalog(expandWeaponIndex(data));
    },
  });
}
