"use client";

import { TooltipLabel } from "@/components/ui/tooltip";
import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, Menu01Icon } from "@hugeicons/core-free-icons";
import { AppSidebar, NAV_ITEMS, pageTitle } from "@/components/app-sidebar";
import { SignInCard, useAuthResultToast } from "@/components/auth/sign-in-card";
import { BugReportDialog } from "@/components/bug-report/bug-report-dialog";
import { ArmoryDiagnosticsGate } from "@/components/armory/armory-diagnostics-gate";
import { ApplyProgressSection } from "@/components/loadouts/apply-progress-card";
import { loadLoadoutsList } from "@/components/loadouts/loadouts-list-chunk";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerClose, DrawerContent } from "@/components/ui/drawer";
import { SettingsSync } from "@/components/settings-sync";
import { BuildUsageRecorder } from "@/components/build-usage-recorder";
import { AnnotationsSync } from "@/components/annotations-sync";
import { SiteIconSync } from "@/components/site-icon-sync";
import { ThemeToggle } from "@/components/theme-toggle";
import { useSession } from "@/lib/auth/use-session";
import { useLoadouts } from "@/lib/loadouts/use-loadouts";
import { useMinWidth } from "@/lib/use-min-width";
import { cn } from "@/lib/utils";
import { whenIdle } from "@/lib/when-idle";

/** Tailwind `lg` — below it the sidebar collapses into a drawer. */
export const SIDEBAR_BREAKPOINT_PX = 1024;
const SIDEBAR_EXPANDED_PX = 240;
/** Icon rail: 36px rows plus 10px gutters. */
const SIDEBAR_RAIL_PX = 56;
const SIDEBAR_COLLAPSED_KEY = "stat-builder:sidebar-collapsed";
/** Views anyone can open signed out: the component showcase needs no account. */
const PUBLIC_PATHS: ReadonlySet<string> = new Set(["/components"]);
/** The showcase framed on another site: just the page, no sidebar or header. */
const EMBED_PATH = "/components/embed";

let sidebarCollapsedValue: boolean | null = null;
const sidebarCollapsedListeners = new Set<() => void>();

function loadSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function getSidebarCollapsed(): boolean {
  sidebarCollapsedValue ??= loadSidebarCollapsed();
  return sidebarCollapsedValue;
}

function subscribeSidebarCollapsed(listener: () => void): () => void {
  sidebarCollapsedListeners.add(listener);
  return () => {
    sidebarCollapsedListeners.delete(listener);
  };
}

function setSidebarCollapsed(collapsed: boolean): void {
  if (collapsed === sidebarCollapsedValue) return;
  sidebarCollapsedValue = collapsed;
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // Persistence is best-effort — quota / privacy modes are ignored.
  }
  for (const listener of sidebarCollapsedListeners) listener();
}

/**
 * Whether the viewport is at the desktop sidebar breakpoint. Pages use this to
 * skip inline status cards — the sidebar's foot already shows them on desktop.
 */
export function useDesktopLayout(): boolean {
  return useMinWidth(SIDEBAR_BREAKPOINT_PX);
}

/**
 * App frame: a navigation sidebar (views + saved links) beside the active page.
 * Only a signed-in player gets the sidebar and the page. Everyone else gets just the
 * sign-in screen, decided here once for every route: signed out, or a session check that
 * failed. While the check is still out (and in the prerender), the page renders but stays
 * invisible and the sidebar pane stays empty, so a signed-out visit never flashes either;
 * the loader covers that moment on the gear views.
 * PUBLIC_PATHS (the /components showcase) skip the gate: signed out, they render
 * without the sidebar pane. EMBED_PATH (the same showcase, framed on the portfolio)
 * renders bare.
 * The sidebar collapses to an icon rail on desktop; on narrow viewports it becomes
 * a left drawer behind a top bar. The armor / game-data / account cluster lives at
 * the sidebar's foot, so on desktop the page starts at the top of the main column.
 */
