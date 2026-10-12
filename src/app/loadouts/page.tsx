import type { Metadata } from "next";
import { LoadoutsPageShell } from "@/components/loadouts/loadouts-page-shell";

export const metadata = {
  title: "Loadouts",
  description: "Save, edit, and equip your armor loadouts, and send them to in-game loadout slots.",
} satisfies Metadata;

export default function LoadoutsPage() {
  return <LoadoutsPageShell />;
}
