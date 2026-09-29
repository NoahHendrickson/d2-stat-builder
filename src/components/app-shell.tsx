"use client";

import { TooltipLabel } from "@/components/ui/tooltip";
import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, Menu01Icon } from "@hugeicons/core-free-icons";
import { AppSidebar, pageTitle } from "@/components/app-sidebar";
import { ArmoryDiagnosticsGate } from "@/components/armory/armory-diagnostics-gate";
import { ApplyProgressSection } from "@/components/loadouts/apply-progress-card";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerClose, DrawerContent } from "@/components/ui/drawer";
import { ThemeToggle } from "@/components/theme-toggle";
import { useLoadouts } from "@/lib/loadouts/use-loadouts";
import { useMinWidth } from "@/lib/use-min-width";
import { cn } from "@/lib/utils";

/** Tailwind `lg` — below it the sidebar collapses into a drawer. */
export const SIDEBAR_BREAKPOINT_PX = 1024;
const SIDEBAR_EXPANDED_PX = 240;
/** Icon rail: 36px rows plus 10px gutters. */
const SIDEBAR_RAIL_PX = 56;
const SIDEBAR_COLLAPSED_KEY = "stat-builder:sidebar-collapsed";

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
 * The sidebar collapses to an icon rail on desktop; on narrow viewports it becomes
 * a left drawer behind a top bar. The armor / game-data / account cluster lives at
 * the sidebar's foot, so on desktop the page starts at the top of the main column.
 */
export function AppShell({ children }: { children: ReactNode }) {
  // Start the signed-in query alongside game data so /loadouts opens with its
  // list ready; LoadoutsList shares and revalidates this same query.
  useLoadouts();
  const desktop = useMinWidth(SIDEBAR_BREAKPOINT_PX);
  const pathname = usePathname();
  const title = pageTitle(pathname);
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
    root.style.setProperty("--app-sidebar-width", `${desktop ? sidebarWidth : 0}px`);
    return () => {
      root.style.removeProperty("--app-sidebar-width");
    };
  }, [desktop, sidebarWidth]);

  return (
    <div className="relative flex h-full w-full">
      <aside
        className={cn(
          // bg-glass (no backdrop-filter): this pane and the main one cover the
          // viewport over the pre-blurred backdrop, so a backdrop blur adds
          // nothing visible — and Firefox re-blurs it on every repaint.
          "bg-glass relative hidden h-full min-w-0 shrink-0 overflow-hidden border-r border-foreground/8 lg:block",
          slideEnabled &&
            "transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
        )}
        style={{ width: sidebarWidth }}
      >
        {desktop && <AppSidebar collapsed={collapsed} onToggle={toggleSidebar} />}
      </aside>

      {/* contain-layout stands in for the dropped backdrop-filter: a stacking
          context plus the containing block the fixed mobile builds bar sits in. */}
      <div className="bg-glass flex min-h-0 min-w-0 flex-1 flex-col contain-layout">
        <header className="flex h-14 shrink-0 items-stretch gap-2 border-b border-foreground/8 pr-2 pl-1 lg:hidden">
          <div className="flex items-center">
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
          <div className="flex items-center">
            <ThemeToggle />
          </div>
        </header>
        {desktop && <h1 className="sr-only">{title}</h1>}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {desktop && (
            <div className="px-6 pt-6 empty:hidden">
              <ArmoryDiagnosticsGate />
            </div>
          )}
          {children}
        </div>
        <ApplyProgressSection />
      </div>

      {!desktop && (
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
