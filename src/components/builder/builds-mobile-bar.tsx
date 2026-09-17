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

export function BuildsMobileBar({
  ready,
  showLoading,
  running,
  result,
  displayedProgress: progressStore,
  open,
  onOpen,
}: BuildsMobileBarProps) {
  const displayedProgress = useStoreValue(progressStore);
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
          "border-border/60 bg-background/95 supports-[backdrop-filter]:bg-background/80 d2:border-foreground/15 d2:supports-[backdrop-filter]:bg-panel-strong pointer-events-auto relative flex w-full flex-col gap-2 border-t px-4 py-3 text-left backdrop-blur transition-colors",
          "pb-[calc(0.75rem+env(safe-area-inset-bottom))] hover:bg-muted/40 active:bg-muted/60",
          "fine-pointer:border-t-2 fine-pointer:px-5 fine-pointer:py-4",
          state === "results"
            ? "fine-pointer:border-brand d2:fine-pointer:border-foreground/70"
            : state === "searching"
              ? "fine-pointer:border-transparent"
              : "fine-pointer:border-border/60 d2:fine-pointer:border-foreground/25",
        )}
      >
        {state === "searching" && (
          <div
            role="progressbar"
            aria-label="Search progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(displayedProgress * 100)}
            className="bg-muted d2:bg-black/30 absolute inset-x-0 top-0 hidden h-[2px] overflow-hidden fine-pointer:block"
          >
            <div
              className="bg-brand d2:bg-foreground h-full transition-[width] duration-150"
              style={{ width: `${displayedProgress * 100}%` }}
            />
          </div>
        )}
        {state === "searching" && (
          <div
            role="progressbar"
            aria-label="Search progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(displayedProgress * 100)}
            className="bg-muted h-0.5 w-full overflow-hidden rounded-full d2:rounded-none d2:bg-black/30 fine-pointer:hidden"
          >
            <div
              className="bg-primary h-full rounded-full d2:rounded-none d2:bg-foreground transition-[width] duration-150"
              style={{ width: `${displayedProgress * 100}%` }}
            />
          </div>
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
