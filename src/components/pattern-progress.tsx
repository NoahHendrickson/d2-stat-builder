"use client";

import { CraftGlyphIcon } from "@/components/armor-thumb";
import { CRAFT_BAR } from "@/components/craft-glyph-paths";
import { isPatternComplete, patternFor } from "@/lib/bungie/patterns";
import { usePatterns } from "@/lib/bungie/use-patterns";
import { cn } from "@/lib/utils";

/**
 * How many of a craftable weapon's patterns the player has extracted, as red segments
 * (one per pattern it needs) in the crafted glyph's colours and glow. `stacked` puts the
 * segments under the label (the Items panel); `inline` keeps one line (a section header).
 * Nothing until it loads, when signed out, or if it can't.
 */
export function PatternProgress({
  name,
  layout,
  className,
}: {
  /** The weapon's exact name, which is how Bungie's pattern records are keyed. */
  name: string;
  layout: "stacked" | "inline";
  className?: string;
}) {
  const pattern = patternFor(usePatterns().data, name);
  if (!pattern) return null;
  const { progress, needed } = pattern;
  const label = isPatternComplete(pattern) ? "Unlocked" : `${progress} of ${needed}`;
  const inline = layout === "inline";
  return (
    <div className={cn("flex text-[11px]", inline ? "items-center gap-2.5" : "flex-col gap-1.5", className)}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground flex items-center gap-1.5">
          <CraftGlyphIcon className="size-3.5 shrink-0" />
          Pattern
        </span>
        {!inline && <span className="tabular-nums">{label}</span>}
      </div>
      <div
        role="meter"
        aria-label="Pattern progress"
        aria-valuemin={0}
        aria-valuemax={needed}
        aria-valuenow={progress}
        aria-valuetext={label}
        className={cn("flex gap-0.5", inline && "w-24")}
      >
        {Array.from({ length: needed }, (_, i) => (
          <span key={i} className={cn("h-1.5 flex-1", i < progress ? CRAFT_BAR : "bg-foreground/10")} />
        ))}
      </div>
      {inline && <span className="tabular-nums">{label}</span>}
    </div>
  );
}
