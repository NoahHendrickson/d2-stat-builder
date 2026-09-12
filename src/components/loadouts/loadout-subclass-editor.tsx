"use client";

import { TooltipLabel } from "@/components/ui/tooltip";
import { useEffect, useId, useMemo, useState, type CSSProperties } from "react";
import Image from "next/image";
import { CaretDown } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import { formatFragmentStats, SUBCLASSES, type Subclass } from "@/lib/armory/fragments";
import {
  ABILITY_KINDS,
  ABILITY_LABELS,
  isStrandSharedAbilityIcon,
  subclassFromItemHash,
} from "@/lib/dim/subclasses";
import type { DimLoadoutItem } from "@/lib/dim/loadout-link";
import type { Manifest } from "@/lib/manifest/load";
import {
  selectedSubclassPlugs,
  subclassFragmentCapacity,
  subclassOptions,
  withSubclassPlugs,
  type SubclassCatalog,
  type SubclassPlugOption,
  type SubclassSocketOptions,
} from "@/lib/loadouts/subclass";
import { cachedLightTint, sampleLightTint } from "@/lib/light-tint";
import {
  STRAND_ABILITY_PLATE_FILTER,
  StrandAbilityRecolor,
} from "@/components/loadouts/strand-ability-recolor";

export interface SubclassSection {
  manifest: Manifest;
  classType: number;
  initial: DimLoadoutItem | null;
}

function useIconLightTint(icon: string | undefined) {
  const src = icon ? `${BUNGIE_IMAGE_BASE}${icon}` : undefined;
  // Cache hits are read straight from the cache during render; only a miss goes through
  // state, and the result is keyed by src so a stale sample never shows for a new icon.
  const [sampled, setSampled] = useState<{ src: string; tint: string | undefined } | null>(
    null,
  );
  useEffect(() => {
    if (!src || cachedLightTint(src) !== undefined) return;
    let live = true;
    sampleLightTint(src).then((color) => {
      if (live) setSampled({ src, tint: color });
    });
    return () => {
      live = false;
    };
  }, [src]);
  if (!src) return undefined;
  const hit = cachedLightTint(src);
  if (hit !== undefined) return hit;
  return sampled?.src === src ? sampled.tint : undefined;
}

function PlugOptionButton({
  option,
  checked,
  disabled,
  onClick,
  detail,
  compact,
  flush,
  backed,
}: {
  option: SubclassPlugOption;
  checked: boolean;
  disabled?: boolean;
  onClick: () => void;
  detail?: string;
  /** Icon-only 56px cell (matches the drawer's mod cells); name + detail (stats, slots) are the tooltip. */
  compact?: boolean;
  /** Image fills the cell so the border sits on the artwork (non-super abilities). */
  flush?: boolean;
  /** Opaque tint behind a flush icon (Prismatic fragments are translucent). */
  backed?: boolean;
}) {
  const tint = useIconLightTint(compact && (!flush || backed) ? option.icon : undefined);
  const recolor = isStrandSharedAbilityIcon(option.plugCategory);
  if (compact) {
    const name = option.name || "Unknown";
    const label = detail ? `${name}\n${detail}` : name;
    return (
      <TooltipLabel label={label}>
        <button
          type="button"
          aria-pressed={checked}
          aria-label={detail ? `${name}, ${detail}` : name}
          aria-disabled={disabled || undefined}
          onClick={() => {
            if (!disabled) onClick();
          }}
          style={tint ? ({ "--icon-tint": tint } as CSSProperties) : undefined}
          className={cn(
            "focus-visible:ring-ring relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-none border transition-[opacity,border-color,background-color] outline-none focus-visible:ring-2",
            recolor && "isolate",
            flush ? "p-0" : "p-1",
            tint && "bg-[hsl(var(--icon-tint)_72%)] dark:bg-[hsl(var(--icon-tint)_26%)]",
            checked
              ? "border-emphatic cursor-pointer"
              : disabled
                ? "cursor-not-allowed border-input opacity-40"
                : "cursor-pointer border-input",
            checked && !tint && "bg-emphatic/6",
            !checked && !disabled && !tint && "hover:bg-foreground/6 focus-visible:bg-foreground/6",
          )}
        >
          {option.icon ? (
            <Image
              src={`${BUNGIE_IMAGE_BASE}${option.icon}`}
              alt=""
              width={flush ? 56 : 48}
              height={flush ? 56 : 48}
              className={cn("shrink-0 rounded-none", flush ? "size-full" : "size-12")}
              style={recolor ? { filter: STRAND_ABILITY_PLATE_FILTER } : undefined}
              unoptimized
            />
          ) : (
            <span
              className={cn("bg-muted shrink-0 rounded-none", flush ? "size-full" : "size-12")}
              aria-hidden
            />
          )}
          <StrandAbilityRecolor on={recolor} />
        </button>
      </TooltipLabel>
    );
  }
  return (
    <TooltipLabel label={option.name || "Unknown"} disabled={disabled}>
      <Button
        type="button"
        variant="outline"
        aria-pressed={checked}
        disabled={disabled}
        className={cn(
          "h-auto min-h-12 w-full justify-start px-2 py-2 text-left",
          checked && "border-brand/60 bg-brand/10",
        )}
        onClick={onClick}
      >
        {option.icon && (
          <span className="relative isolate inline-flex size-7 shrink-0">
            <Image
              src={`${BUNGIE_IMAGE_BASE}${option.icon}`}
              alt=""
              width={28}
              height={28}
              className="size-7 rounded-sm"
              style={recolor ? { filter: STRAND_ABILITY_PLATE_FILTER } : undefined}
              unoptimized
            />
            <StrandAbilityRecolor on={recolor} />
          </span>
        )}
        <span className="min-w-0 whitespace-normal">
          <span className="block text-xs">{option.name}</span>
          {detail && (
            <span className="text-muted-foreground block text-[10px] font-normal">
              {detail}
            </span>
          )}
        </span>
      </Button>
    </TooltipLabel>
  );
}

