"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import { STAT_LABELS, STAT_ORDER, type StatIconMap } from "@/lib/armory/stats";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  SUBCLASSES,
  type FragmentInfo,
  type Subclass,
} from "@/lib/armory/fragments";

/**
 * Subclass tabs + a grid of the active subclass's stat-affecting fragments (Name +
 * six stat columns). Toggle a fragment to fold its stats into the build. Only the
 * active subclass's selection applies (you run one subclass at a time).
 */
export function FragmentPicker({
  fragments,
  activeSubclass,
  onSubclassChange,
  selected,
  onToggle,
  statIcons,
}: {
  fragments: Record<Subclass, FragmentInfo[]>;
  activeSubclass: Subclass;
  onSubclassChange: (s: Subclass) => void;
  selected: Set<number>;
  onToggle: (hash: number) => void;
  statIcons: StatIconMap;
}) {
  const rows = fragments[activeSubclass];

  return (
    <div className="space-y-3">
      <Tabs
        value={activeSubclass}
        onValueChange={(v) => onSubclassChange(v as Subclass)}
      >
        <TabsList>
          {SUBCLASSES.map((s) => (
            <TabsTrigger key={s} value={s} className="text-xs">
              {s}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {rows.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          No stat fragments for this subclass.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <div className="divide-border/60 min-w-max divide-y">
            <div className="grid grid-cols-[1fr_repeat(6,2rem)] items-center gap-x-2 py-1.5">
              <span aria-hidden />
              {STAT_ORDER.map((key) => (
                <span key={key} className="flex justify-center">
                  {statIcons[key] ? (
                    <Image
                      src={`${BUNGIE_IMAGE_BASE}${statIcons[key]}`}
                      alt={STAT_LABELS[key]}
                      title={STAT_LABELS[key]}
                      width={16}
                      height={16}
                      className="size-4 shrink-0 invert dark:invert-0"
                      unoptimized
                    />
                  ) : (
                    <span className="size-4 shrink-0" aria-hidden />
                  )}
                </span>
              ))}
            </div>

            {rows.map((f) => {
              const on = selected.has(f.hash);
              return (
                <div
                  key={f.hash}
                  className="grid grid-cols-[1fr_repeat(6,2rem)] items-center gap-x-2 py-1.5"
                >
                  <label
                    className={cn(
                      "group flex cursor-pointer items-center gap-2 rounded-md px-1 text-left text-sm transition-colors",
                      on
                        ? "text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Checkbox
                      size="lg"
                      checked={on}
                      onCheckedChange={() => onToggle(f.hash)}
                      className="group-hover:border-primary/60"
                    />
                    {f.icon && (
                      <Image
                        src={`${BUNGIE_IMAGE_BASE}${f.icon}`}
                        alt=""
                        width={20}
                        height={20}
                        className="size-5 rounded-sm"
                        unoptimized
                      />
                    )}
                    <span className="truncate">{f.name}</span>
                  </label>
                  {STAT_ORDER.map((key, i) => (
                    <span
                      key={key}
                      className={cn(
                        "text-center text-xs tabular-nums",
                        f.stats[i] > 0 && "text-sky-400",
                        f.stats[i] < 0 && "text-red-400",
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
}
