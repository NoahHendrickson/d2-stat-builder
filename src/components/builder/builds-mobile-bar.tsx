"use client";

import { CaretUp } from "@phosphor-icons/react";

import {
  getBuildsStatusLabel,
  getBuildsViewState,
} from "@/components/builder/builds-column-content";
import type { OptimizerOutput } from "@/lib/optimizer/types";
import { useStoreValue, type ValueStore } from "@/lib/value-store";
import { cn } from "@/lib/utils";

export interface BuildsMobileBarProps {
  ready: boolean;
  showLoading: boolean;
  running: boolean;
  result: OptimizerOutput | null;
  displayedProgress: ValueStore<number>;
  open: boolean;
  onOpen: () => void;
}

/**
 * The bar's fill. Subscribes to the per-frame progress store here so the smoother's
 * 60 Hz writes re-render only this element, not the whole bar; the width is set
 * directly (the smoother already eases it — a CSS transition on top restarts every
 * frame and lags behind).
 */
function ProgressFill({ store, className }: { store: ValueStore<number>; className: string }) {
  const progress = useStoreValue(store);
  return (
    <div
      role="progressbar"
      aria-label="Search progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      className={className}
    >
      <div className="bg-foreground h-full rounded-none" style={{ width: `${progress * 100}%` }} />
    </div>
  );
}

export function BuildsMobileBar({
  ready,
  showLoading,
  running,
  result,
  displayedProgress: progressStore,
  open,
  onOpen,
}: BuildsMobileBarProps) {
  if (!ready) return null;

  const state = getBuildsViewState({ ready, showLoading, result });
  const statusLabel = getBuildsStatusLabel({ ready, showLoading, result });

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 lg:hidden">
      <button
        type="button"
        onClick={onOpen}
        aria-expanded={open}
        aria-controls="builds-mobile-sheet"
        className={cn(
          "border-foreground/15 bg-background/95 pointer-events-auto relative flex w-full flex-col gap-2 border-t px-4 py-3 text-left transition-colors",
          "pb-[calc(0.75rem+env(safe-area-inset-bottom))] hover:bg-muted/40 active:bg-muted/60",
          "fine-pointer:border-t-2 fine-pointer:px-5 fine-pointer:py-4",
          state === "results"
            ? "fine-pointer:border-foreground/70"
            : state === "searching"
              ? "fine-pointer:border-transparent"
              : "fine-pointer:border-foreground/25",
        )}
      >
        {state === "searching" && (
          <ProgressFill
            store={progressStore}
            className="bg-black/30 absolute inset-x-0 top-0 hidden h-[2px] overflow-hidden fine-pointer:block"
          />
        )}
        {state === "searching" && (
          <ProgressFill
            store={progressStore}
            className="bg-black/30 h-0.5 w-full overflow-hidden rounded-none fine-pointer:hidden"
          />
        )}
        <span className="flex items-center gap-3">
          <span className="min-w-0 flex-1">
            <span className="fine-pointer:text-base block text-sm font-medium fine-pointer:font-semibold">
              Builds
            </span>
            <span className="text-muted-foreground block truncate text-xs">
              {statusLabel}
            </span>
          </span>
          {running && state === "searching" && (
            <span className="text-muted-foreground shrink-0 text-xs">Running</span>
          )}
          <CaretUp
            weight="duotone"
            className={cn(
              "text-muted-foreground size-4 shrink-0 transition-transform fine-pointer:size-5",
              open && "rotate-180",
            )}
            aria-hidden
          />
        </span>
      </button>
    </div>
  );
}
