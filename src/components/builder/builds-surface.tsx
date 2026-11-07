"use client";

import { memo, useMemo, useRef, useState } from "react";

import {
  BuildsColumnContent,
  buildsHeader,
  type BuildsColumnContentProps,
} from "@/components/builder/builds-column-content";
import { BuildsMobileBar } from "@/components/builder/builds-mobile-bar";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { useMinWidth } from "@/lib/use-min-width";

const DESKTOP_BUILDS_MIN_PX = 1024;

/** Places the builds column inline on desktop or in a mobile bottom sheet. */
export const BuildsSurface = memo(function BuildsSurface(props: BuildsColumnContentProps) {
  const desktop = useMinWidth(DESKTOP_BUILDS_MIN_PX);
  const [sheetOpen, setSheetOpen] = useState(false);
  const { ready, displayedProgress, poolGap } = props;
  // The pool-gap button points at settings behind the sheet: close it, then scroll
  // once it has gone (the open sheet holds the page still).
  const afterClose = useRef<(() => void) | null>(null);
  const sheetPoolGap = useMemo(
    () =>
      poolGap && {
        ...poolGap,
        onShowSettings: () => {
          afterClose.current = poolGap.onShowSettings;
          setSheetOpen(false);
        },
      },
    [poolGap],
  );

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
        header={buildsHeader(props)}
        displayedProgress={displayedProgress}
        open={sheetOpen}
        onOpen={() => setSheetOpen(true)}
      />
      <Drawer
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onOpenChangeComplete={(open) => {
          if (open) return;
          afterClose.current?.();
          afterClose.current = null;
        }}
        swipeDirection="down"
        showSwipeHandle
      >
        <DrawerContent id="builds-mobile-sheet">
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <BuildsColumnContent {...props} poolGap={sheetPoolGap} />
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
});
