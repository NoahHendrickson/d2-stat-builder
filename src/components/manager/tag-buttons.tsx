"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { TAG_LABELS, setTag, useAnnotation, type ItemTag } from "@/lib/inventory/annotations";
import { cn } from "@/lib/utils";
import { TAG_ICONS } from "./tag-icons";

/** The 32px square buttons under an item: its tags, and Compare beside them. */
export const TAG_BUTTON =
  "d2-hover-ring flex h-8 min-w-8 items-center justify-center border outline-none focus-visible:d2-tile-selected";

/** The tags offered; an item already tagged Infuse or Archive still shows that one. */
const PANEL_TAGS: readonly ItemTag[] = ["favorite", "keep", "junk"];

/**
 * DIM-style tag buttons, icon only (the active one is filled): one tag per item, click
 * the active one again to clear it. Renders `contents`, so the parent lays them out.
 */
export function TagButtons({ instanceId }: { instanceId: string }) {
  const tag = useAnnotation(instanceId)?.tag;
  const shown = tag && !PANEL_TAGS.includes(tag) ? [...PANEL_TAGS, tag] : PANEL_TAGS;
  return (
    <div className="contents" role="group" aria-label="Tag">
      {shown.map((t) => (
        <button
          key={t}
          type="button"
          title={TAG_LABELS[t]}
          aria-label={TAG_LABELS[t]}
          aria-pressed={tag === t}
          onClick={() => setTag([instanceId], tag === t ? undefined : t)}
          className={cn(
            TAG_BUTTON,
            "shrink-0",
            tag === t
              ? "border-transparent bg-foreground text-background"
              : "border-foreground/12 bg-foreground/4",
          )}
        >
          <HugeiconsIcon icon={TAG_ICONS[t]} className="size-3" aria-hidden />
        </button>
      ))}
    </div>
  );
}
