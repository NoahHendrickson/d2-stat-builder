"use client";

import { TooltipLabel } from "@/components/ui/tooltip";
import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { List, XIcon } from "@phosphor-icons/react";
import { AppSidebar, SidebarChrome } from "@/components/app-sidebar";
import { ViewTabs } from "@/components/view-tabs";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerClose, DrawerContent } from "@/components/ui/drawer";
import { SHARE_PARAM } from "@/lib/loadouts/share";
import { useMinWidth } from "@/lib/use-min-width";
import { cn } from "@/lib/utils";

/** Tailwind `lg` — below it the sidebar collapses into a drawer. */
export const SIDEBAR_BREAKPOINT_PX = 1024;
/** Figma 1:2 sidebar width — also the reset target. */
const SIDEBAR_DEFAULT_PX = 340;
const SIDEBAR_MIN_PX = 260;
const SIDEBAR_MAX_PX = 560;
const SIDEBAR_WIDTH_KEY = "stat-builder:sidebar-width";
const SIDEBAR_COLLAPSED_KEY = "stat-builder:sidebar-collapsed";

function clampSidebarWidth(px: number): number {
  return Math.round(Math.min(SIDEBAR_MAX_PX, Math.max(SIDEBAR_MIN_PX, px)));
}

function loadSidebarWidth(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (raw == null) return SIDEBAR_DEFAULT_PX;
    const n = Number(raw);
    return Number.isFinite(n) ? clampSidebarWidth(n) : SIDEBAR_DEFAULT_PX;
  } catch {
    return SIDEBAR_DEFAULT_PX;
  }
}

function saveSidebarWidth(px: number): void {
  try {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(px));
  } catch {
    // Persistence is best-effort — quota / privacy modes are ignored.
  }
}

// The sidebar width lives in a module store read through useSyncExternalStore: the
// server (and the hydrating render) see the default, so the inline width can't mismatch,
// and the stored width is read lazily on the client's first snapshot — no restore effect,
// no ref mirror. Drag moves write here without saving; saves happen on release / commit.
let sidebarWidthValue: number | null = null;
const sidebarWidthListeners = new Set<() => void>();

function getSidebarWidth(): number {
  sidebarWidthValue ??= loadSidebarWidth();
  return sidebarWidthValue;
}

function subscribeSidebarWidth(listener: () => void): () => void {
  sidebarWidthListeners.add(listener);
  return () => {
    sidebarWidthListeners.delete(listener);
  };
}

function setSidebarWidth(px: number): void {
  if (px === sidebarWidthValue) return;
  sidebarWidthValue = px;
  for (const listener of sidebarWidthListeners) listener();
}

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
 * Whether the desktop sidebar column is on screen (not the narrow-viewport drawer,
 * and not collapsed). Pages use this to avoid duplicating the armory card that's
 * pinned at the bottom of the sidebar.
 */
export function useSidebarVisible(): boolean {
  const desktop = useMinWidth(SIDEBAR_BREAKPOINT_PX);
  const collapsed = useSyncExternalStore(
    subscribeSidebarCollapsed,
    getSidebarCollapsed,
    () => false,
  );
  return desktop && !collapsed;
}

