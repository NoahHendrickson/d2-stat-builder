"use client";

import { Suspense, useCallback, useEffect, useState, type ComponentProps } from "react";
import dynamic from "next/dynamic";
import type { LoadoutsPage } from "@/components/loadouts/loadouts-page";
import { loadLoadoutsPage, loadedLoadoutsPage } from "@/components/loadouts/loadouts-page-chunk";
import { useSession } from "@/lib/auth/use-session";
import { useArmory } from "@/lib/armory/use-armory";
import { useManifest } from "@/lib/manifest/use-manifest";

/** Stand-in for the page while its chunk loads: the same pending copy it shows. */
function LoadoutsPagePlaceholder() {
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
const LazyLoadoutsPage = dynamic(
  () => import("@/components/loadouts/loadouts-page").then((m) => m.LoadoutsPage),
  { ssr: false, loading: () => <LoadoutsPagePlaceholder /> },
);

/**
 * The page, rendered directly when its chunk is already in (the app shell warms it once
 * the player is signed in). The lazy wrapper shows its placeholder first even for a
 * loaded chunk, and React keeps a placeholder up for ~300ms before replacing it: a wait
 * on every first visit. Picked once per mount, so the component never changes under the page.
 */
function ReadyLoadoutsPage(props: ComponentProps<typeof LoadoutsPage>) {
  const [Page] = useState(() => loadedLoadoutsPage() ?? LazyLoadoutsPage);
  return <Page {...props} />;
}

export function LoadoutsPageShell() {
  const session = useSession();
  const armory = useArmory();
  const manifestStatus = useManifest();
  const authed = session.data?.authenticated ?? false;

  // Start fetching the page's chunk while the armory and manifest are still loading
  // (direct entry), rather than only once they're ready.
  useEffect(() => {
    if (authed) void loadLoadoutsPage();
  }, [authed]);

  // Stable identity: this reaches every memoized row, so a fresh closure per render
  // would re-render the whole visible list each time an observer notifies the page.
  const { refetch: refetchArmory } = armory;
  const onArmoryChanged = useCallback(() => void refetchArmory(), [refetchArmory]);

  // AppShell owns sign-in: it shows the sign-in screen itself, and keeps the page hidden
  // until the session is confirmed. Nothing to draw before that.
  if (!authed) return null;

  // Cards lay out like the editor drawer (subclass + five piece columns), so they take
  // the main column's width, capped so columns don't sprawl on very wide screens. Both
  // tabs share the cap, so the tabs themselves stay put when switching.
  return (
    <main className="mx-auto flex h-full min-h-0 w-full max-w-[120rem] flex-col px-4 py-6 lg:px-6">
      {!armory.data || manifestStatus.state !== "ready" ? (
        // Rows resolve items against the live armory and read icons from the manifest.
        <LoadoutsPagePlaceholder />
      ) : (
        // useSearchParams (the view tabs, share-link import) needs a Suspense boundary above it.
        <Suspense fallback={<LoadoutsPagePlaceholder />}>
          <ReadyLoadoutsPage
            armory={armory.data}
            provisional={armory.isProvisional}
            manifest={manifestStatus.manifest}
            onArmoryChanged={onArmoryChanged}
            refreshArmory={refetchArmory}
          />
        </Suspense>
      )}
    </main>
  );
}
