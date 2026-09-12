"use client";

import { useEffect, useSyncExternalStore } from "react";
import Image from "next/image";
import { Check, CircleNotch, X } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { TooltipLabel } from "@/components/ui/tooltip";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import {
  dismissApplyProgress,
  getApplyProgress,
  subscribeApplyProgress,
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
          : "waiting";
  const label = [step.name, state].join(" · ");
  return (
    <TooltipLabel label={label}>
      <span
        role="listitem"
        aria-label={label}
        className={cn(
          "relative flex aspect-square w-full min-w-0 items-center justify-center border border-input leading-none",
          step.status === "pending" && "opacity-40",
          step.status === "active" && "border-emphatic",
          step.status === "ok" && "border-emerald-500",
          step.status === "fail" && "border-destructive",
        )}
      >
        {step.icon ? (
          <Image
            src={`${BUNGIE_IMAGE_BASE}${step.icon}`}
            alt=""
            width={32}
            height={32}
            className="size-full rounded-none"
            unoptimized
          />
        ) : (
          <span className="bg-muted block size-full" aria-hidden />
        )}
        {step.watermark && (
          <Image
            src={`${BUNGIE_IMAGE_BASE}${step.watermark}`}
            alt=""
            width={32}
            height={32}
            className="absolute inset-0 size-full rounded-none"
            unoptimized
          />
        )}
        {step.status === "active" && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/40">
            <CircleNotch className="size-3 animate-spin text-white" aria-hidden />
          </span>
        )}
        {step.status === "ok" && (
          <span className="absolute -top-0.5 -right-1 flex size-3 items-center justify-center rounded-full bg-emerald-500 text-white">
            <Check weight="bold" className="size-2" aria-hidden />
          </span>
        )}
        {step.status === "fail" && (
          <span className="bg-destructive absolute -top-0.5 -right-1 flex size-3 items-center justify-center rounded-full text-white">
            <X weight="bold" className="size-2" aria-hidden />
          </span>
        )}
      </span>
    </TooltipLabel>
  );
}

function titleFor(name: string, finished: "ok" | "partial" | "fail" | undefined) {
  if (finished === "ok") return `${name} applied`;
  if (finished === "partial") return `Partially applied ${name}`;
  if (finished === "fail") return `Couldn't apply ${name}`;
  return `Applying ${name}`;
}

/** Apply-loadout progress card for the sidebar footer — hidden when idle. */
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
      className="mx-2 mb-2 flex shrink-0 flex-col gap-2 rounded-2xl border bg-popover p-3 text-popover-foreground shadow-lg"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium">{title}</h2>
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
          <X aria-hidden />
        </Button>
      </div>
      <div role="list" className="grid grid-cols-[repeat(auto-fill,minmax(2rem,1fr))] gap-1.5">
        {state.steps.map((step) => (
          <Cell key={step.id} step={step} />
        ))}
      </div>
      {state.finished && state.skipped.length > 0 && (
        <p className="text-muted-foreground text-xs">{state.skipped.join(" · ")}</p>
      )}
    </div>
  );
}