/**
 * App frame (Figma 1:2): a resizable sidebar — title, view switch, saved loadouts,
 * armor summary — beside the active view, which scrolls on its own. On narrow
 * viewports the sidebar becomes a left drawer behind a top bar.
 *
 * The desktop column and the narrow-viewport drawer never both mount the loadouts
 * list, so its share-link import dialog can't exist twice at once.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const desktop = useMinWidth(SIDEBAR_BREAKPOINT_PX);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const sidebarWidth = useSyncExternalStore(
    subscribeSidebarWidth,
    getSidebarWidth,
    () => SIDEBAR_DEFAULT_PX,
  );
  const collapsed = useSyncExternalStore(
    subscribeSidebarCollapsed,
    getSidebarCollapsed,
    () => false,
  );
  const [resizing, setResizing] = useState(false);
  // Transitions stay off until after the stored collapsed/width snapshot has painted,
  // so a refresh doesn't replay the slide. Resize drags stay un-tweened.
  const [slideEnabled, setSlideEnabled] = useState(false);
  useEffect(() => {
    setSlideEnabled(true);
  }, []);
  const desktopSidebarOpen = desktop && !collapsed;
  const slideTransition =
    slideEnabled && !resizing
      ? "duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
      : null;

  // A share link (?import=) is handled by the loadouts list, which on narrow viewports
  // only exists inside the drawer — open it so the import dialog can appear. Deferred
  // a frame so the closed drawer paints first and its open transition can run. On
  // desktop a collapsed sidebar is the same situation: expand it so the list mounts.
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has(SHARE_PARAM)) {
      return;
    }
    if (window.matchMedia(`(min-width: ${SIDEBAR_BREAKPOINT_PX}px)`).matches) {
      setSidebarCollapsed(false);
      return;
    }
    const frame = requestAnimationFrame(() => setDrawerOpen(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  // Portaled surfaces (the loadout editor drawer) sit beside the sidebar, not over
  // it: publish its live width where anything under <html> can read it.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty(
      "--app-sidebar-width",
      `${desktopSidebarOpen ? sidebarWidth : 0}px`,
    );
    return () => {
      root.style.removeProperty("--app-sidebar-width");
    };
  }, [desktopSidebarOpen, sidebarWidth]);

  useEffect(() => {
    if (!resizing) return;
    const { cursor, userSelect } = document.body.style;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = cursor;
      document.body.style.userSelect = userSelect;
    };
  }, [resizing]);

  const commitWidth = useCallback((px: number | ((current: number) => number)) => {
    const next = clampSidebarWidth(
      typeof px === "function" ? px(getSidebarWidth()) : px,
    );
    setSidebarWidth(next);
    saveSidebarWidth(next);
  }, []);

  const onResizePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setResizing(true);
    setSidebarWidth(clampSidebarWidth(e.clientX));

    const onMove = (ev: globalThis.PointerEvent) => {
      setSidebarWidth(clampSidebarWidth(ev.clientX));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      setResizing(false);
      saveSidebarWidth(getSidebarWidth());
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const onResizeKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 32 : 8;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      commitWidth((w) => w - step);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      commitWidth((w) => w + step);
    } else if (e.key === "Home") {
      e.preventDefault();
      commitWidth(SIDEBAR_MIN_PX);
    } else if (e.key === "End") {
      e.preventDefault();
      commitWidth(SIDEBAR_MAX_PX);
    }
  };

  return (
    <div className="relative flex h-full w-full">
      <aside
        className={cn(
          "relative hidden h-full min-w-0 shrink-0 overflow-hidden lg:block",
          slideTransition && `transition-[width] ${slideTransition}`,
          collapsed && "pointer-events-none",
        )}
        style={{ width: collapsed ? 0 : sidebarWidth }}
        aria-hidden={collapsed}
        inert={collapsed}
      >
        <div
          className={cn(
            "bg-sidebar border-border relative flex h-full min-h-0 flex-col border-r",
            slideTransition && `transition-transform ${slideTransition}`,
          )}
          style={{
            width: sidebarWidth,
            transform: collapsed ? "translateX(-100%)" : "translateX(0)",
          }}
        >
          {desktop && <AppSidebar chrome={false} />}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            aria-valuemin={SIDEBAR_MIN_PX}
            aria-valuemax={SIDEBAR_MAX_PX}
            aria-valuenow={sidebarWidth}
            tabIndex={collapsed ? -1 : 0}
            onPointerDown={onResizePointerDown}
            onDoubleClick={() => commitWidth(SIDEBAR_DEFAULT_PX)}
            onKeyDown={onResizeKeyDown}
            className={cn(
              "absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none outline-none",
              "after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:rounded-full after:transition-colors",
              "after:bg-transparent hover:after:bg-foreground/40 focus-visible:after:bg-foreground",
              resizing && "after:bg-foreground",
            )}
          />
        </div>
      </aside>

      {/* Stays put while the panel slides away: same icon, same title, same spot. */}
      <div
        className={cn(
          "absolute top-0 left-0 z-20 hidden lg:block",
          collapsed && "bg-background",
        )}
        style={{ width: collapsed ? undefined : sidebarWidth }}
      >
        <SidebarChrome
          collapsed={collapsed}
          onToggle={() => setSidebarCollapsed(!collapsed)}
        />
      </div>

      {!desktop && (
        <Drawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          swipeDirection="left"
        >
          <DrawerContent aria-label="Loadouts" className="bg-sidebar">
            <div className="flex shrink-0 justify-end px-2 pt-2">
              <TooltipLabel label="Close loadouts">
                <DrawerClose
                  aria-label="Close loadouts"
                  render={<Button variant="ghost" size="icon-sm" />}
                >
                  <XIcon />
                </DrawerClose>
              </TooltipLabel>
            </div>
            <AppSidebar onNavigate={() => setDrawerOpen(false)} />
          </DrawerContent>
        </Drawer>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-border bg-sidebar flex h-14 shrink-0 items-center gap-3 border-b px-3 lg:hidden">
          <TooltipLabel label="Open loadouts">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Open loadouts"
              onClick={() => setDrawerOpen(true)}
            >
              <List weight="bold" aria-hidden />
            </Button>
          </TooltipLabel>
          <span className="flex-1 text-sm font-medium">D2 stat builder</span>
          <ViewTabs />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
