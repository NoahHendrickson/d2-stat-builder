import { Suspense } from "react";
import { WeaponBrowser } from "@/components/weapons/weapon-browser";

export const metadata = {
  title: "Weapon search — D2 Conflux",
  description:
    "Search the Destiny 2 weapon catalog by name, perks, element, frame, and source.",
};

export default function WeaponsPage() {
  return (
    <Suspense
      fallback={
        <p className="p-6 text-muted-foreground">Loading weapon search…</p>
      }
    >
      <WeaponBrowser />
    </Suspense>
  );
}