export function AppShell({ children }: { children: ReactNode }) {
  // Start the signed-in query alongside game data so /loadouts opens with its
  // list ready; LoadoutsList shares and revalidates this same query.
  useLoadouts();
  // Its code too: the list is a chunk of its own, and a first visit that had to wait
  // for it sat on the placeholder for ~300ms (see ReadyLoadoutsList).
  const session = useSession();
  const authed = session.data?.authenticated === true;
  const checked = session.data !== undefined || session.isError;
  useAuthResultToast();
  useEffect(() => {
    if (!authed) return;
    return whenIdle(() => void loadLoadoutsList());
  }, [authed]);
  const desktop = useMinWidth(SIDEBAR_BREAKPOINT_PX);
  // The sidebar's links prefetch their views as soon as they're on screen. Below the
  // breakpoint they only exist while the menu drawer is open, so the first tap raced
  // the fetch it had just started: warm the same views up front instead.
  const router = useRouter();
  useEffect(() => {
    if (desktop) return;
    return whenIdle(() => {
      for (const item of NAV_ITEMS) router.prefetch(item.href);
    });
  }, [desktop, router]);
  const pathname = usePathname();
  const title = pageTitle(pathname);
  const publicView = PUBLIC_PATHS.has(pathname);
  const signedOut = checked && !authed;
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Stable handlers: AppSidebar is memoized.
  const toggleSidebar = useCallback(
    () => setSidebarCollapsed(!getSidebarCollapsed()),
    [],
  );
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const collapsed = useSyncExternalStore(
    subscribeSidebarCollapsed,
    getSidebarCollapsed,
    () => false,
  );
  // Transitions stay off until after the stored collapsed snapshot has painted, so a
  // refresh doesn't replay the slide. Client snapshot is true; the hydrating render
  // matches the server (false), then React re-renders.
  const slideEnabled = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const sidebarWidth = collapsed ? SIDEBAR_RAIL_PX : SIDEBAR_EXPANDED_PX;

  // Portaled surfaces (the loadout editor drawer) sit over the main column,
  // not the sidebar. Publish the width so anything under <html> can inset.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty(
      "--app-sidebar-width",
      `${desktop && authed ? sidebarWidth : 0}px`,
    );
    return () => {
      root.style.removeProperty("--app-sidebar-width");
    };
  }, [desktop, authed, sidebarWidth]);

  if (pathname === EMBED_PATH) {
    return <>{children}</>;
  }

  if (signedOut && !publicView) {
    return (
      <main className="bg-shell-main flex h-full w-full items-center justify-center overflow-y-auto px-6 py-6">
        <div className="w-full max-w-md">
          <SignInCard />
        </div>
      </main>
    );
  }

  return (
    <div className="relative flex h-full w-full">
      <aside
        className={cn(
          // bg-shell-* (glass, no backdrop-filter): this pane and the main one cover the
          // viewport over the pre-blurred backdrop, so a backdrop blur adds
          // nothing visible — and Firefox re-blurs it on every repaint.
          "bg-shell-sidebar relative hidden h-full min-w-0 shrink-0 overflow-hidden border-r border-foreground/8",
          !signedOut && "lg:block",
          slideEnabled &&
            "transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
        )}
        style={{ width: sidebarWidth }}
      >
        {desktop && authed && <AppSidebar collapsed={collapsed} onToggle={toggleSidebar} />}
      </aside>

      {/* contain-layout stands in for the dropped backdrop-filter: a stacking
          context plus the containing block the fixed mobile builds bar sits in. */}
      <div className="bg-shell-main flex min-h-0 min-w-0 flex-1 flex-col contain-layout">
        <header className="flex h-14 shrink-0 items-stretch gap-2 border-b border-foreground/8 pr-2 pl-1 lg:hidden">
          <div className={cn("flex items-center", !authed && "invisible")}>
            <TooltipLabel label="Open menu">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Open menu"
                onClick={() => setDrawerOpen(true)}
              >
                <HugeiconsIcon icon={Menu01Icon} strokeWidth={2} aria-hidden />
              </Button>
            </TooltipLabel>
          </div>
          <h1 className="flex min-w-0 flex-1 items-center truncate text-sm font-medium">
            {title}
          </h1>
          <div className={cn("flex items-center", !authed && "invisible")}>
            <ThemeToggle />
          </div>
        </header>
        {desktop && <h1 className="sr-only">{title}</h1>}
        {/* No fade on a view change: a kept view is ready the moment it's shown, and a
            fade from nothing held it back ~170ms on every tab swap. */}
        <div className={cn("min-h-0 flex-1 overflow-y-auto", !authed && !publicView && "invisible")}>
          {desktop && authed && (
            <div className="px-6 pt-6 empty:hidden">
              <ArmoryDiagnosticsGate />
            </div>
          )}
          {children}
        </div>
        <ApplyProgressSection />
      </div>
      <SiteIconSync />
      <SettingsSync />
      <BuildUsageRecorder />
      <AnnotationsSync />
      {authed && <BugReportDialog />}

      {!desktop && authed && (
        <Drawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          swipeDirection="left"
        >
          <DrawerContent aria-label="Menu" className="d2-sidebar">
            <div className="absolute top-3 right-2 z-10">
              <TooltipLabel label="Close menu">
                <DrawerClose
                  aria-label="Close menu"
                  render={<Button variant="ghost" size="icon-sm" />}
                >
                  <HugeiconsIcon icon={Cancel01Icon} />
                </DrawerClose>
              </TooltipLabel>
            </div>
            <AppSidebar onNavigate={closeDrawer} />
          </DrawerContent>
        </Drawer>
      )}
    </div>
  );
}