/** Option layout: wrapping icon cells when compact, two wide buttons per row otherwise. */
const OPTIONS_GRID = "grid gap-1.5 sm:grid-cols-2";
const OPTIONS_CELLS = "flex flex-wrap gap-0.5";

/** One optional, single-choice socket: Super, class ability, jump, melee, grenade. */
function AbilityGroup({
  label,
  group,
  value,
  onChange,
  compact,
  flush,
}: {
  label: string;
  group: SubclassSocketOptions;
  value: DimLoadoutItem;
  onChange: (value: DimLoadoutItem) => void;
  compact: boolean;
  flush?: boolean;
}) {
  const selected = selectedSubclassPlugs(value, group)[0];
  if (group.options.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <h3 className="font-medium">{label}</h3>
        <span className="text-muted-foreground">
          {selected !== undefined ? "1/1 selected" : "Keep in-game choice"}
        </span>
      </div>
      <div className={compact ? OPTIONS_CELLS : OPTIONS_GRID}>
        {group.options.map((option) => {
          const checked = option.hash === selected;
          return (
            <PlugOptionButton
              key={option.hash}
              option={option}
              checked={checked}
              compact={compact}
              flush={flush}
              onClick={() =>
                onChange(withSubclassPlugs(value, group, checked ? [] : [option.hash]))
              }
            />
          );
        })}
      </div>
      {selected !== undefined && !group.options.some((o) => o.hash === selected) && (
        <Button
          type="button"
          size="xs"
          variant="outline"
          onClick={() => onChange(withSubclassPlugs(value, group, []))}
        >
          Remove unavailable {label.toLowerCase()} #{selected}
        </Button>
      )}
    </div>
  );
}

