"use client";

import { useEffect, useSyncExternalStore } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, Loading03Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { TooltipLabel } from "@/components/ui/tooltip";
import { ArmorThumb } from "@/components/armor-thumb";
import { toast } from "@/lib/toast";
import {
  cancelApplyProgress,
  dismissApplyProgress,
  getApplyProgress,
  subscribeApplyProgress,
  type ApplyProgressState,
  type ApplyStep,
} from "@/lib/loadouts/apply-progress";
import { cn } from "@/lib/utils";

const SUCCESS_DISMISS_MS = 2800;

function Cell({ step }: { step: ApplyStep }) {
  const state =
    step.status === "ok"
      ? step.message
        ? `applied · ${step.message}`
        : "applied"
      : step.status === "fail"
        ? step.message ?? "failed"
        : step.status === "active"
          ? "applying"
          : step.status === "skipped"
            ? "cancelled"
            : "waiting";
  const label = [step.name, state].join(" · ");
  return (
    <TooltipLabel label={label}>
      <span
        role="listitem"
        aria-label={label}
        className={cn(
          "relative flex aspect-square w-full min-w-0 items-center justify-center border border-input leading-none",
          (step.status === "pending" || step.status === "skipped") && "opacity-40",
          step.status === "active" && "border-foreground d2-tile-selected",
          step.status === "ok" && "border-positive",
          step.status === "fail" && "border-destructive",
        )}
      >
        {step.icon ? (
          <ArmorThumb
            icon={step.icon}
            watermark={step.watermark}
            size={32}
            masterworked={step.masterworked}
            gearTier={step.gearTier}
            className="size-full"
          />
        ) : (
          <span className="bg-muted block size-full" aria-hidden />
        )}
        {step.status === "active" && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/40">
            <HugeiconsIcon icon={Loading03Icon} className="size-3 animate-spin text-white" aria-hidden />
          </span>
        )}
        {step.status === "ok" && (
          <span className="absolute -top-0.5 -right-1 flex size-3 items-center justify-center rounded-none bg-positive text-black">
            <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} className="size-2" aria-hidden />
          </span>
        )}
        {step.status === "fail" && (
          <span className="bg-destructive absolute -top-0.5 -right-1 flex size-3 items-center justify-center rounded-none text-white">
            <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-2" aria-hidden />
          </span>
        )}
      </span>
    </TooltipLabel>
  );
}

function titleFor(name: string, finished: ApplyProgressState["finished"]) {
  if (finished === "ok") return `${name} applied`;
  if (finished === "cancelled") return `Stopped applying ${name}`;
  if (finished === "partial") return `Partially applied ${name}`;
  if (finished === "fail") return `Couldn't apply ${name}`;
  return `Applying ${name}`;
}

/** Apply-loadout progress — floats on the main column so it outlives a collapsed sidebar / closed drawer. */
export function ApplyProgressSection() {
  const state = useSyncExternalStore(subscribeApplyProgress, getApplyProgress, () => null);

  useEffect(() => {
    if (state?.finished !== "ok" || state.skipped.length > 0) return;
    const t = window.setTimeout(dismissApplyProgress, SUCCESS_DISMISS_MS);
    return () => window.clearTimeout(t);
  }, [state?.finished, state?.session]);

  if (!state || state.steps.length === 0) return null;

  const done = state.steps.filter((s) => s.status === "ok" || s.status === "fail").length;
  const title = titleFor(state.name, state.finished);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={title}
      // Pinned to the main column's top-left (its contain-layout is the containing
      // block), clear of the mobile header. A fixed 6-across grid keeps it square-ish.
      // On Slate the menu fill reads too blue for a card this big: same lift, less hue.
      className="d2-glass [.dark[data-app-theme=slate]_&]:[--glass-raised:rgb(68_76_92/92%)] animate-in fade-in-0 slide-in-from-top-2 absolute top-[4.25rem] left-3 z-40 flex w-60 flex-col gap-3 p-3 text-popover-foreground motion-reduce:animate-none lg:top-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium">{title}</h2>
          {state.batch && (
            <p className="text-muted-foreground truncate text-xs">{state.batch}</p>
          )}
          <p className="text-muted-foreground text-xs tabular-nums">
            {done}/{state.steps.length}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Dismiss"
          onClick={dismissApplyProgress}
        >
          <HugeiconsIcon icon={Cancel01Icon} aria-hidden />
        </Button>
      </div>
      <div role="list" className="grid grid-cols-6 gap-1.5">
        {state.steps.map((step) => (
          <Cell key={step.id} step={step} />
        ))}
      </div>
      {state.cancellable && !state.finished && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={state.cancelling}
          onClick={() =>
            cancelApplyProgress().catch(() => toast.error("Couldn't cancel — try again"))
          }
        >
          {state.cancelling && (
            <HugeiconsIcon icon={Loading03Icon} className="animate-spin" aria-hidden />
          )}
          {state.cancelling ? "Cancelling" : "Cancel"}
        </Button>
      )}
      {state.finished === "cancelled" && (
        <p className="text-muted-foreground text-xs">
          Steps that already ran stay applied. Dimmed ones never ran.
        </p>
      )}
      {state.finished && state.skipped.length > 0 && (
        <p className="text-muted-foreground text-xs">{state.skipped.join(" · ")}</p>
      )}
    </div>
  );
}
