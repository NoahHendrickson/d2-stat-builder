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
import { AppSidebar } from "@/components/app-sidebar";
import { AppHeader } from "@/components/app-header";
import { ArmoryDiagnosticsGate } from "@/components/armory/armory-diagnostics-gate";
import { ApplyProgressSection } from "@/components/loadouts/apply-progress-card";
import { ViewTabs } from "@/components/view-tabs";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerClose, DrawerContent } from "@/components/ui/drawer";
import { ThemeToggle } from "@/components/theme-toggle";
import { SHARE_PARAM } from "@/lib/loadouts/share";
import { useMinWidth } from "@/lib/use-min-width";
import { cn } from "@/lib/utils";

/** Tailwind `lg` — below it the sidebar collapses into a drawer. */
export const SIDEBAR_BREAKPOINT_PX = 1024;
/** Figma 1:2 sidebar width — also the reset target. */
const SIDEBAR_DEFAULT_PX = 340;
const SIDEBAR_MIN_PX = 260;
const SIDEBAR_MAX_PX = 560;
/** Hit-area width (`w-4`). Offset centers it on the column edge (`after:left-1`). */
const SIDEBAR_RESIZE_HIT_PX = 16;
const SIDEBAR_RESIZE_OFFSET_PX = 4;
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
 * Whether the viewport is at the desktop sidebar breakpoint. Pages use this to
 * skip inline status cards — the header toolbar already shows them on desktop.
 */
export function useDesktopLayout(): boolean {
  return useMinWidth(SIDEBAR_BREAKPOINT_PX);
}

/**
 * App frame: a resizable loadouts sidebar beside the active view. Logo, view
 * tabs, and account/status live in the main-column header; the page fills the
 * rest. On narrow viewports the sidebar becomes a left drawer behind a top bar.
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
  // so a refresh doesn't replay the slide. Resize drags stay un-tweened. Client snapshot
  // is true; the hydrating render matches the server (false), then React re-renders.
  const slideEnabled = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
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

  // Portaled surfaces (the loadout editor drawer) sit over the main column,
  // not the sidebar. Publish the open width so anything under <html> can inset.
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
            "d2-sidebar relative flex h-full min-h-0 flex-col",
            slideTransition && `transition-transform ${slideTransition}`,
          )}
          style={{
            width: sidebarWidth,
            transform: collapsed ? "translateX(-100%)" : "translateX(0)",
          }}
        >
          {desktop && (
            <AppSidebar
              onToggle={() => setSidebarCollapsed(true)}
            />
          )}
        </div>
      </aside>

      {/* Lives outside the clipped sidebar column so the full hit area straddles
          the edge; the column's overflow-hidden would otherwise cut it down. */}
      {desktopSidebarOpen && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          aria-valuemin={SIDEBAR_MIN_PX}
          aria-valuemax={SIDEBAR_MAX_PX}
          aria-valuenow={sidebarWidth}
          tabIndex={0}
          onPointerDown={onResizePointerDown}
          onDoubleClick={() => commitWidth(SIDEBAR_DEFAULT_PX)}
          onKeyDown={onResizeKeyDown}
          style={{
            left: sidebarWidth - SIDEBAR_RESIZE_OFFSET_PX,
            width: SIDEBAR_RESIZE_HIT_PX,
          }}
          className={cn(
            "absolute inset-y-0 z-10 cursor-col-resize touch-none outline-none",
            "after:absolute after:inset-y-3 after:left-1 after:w-px after:-translate-x-1/2 after:transition-colors",
            "after:bg-transparent hover:after:bg-foreground/40 focus-visible:after:bg-foreground",
            resizing && "after:bg-foreground",
          )}
        />
      )}

      <div className="d2-sidebar flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-stretch gap-2 border-b border-foreground/8 pr-2 pl-1 lg:hidden">
          <div className="flex items-center">
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
          </div>
          <span className="hidden min-w-0 flex-1 items-center truncate text-sm font-medium min-[420px]:flex">
            D2 stat builder
          </span>
          <div className="ml-auto flex items-center">
            <ViewTabs />
          </div>
          <div className="flex items-center">
            <ThemeToggle />
          </div>
        </header>
        {desktop && (
          <AppHeader
            collapsed={collapsed}
            onExpand={() => setSidebarCollapsed(false)}
          />
        )}
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
          <DrawerContent aria-label="Loadouts" className="d2-sidebar">
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
            <AppSidebar
              onNavigate={() => setDrawerOpen(false)}
              showAccount
            />
          </DrawerContent>
        </Drawer>
      )}
    </div>
  );
}
