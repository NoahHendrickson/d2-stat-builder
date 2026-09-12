"use client";

import { Suspense, useCallback, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { SidebarSimple } from "@phosphor-icons/react";
import { useSession } from "@/lib/auth/use-session";
import { useArmory } from "@/lib/armory/use-armory";
import { useManifest } from "@/lib/manifest/use-manifest";
import { ArmoryStatus } from "@/components/armory/armory-status";
import { ApplyProgressSection } from "@/components/loadouts/apply-progress-card";
import { Button } from "@/components/ui/button";
import { TooltipLabel } from "@/components/ui/tooltip";

function CollapseButton({ onToggle }: { onToggle: () => void }) {
  return (
    <TooltipLabel label="Collapse sidebar">
      <Button
        variant="ghost"
        size="icon-lg"
        aria-label="Collapse sidebar"
        onClick={onToggle}
      >
        <SidebarSimple weight="bold" aria-hidden />
      </Button>
    </TooltipLabel>
  );
}

/**
 * Stand-in for LoadoutsList while its chunk loads: the same header footprint (search
 * box, count row, optional collapse control) and the same pending copy the list
 * itself shows, so nothing shifts when it lands.
 */
function LoadoutsListPlaceholder({ headerAction }: { headerAction?: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" aria-busy>
      <div className="flex flex-col gap-1 px-4">
        <div className="flex items-center gap-1">
          <div className="h-9 min-w-0 flex-1" />
          {headerAction}
        </div>
        <div className="h-8" />
      </div>
      <p className="text-muted-foreground px-4 text-sm">Loading your loadouts…</p>
    </div>
  );
}

/**
 * The loadouts UI (rows, editor drawer, apply flow — thousands of lines) is fetched
 * once the armory and manifest are ready rather than shipped with the root layout.
 * Client-only: it never renders on the server (it needs both of those loaded).
 */
const LoadoutsList = dynamic(
  () => import("@/components/loadouts/loadouts-list").then((m) => m.LoadoutsList),
  { ssr: false },
);

/** Figma 46:1658: loadouts list, with the account card only in the mobile drawer. */
export function AppSidebar({
  onNavigate,
  onToggle,
  showAccount = false,
}: {
  onNavigate?: () => void;
  onToggle?: () => void;
  /** True in the narrow-viewport drawer, where the header toolbar doesn't fit. */
  showAccount?: boolean;
}) {
  const session = useSession();
  const armory = useArmory();
  const manifestStatus = useManifest();
  const authed = session.data?.authenticated ?? false;
  const collapseButton = onToggle ? <CollapseButton onToggle={onToggle} /> : null;

  // Stable identity: this reaches every memoized row, so a fresh closure per render
  // would re-render the whole visible list each time an observer notifies the sidebar.
  const { refetch: refetchArmory } = armory;
  const onArmoryChanged = useCallback(() => void refetchArmory(), [refetchArmory]);

  let body: React.ReactNode;
  if (!authed) {
    body = (
      <div className="flex flex-col gap-2">
        {collapseButton ? (
          <div className="flex justify-end px-2">{collapseButton}</div>
        ) : null}
        <p className="text-muted-foreground px-4 text-sm">
          {session.isPending
            ? "Checking your session…"
            : "Sign in with Bungie to see your saved loadouts."}
        </p>
      </div>
    );
  } else if (!armory.data || manifestStatus.state !== "ready") {
    // Rows resolve items against the live armory and read icons from the manifest.
    body = (
      <div className="flex flex-col gap-2">
        {collapseButton ? (
          <div className="flex justify-end px-2">{collapseButton}</div>
        ) : null}
        <p className="text-muted-foreground px-4 text-sm">
          Loading your loadouts…
        </p>
      </div>
    );
  } else {
    // useSearchParams (share-link import) needs a Suspense boundary above it.
    body = (
      <Suspense fallback={<LoadoutsListPlaceholder headerAction={collapseButton} />}>
        <LoadoutsList
          armory={armory.data}
          manifest={manifestStatus.manifest}
          onArmoryChanged={onArmoryChanged}
          onNavigate={onNavigate}
          headerAction={collapseButton}
        />
      </Suspense>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col pt-4">
      <div className="flex min-h-0 flex-1 flex-col">{body}</div>

      <ApplyProgressSection />

      {showAccount && authed && (
        <div className="shrink-0 p-2">
          <ArmoryStatus />
        </div>
      )}
    </div>
  );
}
