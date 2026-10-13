"use client";

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, InformationCircleIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { TooltipLabel } from "@/components/ui/tooltip";

const SEEN_KEY = "stat-builder:theory-intro-seen";

function seen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Best-effort: in a privacy mode it just shows again next visit.
  }
}

/**
 * When to use Theoretical builds (an example in the author's words), above their list
 * until dismissed (once per browser).
 * Only mounted on the client once the gear is in, so reading storage up front is safe.
 */
export function TheoryIntroAlert() {
  const [open, setOpen] = useState(() => !seen());
  if (!open) return null;
  return (
    <div
      className="d2-reveal flex items-start gap-2.5 rounded-md border border-amber-500/60 bg-amber-500/15 px-3 py-2.5"
      role="note"
    >
      <HugeiconsIcon
        icon={InformationCircleIcon}
        className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400"
        aria-hidden
      />
      <div className="text-foreground/90 flex min-w-0 flex-1 flex-col gap-1 text-sm">
        <p className="text-foreground font-medium">When should I use this?</p>
        <p>
          I wanted to farm Pit of Heresy armor for a Solar Warlock Winter&apos;s Guile build. I
          had 0 pieces and I wanted to know what archetypes I should farm for. I input the stats
          I wanted and it showed me what archetypes to get.
        </p>
        <p>
          If you have a decent amount of the pieces of the armor, I suggest making a real build
          and then using the Dream build feature.
        </p>
      </div>
      <TooltipLabel label="Dismiss">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Dismiss"
          onClick={() => {
            markSeen();
            setOpen(false);
          }}
          className="text-muted-foreground hover:text-foreground shrink-0"
        >
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-3.5" aria-hidden />
        </Button>
      </TooltipLabel>
    </div>
  );
}
