"use client";

import { memo, type CSSProperties } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipLabel,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import Image from "next/image";
import { CircleNotch } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import { STAT_LABELS, STAT_ORDER, type StatIconMap } from "@/lib/armory/stats";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  SUBCLASS_LINE,
  SUBCLASSES,
  type FragmentInfo,
  type Subclass,
} from "@/lib/armory/fragments";

/**
 * Figma 17:5835 — "Fragments" label over the subclass tabs, with the emphatic
 * "Apply current" button bottom-aligned on the right. Below (not in the design,
 * kept from before): a grid of the active subclass's stat-affecting fragments
 * (Name + six stat columns). Toggle a fragment to fold its stats into the build.
 * Only the active subclass's selection applies (you run one subclass at a time).
 */
export const FragmentPicker = memo(function FragmentPicker({
  fragments,
  activeSubclass,
  onSubclassChange,
  selected,
  onToggle,
  statIcons,
  onApplyCurrent,
  applyDisabled,
  applyLoading,
}: {
  fragments: Record<Subclass, FragmentInfo[]>;
  activeSubclass: Subclass;
  onSubclassChange: (s: Subclass) => void;
  selected: Set<number>;
  onToggle: (hash: number) => void;
  statIcons: StatIconMap;
  onApplyCurrent: () => void;
  applyDisabled: boolean;
  applyLoading: boolean;
}) {
  const rows = fragments[activeSubclass];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="space-y-2">
          <Tabs
            value={activeSubclass}
            onValueChange={(v) => onSubclassChange(v as Subclass)}
          >
            <TabsList variant="default" aria-label="Subclass">
              {SUBCLASSES.map((s) => (
                <TabsTrigger key={s} value={s}>
                  {s}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        <TooltipLabel
          label="Match your equipped subclass and fragments"
          disabled={applyDisabled}
        >
          <Button
            type="button"
            variant="emphatic"
            disabled={applyDisabled || applyLoading}
            onClick={onApplyCurrent}
          >
            {applyLoading ? (
              <CircleNotch className="animate-spin" aria-hidden />
            ) : null}
            Apply current
          </Button>
        </TooltipLabel>
      </div>

      {rows.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          No stat fragments for this subclass.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-max divide-y divide-foreground/10">
            <div className="grid grid-cols-[1fr_repeat(6,2rem)] items-center gap-x-2 py-1.5">
              <span aria-hidden />
              {STAT_ORDER.map((key) => (
                <span key={key} className="flex justify-center">
                  {statIcons[key] ? (
                    <TooltipLabel label={STAT_LABELS[key]}>
                      <Image
                        src={`${BUNGIE_IMAGE_BASE}${statIcons[key]}`}
                        alt={STAT_LABELS[key]}
                        tabIndex={0}
                        width={16}
                        height={16}
                        className="size-4 shrink-0 opacity-80 invert dark:invert-0"
                        unoptimized
                      />
                    </TooltipLabel>
                  ) : (
                    <span className="size-4 shrink-0" aria-hidden />
                  )}
                </span>
              ))}
            </div>

            {rows.map((f) => {
              const on = selected.has(f.hash);
              const tooltip = f.description?.trim();
              const identity = (
                <span className="flex min-w-0 items-center gap-2">
                  {f.icon && (
                    <Image
                      src={`${BUNGIE_IMAGE_BASE}${f.icon}`}
                      alt=""
                      width={20}
                      height={20}
                      className="d2-tile-element size-5 shrink-0 rounded-none"
                      style={
                        {
                          "--element-line": SUBCLASS_LINE[activeSubclass],
                        } as CSSProperties
                      }
                      unoptimized
                    />
                  )}
                  <span className="truncate">{f.name}</span>
                </span>
              );
              return (
                <div
                  key={f.hash}
                  className="grid grid-cols-[1fr_repeat(6,2rem)] items-center gap-x-2 py-1.5"
                >
                  <label
                    className={cn(
                      "group flex cursor-pointer items-center gap-2 rounded-none px-1 text-left text-sm transition-colors",
                      on
                        ? "text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Checkbox
                      checked={on}
                      onCheckedChange={() => onToggle(f.hash)}
                      className="group-hover:not-data-checked:[--line-alpha:1.6]"
                    />
                    {tooltip ? (
                      <Tooltip>
                        <TooltipTrigger
                          nativeButton={false}
                          delay={0}
                          closeDelay={0}
                          render={identity}
                        />
                        <TooltipContent
                          side="top"
                          align="start"
                          className="pointer-events-none max-w-sm px-4 py-3 text-sm leading-relaxed data-open:animate-none data-closed:animate-none"
                        >
                          {tooltip}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      identity
                    )}
                  </label>
                  {STAT_ORDER.map((key, i) => (
                    <span
                      key={key}
                      className={cn(
                        "text-center text-xs tabular-nums",
                        f.stats[i] > 0 && "text-positive",
                        f.stats[i] < 0 && "text-destructive",
                      )}
                    >
                      {f.stats[i]
                        ? `${f.stats[i] > 0 ? "+" : "−"}${Math.abs(f.stats[i])}`
                        : ""}
                    </span>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
});
