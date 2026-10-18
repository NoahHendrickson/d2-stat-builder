"use client";

import { useStaticJson } from "@/lib/use-static-json";
import type { WeaponDpsIndex } from "./weapon-dps";

/**
 * The boss DPS snapshot (public/data/weapon-dps.json). Optional: if it fails to
 * load, the weapon page just goes without its Advanced stats.
 */
export function useWeaponDps() {
  return useStaticJson({
    key: "weapon-dps",
    urls: ["/data/weapon-dps.json"],
    what: "Weapon DPS",
    revalidateInDev: true,
    parse: (json) => {
      const data = json as WeaponDpsIndex;
      if (data?.schema !== 1 || typeof data.weapons !== "object")
        throw new Error("The weapon DPS snapshot is incomplete.");
      return data;
    },
  });
}
