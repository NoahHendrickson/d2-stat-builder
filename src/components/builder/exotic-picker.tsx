"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import { Button } from "@/components/ui/button";

export interface ExoticOption {
  name: string;
  /** All item hashes for this exotic (same exotic can exist as Armor 2.0 + 3.0). */
  hashes: number[];
  /** Relative Bungie icon path, if any. */
  icon?: string;
}

/**
 * Figma 127:9 — outer frame carries border + lip fill (pb-1); inner span is the face.
 * Selected ring/glow wraps the full frame including the lip band.
 */
const tileBase =
  "group/tile relative w-10 shrink-0 rounded-[6px] border border-[var(--exotic-line)] bg-[var(--exotic-lip)] pb-0.5 outline-none transition-all active:translate-y-0.5 active:pb-px focus-visible:ring-3 focus-visible:ring-ring/50";

const tileSelected =
  "shadow-[0_0_0_1px_var(--exotic-ring-outer),0_0_12px_3px_var(--exotic-ring-glow)]";

/**
 * Thumbnail grid for choosing which exotic to build around. Click a tile to require
 * that exotic, click it again to clear. Nothing selected = the optimizer decides.
 */
export function ExoticPicker({
  options,
  selected,
  onSelect,
}: {
  options: ExoticOption[];
  selected: number | null;
  onSelect: (index: number | null) => void;
}) {
  if (options.length === 0) {
    return (
      <p className="text-muted-foreground text-xs">
        No exotic armor found for this class.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-x-2.5 gap-y-3 p-0.5">
        {options.map((exotic, index) => {
          const active = selected === index;
          return (
            <button
              key={exotic.name}
              type="button"
              title={exotic.name}
              aria-label={exotic.name}
              aria-pressed={active}
              onClick={() => onSelect(active ? null : index)}
              className={cn(tileBase, active && tileSelected)}
            >
              {/* -mx/-mt-px overlaps the face border onto the frame border so they read as one line */}
              <span className="relative -mx-px -mt-px block aspect-square overflow-hidden rounded-[6px] border border-[var(--exotic-line)]">
                {exotic.icon ? (
                  <Image
                    src={`${BUNGIE_IMAGE_BASE}${exotic.icon}`}
                    alt={exotic.name}
                    fill
                    sizes="40px"
                    className="object-cover"
                    unoptimized
                  />
                ) : (
                  <span className="bg-card text-muted-foreground flex size-full items-center justify-center text-xs">
                    {exotic.name.slice(0, 2)}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      {selected !== null && (
        <p className="text-muted-foreground text-xs">
          Requiring{" "}
          <span className="text-foreground">{options[selected]?.name}</span>.{" "}
          <Button
            variant="link"
            className="h-auto p-0 text-xs font-normal text-inherit underline"
            onClick={() => onSelect(null)}
          >
            Clear
          </Button>
        </p>
      )}
    </div>
  );
}
