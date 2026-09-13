"use client";

import { SignInCard } from "@/components/auth/sign-in-card";
import { useSession } from "@/lib/auth/use-session";
import { useArmory } from "@/lib/armory/use-armory";
import { ArmoryStatus } from "@/components/armory/armory-status";
import { ManifestStatus } from "@/components/manifest/manifest-status";
import { ArmorTable } from "@/components/armor-table/armor-table";
import { useDesktopLayout } from "@/components/app-shell";

export function ArmorTablePageShell() {
  const session = useSession();
  const armory = useArmory();
  const authed = session.data?.authenticated ?? false;
  const desktop = useDesktopLayout();

  if (!authed) {
    return (
      <main className="mx-auto max-w-md px-6 py-6">
        <SignInCard />
      </main>
    );
  }

  // While the manifest downloads / the armory loads, show the same status cards
  // the builder uses instead of an empty table. Desktop already has the header
  // toolbar, so the stacked cards are mobile-only.
  if (!armory.data) {
    return (
      <main className="mx-auto max-w-md space-y-4 px-6 py-6">
        <ManifestStatus />
        {!desktop && <ArmoryStatus />}
      </main>
    );
  }

  // Fills the app shell's main area (which is the viewport height) so the table
  // body becomes the scroll container the row virtualizer needs.
  return (
    <main className="flex h-full w-full flex-col">
      <ArmorTable />
    </main>
  );
}
