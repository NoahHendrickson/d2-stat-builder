"use client";

import { TooltipLabel } from "@/components/ui/tooltip";
import { useId, useMemo } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import { SUBCLASSES, type Subclass } from "@/lib/armory/fragments";
import { STAT_LABELS, STAT_ORDER } from "@/lib/armory/stats";
import { subclassFromItemHash } from "@/lib/dim/subclasses";
import type { DimLoadoutItem } from "@/lib/dim/loadout-link";
import type { Manifest } from "@/lib/manifest/load";
import {
  selectedSubclassPlugs,
  subclassFragmentCapacity,
  subclassOptions,
  withSubclassPlugs,
} from "@/lib/loadouts/subclass";

export interface SubclassSection {
  manifest: Manifest;
  classType: number;
  initial: DimLoadoutItem | null;
}

export function LoadoutSubclassEditor({
  section,
  value,
  onChange,
}: {
  section: SubclassSection;
  value: DimLoadoutItem | null;
  onChange: (value: DimLoadoutItem | null) => void;
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
      ) as Record<Subclass, ReturnType<typeof subclassOptions>>,
    [section.manifest, section.classType],
  );
  const options = active ? catalog[active] : undefined;
  const superHash = options ? selectedSubclassPlugs(value, options.super)[0] : undefined;
  const aspects = options ? selectedSubclassPlugs(value, options.aspects) : [];
  const fragments = options
    ? selectedSubclassPlugs(value, options.fragments)
    : [];
  const capacity = options && value ? subclassFragmentCapacity(value, options.aspects) : 6;

  return (
    <section
      className="border-border/60 space-y-3 rounded-lg border p-3"
      aria-label="Subclass configuration"
    >
      <div className="flex items-center justify-between gap-3">
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
            Choose a super, aspects, and fragments for this loadout. Changing
            subclass clears these selections.
          </p>
          {options.super.options.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <h3 className="font-medium">Super</h3>
                <span className="text-muted-foreground">
                  {superHash ? "1/1 selected" : "None selected"}
                </span>
              </div>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {options.super.options.map((option) => {
                  const checked = option.hash === superHash;
                  return (
                    <TooltipLabel label={option.description} key={option.hash}>
                      <Button
                        type="button"
                        variant="outline"
                        aria-pressed={checked}
                        className={cn(
                          "h-auto min-h-12 w-full justify-start px-2 py-2 text-left",
                          checked && "border-brand/60 bg-brand/10",
                        )}
                        onClick={() =>
                          onChange(
                            withSubclassPlugs(
                              value,
                              options.super,
                              checked ? [] : [option.hash],
                            ),
                          )
                        }
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
                        </span>
                      </Button>
                    </TooltipLabel>
                  );
                })}
              </div>
              {superHash &&
                !options.super.options.some((o) => o.hash === superHash) && (
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      onChange(withSubclassPlugs(value, options.super, []))
                    }
                  >
                    Remove unavailable super #{superHash}
                  </Button>
                )}
            </div>
          )}
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
                <div className="grid gap-1.5 sm:grid-cols-2">
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
                      <TooltipLabel
                        label={option.description}
                        key={option.hash}
                        disabled={!checked && selected.length >= limit}
                      >
                        <Button
                          type="button"
                          variant="outline"
                          aria-pressed={checked}
                          disabled={!checked && selected.length >= limit}

                          className={cn(
                            "h-auto min-h-12 w-full justify-start px-2 py-2 text-left",
                            checked && "border-brand/60 bg-brand/10",
                          )}
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
                            {(kind === "aspects" || statText) && (
                              <span className="text-muted-foreground block text-[10px] font-normal">
                                {kind === "aspects"
                                  ? `${option.fragmentSlots} fragment slots`
                                  : statText}
                              </span>
                            )}
                          </span>
                        </Button>
                      </TooltipLabel>
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
