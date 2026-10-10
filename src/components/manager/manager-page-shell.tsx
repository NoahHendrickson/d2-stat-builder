"use client";

import { SignInCard } from "@/components/auth/sign-in-card";
import { useSession } from "@/lib/auth/use-session";
import { useInventory } from "@/lib/inventory/use-inventory";
import { ManagerView } from "./manager-view";

export function ManagerPageShell() {
  const session = useSession();
  const { data, profile, manifestStatus, membershipId } = useInventory();
  const authed = session.data?.authenticated ?? false;

  if (!authed) {
    return (
      <main className="mx-auto flex h-full max-w-md flex-col items-center justify-center px-6 py-6">
        {session.isPending ? (
          <p className="text-muted-foreground text-sm">Checking your session…</p>
        ) : (
          <SignInCard />
        )}
      </main>
    );
  }

  let status: string | undefined;
  if (!data) {
    if (manifestStatus.state === "error") status = manifestStatus.message;
    else if (profile.isError) status = profile.error.message;
    else status = "Loading your inventory…";
  }

  // One scroll for the whole page. The search bar and nameplates pin to its top, and only
  // fill in once something has scrolled under them. Set directly so scrolling never
  // re-renders the view.
  return (
    <main
      className="group/manager d2-scroll flex h-full min-h-0 w-full flex-col overflow-y-auto px-4 py-6 lg:px-6"
      onScroll={(e) => e.currentTarget.toggleAttribute("data-scrolled", e.currentTarget.scrollTop > 0)}
    >
      {data ? (
        <ManagerView inventory={data} membershipId={membershipId} />
      ) : (
        <p className="text-muted-foreground text-sm" aria-busy={!profile.isError}>
          {status}
        </p>
      )}
    </main>
  );
}
