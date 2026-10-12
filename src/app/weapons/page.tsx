import type { Metadata } from "next";
import { Suspense } from "react";
import { WeaponBrowser } from "@/components/weapons/weapon-browser";

export const metadata = {
  title: "Weapons",
  description:
    "Search the Destiny 2 weapon catalog by name, perks, element, frame, and source.",
} satisfies Metadata;

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
