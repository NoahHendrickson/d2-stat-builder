"use client";

import { Suspense, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import { SignInCard } from "@/components/auth/sign-in-card";
import { useSession } from "@/lib/auth/use-session";
import { useArmory } from "@/lib/armory/use-armory";
import { useManifest } from "@/lib/manifest/use-manifest";

/** Stand-in for LoadoutsList while its chunk loads: the same pending copy it shows. */
function LoadoutsListPlaceholder() {
  return (
    <p className="text-muted-foreground text-sm" aria-busy>
      Loading your loadouts…
    </p>
  );
}

/**
 * The loadouts UI (rows, editor drawer, apply flow — thousands of lines) is fetched
 * on this page (for signed-in players) rather than shipped with the root layout.
 * Client-only: it never renders on the server (it needs both of those loaded).
 */
const LoadoutsList = dynamic(
  () => import("@/components/loadouts/loadouts-list").then((m) => m.LoadoutsList),
  { ssr: false, loading: () => <LoadoutsListPlaceholder /> },
);

export function LoadoutsPageShell() {
  const session = useSession();
  const armory = useArmory();
  const manifestStatus = useManifest();
  const authed = session.data?.authenticated ?? false;

  // Start fetching the list's chunk while the armory and manifest are still loading
  // (direct entry), rather than only once they're ready. Importing has no side effects.
  useEffect(() => {
    if (authed) void import("@/components/loadouts/loadouts-list");
  }, [authed]);

  // Stable identity: this reaches every memoized row, so a fresh closure per render
  // would re-render the whole visible list each time an observer notifies the page.
  const { refetch: refetchArmory } = armory;
  const onArmoryChanged = useCallback(() => void refetchArmory(), [refetchArmory]);

  if (!authed) {
    return (
      <main className="mx-auto max-w-md px-6 py-6">
        {session.isPending ? (
          <p className="text-muted-foreground text-sm">Checking your session…</p>
        ) : (
          <SignInCard />
        )}
      </main>
    );
  }

  // Cards lay out like the editor drawer (subclass + five piece columns), so they take
  // the main column's width, capped so columns don't sprawl on very wide screens.
  return (
    <main className="mx-auto flex h-full min-h-0 w-full max-w-[100rem] flex-col px-4 py-6 lg:px-6">
      {!armory.data || manifestStatus.state !== "ready" ? (
        // Rows resolve items against the live armory and read icons from the manifest.
        <LoadoutsListPlaceholder />
      ) : (
        // useSearchParams (share-link import) needs a Suspense boundary above it.
        <Suspense fallback={<LoadoutsListPlaceholder />}>
          <LoadoutsList
            armory={armory.data}
            provisional={armory.isProvisional}
            manifest={manifestStatus.manifest}
            onArmoryChanged={onArmoryChanged}
          />
        </Suspense>
      )}
    </main>
  );
}
