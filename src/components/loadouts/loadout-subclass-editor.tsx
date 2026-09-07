"use client";

import { TooltipLabel } from "@/components/ui/tooltip";
import { useId, useMemo, type ReactNode } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import { SUBCLASSES, type Subclass } from "@/lib/armory/fragments";
import { STAT_LABELS, STAT_ORDER } from "@/lib/armory/stats";
import { ABILITY_KINDS, ABILITY_LABELS, subclassFromItemHash } from "@/lib/dim/subclasses";
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

export interface SubclassSection {
  manifest: Manifest;
  classType: number;
  initial: DimLoadoutItem | null;
}

function PlugOptionButton({
  option,
  checked,
  disabled,
  onClick,
  detail,
}: {
  option: SubclassPlugOption;
  checked: boolean;
  disabled?: boolean;
  onClick: () => void;
  detail?: ReactNode;
}) {
  return (
    <TooltipLabel label={option.description} disabled={disabled}>
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
          <Image
            src={`${BUNGIE_IMAGE_BASE}${option.icon}`}
            alt=""
            width={28}
            height={28}
            className="size-7 shrink-0 rounded-sm"
            unoptimized
          />
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

/** One optional, single-choice socket: Super, class ability, jump, melee, grenade. */
function AbilityGroup({
  label,
  group,
  value,
  onChange,
}: {
  label: string;
  group: SubclassSocketOptions;
  value: DimLoadoutItem;
  onChange: (value: DimLoadoutItem) => void;
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
      <div className="grid gap-1.5 sm:grid-cols-2 sm:group-data-[compact]/subclass:grid-cols-1">
        {group.options.map((option) => {
          const checked = option.hash === selected;
          return (
            <PlugOptionButton
              key={option.hash}
              option={option}
              checked={checked}
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
        <select
          id={id}
          value={active ?? ""}
          className="border-input bg-background min-w-0 max-w-full rounded-md border px-2 py-1.5 text-sm"
          onChange={(e) => {
            const sc = e.target.value as Subclass | "";
            onChange(sc ? { hash: catalog[sc].itemHash } : null);
          }}
        >
          <option value="">No subclass</option>
          {SUBCLASSES.map((s) => (
            <option key={s} value={s}>
              {s} · {catalog[s].name}
            </option>
          ))}
        </select>
      </div>
      {options && value && (
        <>
          <p className="text-muted-foreground text-xs">
            Choose abilities, aspects, and fragments for this loadout. Any ability
            you leave unset keeps whatever is equipped in game. Changing subclass
            clears these selections.
          </p>
          {ABILITY_KINDS.map((kind) => (
            <AbilityGroup
              key={kind}
              label={ABILITY_LABELS[kind]}
              group={options.abilities[kind]}
              value={value}
              onChange={onChange}
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
                <div className="grid gap-1.5 sm:grid-cols-2 sm:group-data-[compact]/subclass:grid-cols-1">
                  {group.options.map((option) => {
                    const checked = selected.includes(option.hash);
                    const statText = option.stats
                      .flatMap((v, i) =>
                        v
                          ? [
                              `${v > 0 ? "+" : ""}${v} ${STAT_LABELS[STAT_ORDER[i]]}`,
                            ]
                          : [],
                      )
                      .join(" · ");
                    return (
                      <PlugOptionButton
                        key={option.hash}
                        option={option}
                        checked={checked}
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
