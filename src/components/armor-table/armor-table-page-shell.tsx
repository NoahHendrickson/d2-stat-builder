"use client";

import { SignInCard } from "@/components/auth/sign-in-card";
import { useSession } from "@/lib/auth/use-session";
import { useArmory } from "@/lib/armory/use-armory";
import { ArmoryStatus } from "@/components/armory/armory-status";
import { ManifestStatus } from "@/components/manifest/manifest-status";
import { ArmorTable } from "@/components/armor-table/armor-table";
import { useSidebarVisible } from "@/components/app-shell";
import { cn } from "@/lib/utils";

export function ArmorTablePageShell() {
  const session = useSession();
  const armory = useArmory();
  const authed = session.data?.authenticated ?? false;
  // The sidebar already shows the account card once it is on screen.
  const sidebarVisible = useSidebarVisible();

  if (!authed) {
    return (
      <main className="mx-auto max-w-md px-6 py-6">
        <SignInCard />
      </main>
    );
  }

  // While the manifest downloads / the armory loads, show the same status cards
  // the builder uses instead of an empty table.
  if (!armory.data) {
    return (
      <main
        className={cn(
          "mx-auto max-w-md space-y-4 px-6 py-6",
          !sidebarVisible && "lg:pt-20",
        )}
      >
        <ManifestStatus />
        {!sidebarVisible && <ArmoryStatus />}
      </main>
    );
  }

  // Fills the app shell's main area (which is the viewport height) so the table
  // body becomes the scroll container the row virtualizer needs. Extra top inset
  // when the sidebar is collapsed so the pinned chrome doesn't cover the toolbar.
  return (
    <main
      className={cn(
        "flex h-full w-full flex-col px-4 py-6 lg:pb-8",
        sidebarVisible ? "lg:pt-8" : "lg:pt-20",
      )}
    >
      <ArmorTable />
    </main>
  );
}
