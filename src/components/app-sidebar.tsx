"use client";

import { Suspense, useCallback } from "react";
import { useSession } from "@/lib/auth/use-session";
import { useArmory } from "@/lib/armory/use-armory";
import { useManifest } from "@/lib/manifest/use-manifest";
import { ArmoryStatus } from "@/components/armory/armory-status";
import { LoadoutsList } from "@/components/loadouts/loadouts-list";
import { ThemeToggle } from "@/components/theme-toggle";
import { ViewTabs } from "@/components/view-tabs";

/** Figma "Frame 4" (1:13): header, loadouts, and the armor summary pinned at the bottom. */
export function AppSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const session = useSession();
  const armory = useArmory();
  const manifestStatus = useManifest();
  const authed = session.data?.authenticated ?? false;

  // Stable identity: this reaches every memoized row, so a fresh closure per render
  // would re-render the whole visible list each time an observer notifies the sidebar.
  const { refetch: refetchArmory } = armory;
  const onArmoryChanged = useCallback(() => void refetchArmory(), [refetchArmory]);

  let body: React.ReactNode;
  if (!authed) {
    body = (
      <p className="text-muted-foreground px-4 text-sm">
        {session.isPending
          ? "Checking your session…"
          : "Sign in with Bungie to see your saved loadouts."}
      </p>
    );
  } else if (!armory.data || manifestStatus.state !== "ready") {
    // Rows resolve items against the live armory and read icons from the manifest.
    body = <p className="text-muted-foreground px-4 text-sm">Loading your loadouts…</p>;
  } else {
    // useSearchParams (share-link import) needs a Suspense boundary above it.
    body = (
      <Suspense fallback={null}>
        <LoadoutsList
          armory={armory.data}
          manifest={manifestStatus.manifest}
          onArmoryChanged={onArmoryChanged}
          onNavigate={onNavigate}
        />
      </Suspense>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-16 shrink-0 items-center justify-between p-4">
        <span className="min-w-0 truncate text-sm font-medium">
          D2 stat builder
        </span>
        <ViewTabs onNavigate={onNavigate} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col">{body}</div>

      <div className="shrink-0 p-2">
        {authed ? (
          <ArmoryStatus actions={<ThemeToggle />} />
        ) : (
          <div className="flex justify-end">
            <ThemeToggle />
          </div>
        )}
      </div>
    </div>
  );
}
