"use client";

import { useRef, useState, type ReactNode } from "react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { ArrowDown01Icon, Loading03Icon } from "@hugeicons/core-free-icons";
import type { InGameLoadoutsResponse } from "@/lib/bungie/ingame-loadouts";
import { MAX_ACTIVITY_SET_NAME_LENGTH } from "@/lib/loadouts/activity-sets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TooltipLabel } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export const UNSAVED_DOT = (
  <span role="img" aria-label="Unsaved" className="bg-warning size-1.5 shrink-0 rounded-full" />
);

/**
 * One entry in the left column, in its own container. The open one holds its slot grid. A
 * closed one is clickable all over, so its hover ring goes around the container, and
 * `titleAction` and `actions` sit above that click area.
 */
export function SetCard({
  open,
  onClick,
  title,
  nameField,
  titleAction,
  trailing,
  actions,
  children,
}: {
  open: boolean;
  onClick: () => void;
  title: string;
  /** Replaces the whole row while the name is being typed. */
  nameField?: ReactNode;
  titleAction?: ReactNode;
  trailing?: ReactNode;
  actions?: ReactNode;
  /** The slot grid, shown while open. */
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "d2-card-frame group/set relative flex shrink-0 flex-col gap-2 p-1.5 transition-[background-color,outline-offset]",
        "has-[[data-set-toggle]:focus-visible]:ring-outline-strong has-[[data-set-toggle]:focus-visible]:ring-1",
        !open && !nameField && "d2-hover-ring hover:bg-[color-mix(in_srgb,var(--foreground)_5%,var(--lifted))]",
      )}
    >
      <div className="flex h-8 min-w-0 items-center gap-2 px-2 text-sm">
        {nameField ?? (
          <>
            <button
              type="button"
              aria-expanded={open}
              data-set-toggle
              onClick={onClick}
              className={cn(
                "min-w-0 text-left outline-none transition-colors",
                open
                  ? "text-foreground"
                  : "text-muted-foreground group-hover/set:text-foreground cursor-pointer after:absolute after:inset-0",
              )}
            >
              <span className="block truncate">{title}</span>
            </button>
            {titleAction && <div className="relative z-10 flex shrink-0">{titleAction}</div>}
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {trailing}
              {actions && <div className="relative z-10 flex">{actions}</div>}
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                strokeWidth={2}
                className={cn("text-muted-foreground size-3 shrink-0 transition-transform", open && "rotate-180")}
                aria-hidden
              />
            </div>
          </>
        )}
      </div>
      {open && <div className="px-2 pb-2">{children}</div>}
    </div>
  );
}

/** A small icon button in a set's row. */
export function SetRowAction({
  tooltip,
  label,
  icon,
  iconClassName,
  onClick,
  disabled,
}: {
  tooltip: string;
  label: string;
  icon: IconSvgElement;
  iconClassName?: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <TooltipLabel label={tooltip}>
      <Button
        variant="ghost"
        size="icon-sm"
        className="size-6 shrink-0"
        aria-label={label}
        onClick={onClick}
        disabled={disabled}
      >
        <HugeiconsIcon icon={icon} className={cn("size-3.5", iconClassName)} aria-hidden />
      </Button>
    </TooltipLabel>
  );
}

/** Renames a saved set where it's listed. Enter or clicking away keeps it; Escape doesn't. */
export function SetRenameInput({
  name,
  onDone,
}: {
  name: string;
  /** The new name, or null if it wasn't changed. */
  onDone: (name: string | null) => void;
}) {
  const [value, setValue] = useState(name);
  const cancelled = useRef(false);
  return (
    <Input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => onDone(cancelled.current ? null : value.trim() || null)}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== "Escape") return;
        cancelled.current = e.key === "Escape";
        e.currentTarget.blur();
      }}
      maxLength={MAX_ACTIVITY_SET_NAME_LENGTH}
      aria-label="Set name"
      autoFocus
      className="min-w-0 flex-1"
    />
  );
}

/** Stands in for the slots while they load, fail to, or don't exist. */
export function SlotsState({
  hasCharacter,
  data,
  error,
  isFetching,
  onRetry,
}: {
  hasCharacter: boolean;
  data: InGameLoadoutsResponse | undefined;
  error: Error | null;
  isFetching: boolean;
  onRetry: () => void;
}) {
  if (!hasCharacter) {
    return (
      <p className="text-muted-foreground text-sm">
        You don&apos;t have a character on this account yet.
      </p>
    );
  }
  if (data) {
    return (
      <p className="text-muted-foreground text-sm">
        This character has no in-game loadout slots unlocked yet.
      </p>
    );
  }
  if (error) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-destructive text-sm">{error.message}</p>
        <Button size="sm" onClick={onRetry} disabled={isFetching}>
          Try again
        </Button>
      </div>
    );
  }
  return (
    <p className="text-muted-foreground flex items-center gap-2 text-sm">
      <HugeiconsIcon icon={Loading03Icon} className="size-4 animate-spin" aria-hidden />
      Loading your in-game loadouts…
    </p>
  );
}
