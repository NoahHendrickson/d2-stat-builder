"use client";

import { useQuery } from "@tanstack/react-query";
import type { WeaponDpsIndex } from "./weapon-dps";

/**
 * The boss DPS snapshot (public/data/weapon-dps.json). Optional: if it fails to
 * load, the weapon page just goes without its Advanced stats.
 */
export function useWeaponDps() {
  return useQuery({
    queryKey: ["weapon-dps"],
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: async ({ signal }) => {
      const response = await fetch("/data/weapon-dps.json", {
        signal,
        cache: process.env.NODE_ENV === "development" ? "no-cache" : "default",
      });
      if (!response.ok)
        throw new Error(`Weapon DPS could not be loaded (${response.status}).`);
      const data = (await response.json()) as WeaponDpsIndex;
      if (data.schema !== 1 || typeof data.weapons !== "object")
        throw new Error("The weapon DPS snapshot is incomplete.");
      return data;
    },
  });
}
