"use client";

import { Suspense, useCallback } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { SidebarSimple } from "@phosphor-icons/react";
import { useSession } from "@/lib/auth/use-session";
import { useArmory } from "@/lib/armory/use-armory";
import { useManifest } from "@/lib/manifest/use-manifest";
import { ArmoryStatus } from "@/components/armory/armory-status";
import { ThemeToggle } from "@/components/theme-toggle";
import { ViewTabs } from "@/components/view-tabs";
import { Button } from "@/components/ui/button";
import { TooltipLabel } from "@/components/ui/tooltip";

/**
 * Stand-in for LoadoutsList while its chunk loads: the same header footprint (search
 * box, count row) and the same pending copy the list itself shows, so nothing shifts
 * when it lands.
 */
function LoadoutsListPlaceholder() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" aria-busy>
      <div className="flex flex-col gap-1 px-4">
        <div className="h-9" />
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
  { ssr: false, loading: () => <LoadoutsListPlaceholder /> },
);

/** Collapse control, title, and view switch — the sidebar's top row (Figma 14:4965). */
export function SidebarChrome({
  onNavigate,
  onToggle,
  collapsed = false,
}: {
  onNavigate?: () => void;
  onToggle?: () => void;
  collapsed?: boolean;
}) {
  const toggleLabel = collapsed ? "Show sidebar" : "Collapse sidebar";

  return (
    <div className="flex h-16 w-full items-center justify-between gap-2 p-4">
      <div className="flex min-w-0 items-center gap-2">
        <Image
          src="/sidebar-logo.svg"
          alt=""
          width={27}
          height={27}
          className="size-[27px] shrink-0"
          unoptimized
          aria-hidden
        />
        <span className="min-w-0 truncate text-sm font-medium">
          D2 stat builder
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {onToggle && (
          <TooltipLabel label={toggleLabel}>
            <Button
              variant="ghost"
              size="icon"
              aria-label={toggleLabel}
              onClick={onToggle}
            >
              <SidebarSimple weight="bold" aria-hidden />
            </Button>
          </TooltipLabel>
        )}
        <ViewTabs onNavigate={onNavigate} />
      </div>
    </div>
  );
}

/** Figma "Frame 4" (1:13): header, loadouts, and the account card pinned at the bottom. */
export function AppSidebar({
  onNavigate,
  chrome = true,
}: {
  onNavigate?: () => void;
  /** False when the shell paints the chrome in a pinned overlay. */
  chrome?: boolean;
}) {
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
      {chrome ? (
        <SidebarChrome onNavigate={onNavigate} />
      ) : (
        <div className="h-16 shrink-0" aria-hidden />
      )}

      <div className="flex min-h-0 flex-1 flex-col">{body}</div>

      {authed ? (
        <div className="shrink-0 p-2">
          <ArmoryStatus />
        </div>
      ) : (
        <div className="flex shrink-0 justify-end p-2">
          <ThemeToggle />
        </div>
      )}
    </div>
  );
}
