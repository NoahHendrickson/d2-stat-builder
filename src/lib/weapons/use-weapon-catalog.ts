"use client";

import { useStaticJson } from "@/lib/use-static-json";
import { createWeaponCatalog } from "./catalog";
import { expandWeaponIndex, type CompactWeaponIndex } from "./transport";

export function useWeaponCatalog() {
  return useStaticJson({
    key: "weapon-catalog",
    url: "/data/weapons.json",
    what: "Weapon catalog",
    revalidateInDev: true,
    parse: (json) => createWeaponCatalog(expandWeaponIndex(json as CompactWeaponIndex)),
  });
}
