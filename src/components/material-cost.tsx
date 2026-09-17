"use client";

import { MATERIAL_LABELS, type MaterialStack } from "@/lib/armory/masterwork";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import type { Manifest } from "@/lib/manifest/load";
import { cn } from "@/lib/utils";

/** "35k" for compact chips, "35,000" otherwise. */
function formatCount(count: number, compact: boolean): string {
  if (compact && count >= 1000) {
    const k = count / 1000;
    return `${k >= 10 ? Math.round(k) : Math.round(k * 10) / 10}k`;
  }
  return count.toLocaleString();
}

/** "70,000 Glimmer · 60 Enhancement Core" — for tooltips. */
export function materialSummary(
  stacks: readonly MaterialStack[],
  manifest?: Manifest,
): string {
  return stacks
    .map(({ itemHash, count }) => {
      const def = manifest?.def("DestinyInventoryItemDefinition", itemHash);
      const name =
        def?.displayProperties?.name || MATERIAL_LABELS[itemHash] || `Item ${itemHash}`;
      return `${count.toLocaleString()} ${name}`;
    })
    .join(" · ");
}

/**
 * A row of material icons with counts — "◇ 35,000  ● 30  ◆ 13  ▲ 3". Icons come
 * from the manifest item table; without a definition the material's name stands in.
 */
export function MaterialCost({
  stacks,
  manifest,
  compact = false,
  className,
}: {
  stacks: readonly MaterialStack[];
  manifest?: Manifest;
  /** Abbreviate thousands and tighten spacing for collapsed card headers. */
  compact?: boolean;
  className?: string;
}) {
  if (stacks.length === 0) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center tabular-nums",
        compact ? "gap-1.5" : "gap-2.5",
        className,
      )}
    >
      {stacks.map(({ itemHash, count }) => {
        const def = manifest?.def("DestinyInventoryItemDefinition", itemHash);
        const name =
          def?.displayProperties?.name ||
          MATERIAL_LABELS[itemHash] ||
          `Item ${itemHash}`;
        const icon = def?.displayProperties?.icon;
        return (
          <span
            key={itemHash}
            title={`${count.toLocaleString()} ${name}`}
            className="inline-flex items-center gap-1 whitespace-nowrap"
          >
            {icon ? (
              // Tiny Bungie glyphs: skip next/image, same as StatGlyph.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`${BUNGIE_IMAGE_BASE}${icon}`}
                alt={name}
                width={16}
                height={16}
                decoding="async"
                className="inline-block size-4 shrink-0 rounded-[2px]"
              />
            ) : (
              <span className="text-[10px] uppercase">{name}</span>
            )}
            {formatCount(count, compact)}
          </span>
        );
      })}
    </span>
  );
}
