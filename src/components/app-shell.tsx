"use client";

import { TooltipLabel } from "@/components/ui/tooltip";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { List } from "@phosphor-icons/react";
import { AppSidebar } from "@/components/app-sidebar";
import { ViewTabs } from "@/components/view-tabs";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { useMinWidth } from "@/lib/use-min-width";
import { cn } from "@/lib/utils";

/** Tailwind `lg` — below it the sidebar collapses into a drawer. */
const SIDEBAR_BREAKPOINT_PX = 1024;
/** Figma 1:2 sidebar width — also the reset target. */
const SIDEBAR_DEFAULT_PX = 340;
const SIDEBAR_MIN_PX = 260;
const SIDEBAR_MAX_PX = 560;
const SIDEBAR_WIDTH_KEY = "stat-builder:sidebar-width";

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

/**
 * App frame (Figma 1:2): a resizable sidebar — title, view switch, saved loadouts,
 * armor summary — beside the active view, which scrolls on its own. On narrow
 * viewports the sidebar becomes a left drawer behind a top bar.
 *
 * The sidebar's content is mounted only where it's visible so the loadouts list (and
 * its share-link import dialog) never exists twice at once.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const desktop = useMinWidth(SIDEBAR_BREAKPOINT_PX);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_PX);
  const [resizing, setResizing] = useState(false);
  const sidebarWidthRef = useRef(sidebarWidth);
  sidebarWidthRef.current = sidebarWidth;

  useEffect(() => {
    setSidebarWidth(loadSidebarWidth());
  }, []);

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
    setSidebarWidth((current) => {
      const next = clampSidebarWidth(
        typeof px === "function" ? px(current) : px,
      );
      saveSidebarWidth(next);
      return next;
    });
  }, []);

  const onResizePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setResizing(true);
    const next = clampSidebarWidth(e.clientX);
    sidebarWidthRef.current = next;
    setSidebarWidth(next);

    const onMove = (ev: globalThis.PointerEvent) => {
      const live = clampSidebarWidth(ev.clientX);
      sidebarWidthRef.current = live;
      setSidebarWidth(live);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      setResizing(false);
      saveSidebarWidth(sidebarWidthRef.current);
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
    <div className="flex h-full w-full">
      <aside
        className="bg-sidebar border-border relative hidden shrink-0 flex-col border-r lg:flex"
        style={{ width: sidebarWidth }}
      >
        {desktop && <AppSidebar />}
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
          className={cn(
            "absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none outline-none",
            "after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:rounded-full after:transition-colors",
            "after:bg-transparent hover:after:bg-foreground/40 focus-visible:after:bg-foreground",
            resizing && "after:bg-foreground",
          )}
        />
      </aside>

      {!desktop && (
        <Drawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          swipeDirection="left"
        >
          <DrawerContent aria-label="Loadouts" className="bg-sidebar">
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