export function LoadoutSubclassEditor({
  section,
  value,
  onChange,
  compact = false,
}: {
  section: SubclassSection;
  value: DimLoadoutItem | null;
  onChange: (value: DimLoadoutItem | null) => void;
  /** Narrow-column layout (the editor drawer): no frame, one option per row. */
  compact?: boolean;
}) {
  const id = useId();
  const active = value ? subclassFromItemHash(value.hash) : undefined;
  const catalog = useMemo(
    () =>
      Object.fromEntries(
        SUBCLASSES.map((s) => [
          s,
          subclassOptions(section.manifest, section.classType, s),
        ]),
      ) as Record<Subclass, SubclassCatalog>,
    [section.manifest, section.classType],
  );
  const options = active ? catalog[active] : undefined;
  const aspects = options ? selectedSubclassPlugs(value, options.aspects) : [];
  const fragments = options
    ? selectedSubclassPlugs(value, options.fragments)
    : [];
  const capacity = options && value ? subclassFragmentCapacity(value, options.aspects) : 6;

  return (
    <section
      className={cn(
        "group/subclass space-y-3",
        !compact && "border-border/60 rounded-lg border p-3",
      )}
      data-compact={compact || undefined}
      aria-label="Subclass configuration"
    >
      <div className="flex items-center justify-between gap-3 group-data-[compact]/subclass:flex-col group-data-[compact]/subclass:items-stretch group-data-[compact]/subclass:gap-1.5">
        <label htmlFor={id} className="text-sm font-medium">
          Subclass
        </label>
        <DropdownMenu>
          <DropdownMenuTrigger
            id={id}
            aria-label="Subclass"
            className="inline-flex h-8 w-full min-w-0 cursor-pointer items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none hover:bg-muted/60 focus-visible:border-emphatic data-popup-open:border-emphatic dark:bg-input/30 dark:hover:bg-input/50"
          >
            <span className="truncate">
              {active ? `${active} · ${catalog[active].name}` : "No subclass"}
            </span>
            <CaretDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup
              value={active ?? "none"}
              onValueChange={(v) => {
                if (v === "none") onChange(null);
                else onChange({ hash: catalog[v as Subclass].itemHash });
              }}
            >
              <DropdownMenuRadioItem value="none">No subclass</DropdownMenuRadioItem>
              {SUBCLASSES.map((s) => (
                <DropdownMenuRadioItem key={s} value={s}>
                  {s} · {catalog[s].name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {options && value && (
        <>
          {!compact && (
            <p className="text-muted-foreground text-xs">
              Choose abilities, aspects, and fragments for this loadout. Any ability
              you leave unset keeps whatever is equipped in game. Changing subclass
              clears these selections.
            </p>
          )}
          {ABILITY_KINDS.map((kind) => (
            <AbilityGroup
              key={kind}
              label={ABILITY_LABELS[kind]}
              group={options.abilities[kind]}
              value={value}
              onChange={onChange}
              compact={compact}
              flush={kind !== "super"}
            />
          ))}
          {(["aspects", "fragments"] as const).map((kind) => {
            const group = options[kind];
            const selected = kind === "aspects" ? aspects : fragments;
            const limit = kind === "aspects" ? 2 : capacity;
            return (
              <div key={kind} className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <h3 className="font-medium capitalize">{kind}</h3>
                  <span className="text-muted-foreground">
                    {selected.length}/{limit} selected
                  </span>
                </div>
                {kind === "fragments" && aspects.length === 0 && capacity > 0 && (
                  <p className="text-muted-foreground text-xs">
                    Choose aspects to set your fragment limit. With aspects
                    unspecified, your in-game aspects are kept.
                  </p>
                )}
                <div className={compact ? OPTIONS_CELLS : OPTIONS_GRID}>
                  {group.options.map((option) => {
                    const checked = selected.includes(option.hash);
                    const statText = formatFragmentStats(option.stats);
                    return (
                      <PlugOptionButton
                        key={option.hash}
                        option={option}
                        checked={checked}
                        compact={compact}
                        flush
                        backed={kind === "fragments" && active === "Prismatic"}
                        disabled={!checked && selected.length >= limit}
                        detail={
                          kind === "aspects"
                            ? `${option.fragmentSlots} fragment slots`
                            : statText || undefined
                        }
                        onClick={() =>
                          onChange(
                            withSubclassPlugs(
                              value,
                              group,
                              checked
                                ? selected.filter((h) => h !== option.hash)
                                : [...selected, option.hash],
                            ),
                          )
                        }
                      />
                    );
                  })}
                </div>
                {group.options.length === 0 && (
                  <p className="text-muted-foreground text-xs">
                    No {kind} available in the game data.
                  </p>
                )}
                {selected
                  .filter((h) => !group.options.some((o) => o.hash === h))
                  .map((hash) => (
                    <Button
                      key={hash}
                      type="button"
                      size="xs"
                      variant="outline"
                      onClick={() =>
                        onChange(
                          withSubclassPlugs(
                            value,
                            group,
                            selected.filter((h) => h !== hash),
                          ),
                        )
                      }
                    >
                      Remove unavailable{" "}
                      {kind === "aspects" ? "aspect" : "fragment"} #{hash}
                    </Button>
                  ))}
              </div>
            );
          })}
          {fragments.length > capacity && (
            <p className="text-destructive text-xs" role="alert">
              Remove {fragments.length - capacity} fragments to fit your
              aspects.
            </p>
          )}
        </>
      )}
    </section>
  );
}
