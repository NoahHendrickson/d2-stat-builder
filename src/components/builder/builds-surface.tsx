"use client";

import { useEffect, useState } from "react";

import {
  BuildsColumnContent,
  type BuildsColumnContentProps,
} from "@/components/builder/builds-column-content";
import { BuildsMobileBar } from "@/components/builder/builds-mobile-bar";
import { Drawer, DrawerContent } from "@/components/ui/drawer";

const DESKTOP_BUILDS_MIN_PX = 1024;

function useMinWidth(minWidth: number) {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${minWidth}px)`);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [minWidth]);

  return matches;
}

/** Places the builds column inline on desktop or in a mobile bottom sheet. */
export function BuildsSurface(props: BuildsColumnContentProps) {
  const desktop = useMinWidth(DESKTOP_BUILDS_MIN_PX);
  const [sheetOpen, setSheetOpen] = useState(false);
  const { ready, showLoading, running, result, displayedProgress } = props;

  if (desktop) {
    return (
      <div className="space-y-3">
        <BuildsColumnContent {...props} />
      </div>
    );
  }

  if (!ready) return null;

  return (
    <>
      <BuildsMobileBar
        ready={ready}
        showLoading={showLoading}
        running={running}
        result={result}
        displayedProgress={displayedProgress}
        open={sheetOpen}
        onOpen={() => setSheetOpen(true)}
      />
      <Drawer
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        swipeDirection="down"
        showSwipeHandle
      >
        <DrawerContent id="builds-mobile-sheet">
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <BuildsColumnContent {...props} />
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}
