"use client";

import Image from "next/image";
import { TooltipLabel } from "@/components/ui/tooltip";
import { buildFragmentStats, formatFragmentStats, SUBCLASS_LINE, subclassFromPlug, type Subclass } from "@/lib/armory/fragments";
import { isStrandSharedAbilityIcon } from "@/lib/dim/subclasses";
import {
  STRAND_ABILITY_PLATE_FILTER,
  StrandAbilityRecolor,
} from "@/components/loadouts/strand-ability-recolor";
import type { Manifest } from "@/lib/manifest/load";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import { cn } from "@/lib/utils";

/**
 * Light white hairline frame for subclass plugs and the artifact, drawn on an overlay so
 * it sits on top of the icon (an inset shadow on the <img> itself paints under the art).
 * The host must be `relative`.
 */
export const TILE_FRAME =
  "after:pointer-events-none after:absolute after:inset-0 after:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.4)]";

/**
 * Armor mod categories whose art leaves out the square plate (white at ~14%) that the
 * rest of the mod icons bake in: tuning mods and the newer raid mods. Painted behind
 * them so a row of mods reads as one set of tiles.
 */
const PLATELESS_MOD = /\.tuning\.mods$|^enhancements\.raid_v[78]\d\d$/;

/** Icon + name for a plug/mod hash, from the manifest; falls back to the hash. */
export function PlugIcon({
  hash,
  manifest,
  dim = false,
  suffix,
  size = 24,
  sizeClassName,
  className,
  classType,
  element,
  framed: framedProp = false,
}: {
  hash: number;
  manifest: Manifest;
  dim?: boolean;
  suffix?: string;
  size?: 16 | 20 | 24 | 32 | 40;
  /** Overrides the size classes (e.g. a container-query step); `size` still sets the image's pixels. */
  sizeClassName?: string;
  className?: string;
  /** When set, append armor-stat bonuses (fragments' +10 / −10). */
  classType?: number;
  /** Subclass damage type: marks a subclass plug (aspects / fragments), which gets a frame. */
  element?: Subclass;
  /** Frame a plug that isn't a subclass plug (artifact perks). */
  framed?: boolean;
}) {
  const def = manifest.def("DestinyInventoryItemDefinition", hash);
  const name = def?.displayProperties?.name ?? `#${hash}`;
  const stats =
    classType === undefined
      ? ""
      : formatFragmentStats(
          buildFragmentStats(def?.investmentStats, classType).stats,
        );
  const title = suffix ? `${name} — ${suffix}` : name;
  const label = stats ? `${title}\n${stats}` : title;
  const icon = def?.displayProperties?.icon;
  const recolor = isStrandSharedAbilityIcon(def?.plug?.plugCategoryIdentifier);
  const plate = PLATELESS_MOD.test(def?.plug?.plugCategoryIdentifier ?? "");
  const framed = framedProp || (subclassFromPlug(def) ?? element) !== undefined;
  const sizeClass =
    sizeClassName ??
    (size === 16
      ? "size-4"
      : size === 20
        ? "size-5"
        : size === 32
          ? "size-8"
          : size === 40
            ? "size-10"
            : "size-6");
  return icon ? (
    <TooltipLabel label={label}>
      <span
        className={cn(
          sizeClass,
          "relative inline-flex shrink-0",
          recolor && "isolate",
          framed && TILE_FRAME,
        )}
        tabIndex={0}
      >
        <Image
          src={`${BUNGIE_IMAGE_BASE}${icon}`}
          alt={label}
          width={size}
          height={size}
          className={cn(
            sizeClass,
            "rounded-none",
            plate && "bg-white/14",
            dim && "opacity-40 grayscale",
            className,
          )}
          style={recolor ? { filter: STRAND_ABILITY_PLATE_FILTER } : undefined}
          unoptimized
        />
        <StrandAbilityRecolor on={recolor} />
      </span>
    </TooltipLabel>
  ) : (
    <TooltipLabel label={label}>
      <span
        className={cn(
          "bg-muted relative shrink-0 rounded-none",
          sizeClass,
          dim && "opacity-40",
          framed && TILE_FRAME,
          className,
        )}
        tabIndex={0}
        aria-label={label}
      />
    </TooltipLabel>
  );
}

/** A Bungie-hosted icon at a fixed square size, or a muted square when absent. */
export function ManifestIcon({
  icon,
  label,
  size,
  className,
  showTooltip = true,
  diamond = false,
  element,
}: {
  showTooltip?: boolean;
  icon?: string;
  label: string;
  size: 12 | 16 | 22 | 24 | 32 | 40 | 48;
  className?: string;
  /** Super art: a full-bleed diamond, outlined with a sharp 1px stroke. */
  diamond?: boolean;
  /** Tints the diamond outline to match the art; white at 16% without one. */
  element?: Subclass;
}) {
  const sizeClass =
    size === 12
      ? "size-3"
      : size === 22
        ? "size-[22px]"
        : size === 24
          ? "size-6"
          : size === 32
            ? "size-8"
            : size === 40
              ? "size-10"
              : size === 48
                ? "size-12"
                : "size-4";
  const image = (
    <Image
      src={`${BUNGIE_IMAGE_BASE}${icon}`}
      alt={label}
      tabIndex={showTooltip && !diamond ? 0 : undefined}
      width={size}
      height={size}
      className={cn(sizeClass, "shrink-0", className)}
      unoptimized
    />
  );
  return icon ? (
    <TooltipLabel label={showTooltip ? label : undefined}>
      {diamond ? (
        <span
          className={cn(sizeClass, "relative inline-flex shrink-0")}
          tabIndex={showTooltip ? 0 : undefined}
        >
          {image}
          <svg
            viewBox={`0 0 ${size} ${size}`}
            className="pointer-events-none absolute inset-0 size-full overflow-visible"
            aria-hidden
          >
            <polygon
              points={`${size / 2},0 ${size},${size / 2} ${size / 2},${size} 0,${size / 2}`}
              fill="none"
              // var() only resolves in CSS, not in the stroke attribute.
              style={{
                stroke: element
                  ? `color-mix(in srgb, ${SUBCLASS_LINE[element]} 60%, white)`
                  : "white",
              }}
              strokeOpacity={element ? 0.55 : 0.16}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </span>
      ) : (
        image
      )}
    </TooltipLabel>
  ) : (
    <TooltipLabel label={showTooltip ? label : undefined}>
      <span
        className={cn(
          "bg-muted relative shrink-0 rounded-none",
          sizeClass,
          className,
        )}
        tabIndex={showTooltip ? 0 : undefined}
      />
    </TooltipLabel>
  );
}
