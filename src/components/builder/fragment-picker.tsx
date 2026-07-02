"use client";

import { Fragment } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import { STAT_LABELS, STAT_ORDER } from "@/lib/armory/stats";
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
}: {
  fragments: Record<Subclass, FragmentInfo[]>;
  activeSubclass: Subclass;
  onSubclassChange: (s: Subclass) => void;
  selected: Set<number>;
  onToggle: (hash: number) => void;
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
          <div className="grid min-w-max grid-cols-[1fr_repeat(6,2rem)] items-center gap-x-2 gap-y-1">
            <span aria-hidden />
            {STAT_ORDER.map((key) => (
              <span
                key={key}
                className="text-muted-foreground text-center text-[10px]"
              >
                {STAT_LABELS[key].slice(0, 3)}
              </span>
            ))}

            {rows.map((f) => {
              const on = selected.has(f.hash);
              return (
                <Fragment key={f.hash}>
                  <label
                    className={cn(
                      "group flex cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 text-left text-sm transition-colors",
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
                </Fragment>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
