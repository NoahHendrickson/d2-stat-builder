"use client";

import { useMemo, useSyncExternalStore } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  ArrowDown02Icon,
  ArrowUp02Icon,
  ArrowUpDownIcon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TooltipLabel } from "@/components/ui/tooltip";
import { annotationsStore, type Annotations } from "@/lib/inventory/annotations";
import type { InventoryItem } from "@/lib/inventory/build";
import {
  DEFAULT_VIEW,
  GROUP_KEYS,
  GROUP_LABELS,
  SORT_KEYS,
  SORT_LABELS,
  itemComparator,
  setViewSettings,
  useViewSettings,
  type SortKey,
} from "@/lib/inventory/view-settings";
import { cn } from "@/lib/utils";

const NO_ANNOTATIONS: Annotations = {};

/**
 * The comparator for the saved sort. Follows tag edits only while sorting by tag, so a
 * keystroke in a note doesn't re-sort (and re-render) the whole grid.
 */
export function useItemComparator(): (a: InventoryItem, b: InventoryItem) => number {
  const { sort } = useViewSettings();
  const byTag = sort.includes("tag");
  const annotations = useSyncExternalStore(
    annotationsStore.subscribe,
    () => (byTag ? annotationsStore.get() : NO_ANNOTATIONS),
    () => NO_ANNOTATIONS,
  );
  return useMemo(() => itemComparator(sort, annotations), [sort, annotations]);
}

/** Sort order (a chain of keys) and vault grouping, like DIM's item display settings. */
export function ViewMenu() {
  const view = useViewSettings();
  const unused = SORT_KEYS.filter((k) => !view.sort.includes(k));

  const setSort = (sort: SortKey[]) => setViewSettings({ ...view, sort });
  const move = (from: number, to: number) => {
    const sort = [...view.sort];
    const [key] = sort.splice(from, 1);
    sort.splice(to, 0, key!);
    setSort(sort);
  };

  return (
    <Popover>
      <TooltipLabel label="Sort and group">
        <PopoverTrigger render={<Button variant="default" size="icon" aria-label="Sort and group" />}>
          <HugeiconsIcon icon={ArrowUpDownIcon} aria-hidden />
        </PopoverTrigger>
      </TooltipLabel>
      <PopoverContent align="end" className="w-80 gap-4 p-3 text-sm">
        <section className="flex flex-col gap-2" aria-label="Sort items by">
          <p className="d2-label">Sort items by</p>
          <ol className="flex flex-col gap-1">
            {view.sort.map((key, i) => (
              <li key={key} className="bg-foreground/5 flex items-center gap-2 py-1 pr-1 pl-2">
                <span className="text-muted-foreground w-4 text-xs tabular-nums">{i + 1}</span>
                <span className="flex-1">{SORT_LABELS[key]}</span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Move ${SORT_LABELS[key]} up`}
                  disabled={i === 0}
                  onClick={() => move(i, i - 1)}
                >
                  <HugeiconsIcon icon={ArrowUp02Icon} aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Move ${SORT_LABELS[key]} down`}
                  disabled={i === view.sort.length - 1}
                  onClick={() => move(i, i + 1)}
                >
                  <HugeiconsIcon icon={ArrowDown02Icon} aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Stop sorting by ${SORT_LABELS[key]}`}
                  onClick={() => setSort(view.sort.filter((k) => k !== key))}
                >
                  <HugeiconsIcon icon={Cancel01Icon} aria-hidden />
                </Button>
              </li>
            ))}
          </ol>
          {!view.sort.includes("name") && (
            <p className="text-muted-foreground text-xs">Then by name.</p>
          )}
          {unused.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {unused.map((key) => (
                <Button key={key} variant="dashed" size="xs" onClick={() => setSort([...view.sort, key])}>
                  <HugeiconsIcon icon={Add01Icon} aria-hidden />
                  {SORT_LABELS[key]}
                </Button>
              ))}
            </div>
          )}
        </section>

        <section className="flex flex-col gap-2" aria-label="Group vault rows by">
          <p className="d2-label">Group vault rows by</p>
          <div className="flex flex-wrap gap-1.5" role="radiogroup">
            {GROUP_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={view.vaultGroup === key}
                onClick={() => setViewSettings({ ...view, vaultGroup: key })}
                className={cn(
                  "d2-hover-ring h-7 px-2.5 text-xs outline-none focus-visible:d2-tile-selected",
                  view.vaultGroup === key ? "bg-foreground text-background" : "bg-foreground/10",
                )}
              >
                {GROUP_LABELS[key]}
              </button>
            ))}
          </div>
        </section>

        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => setViewSettings(DEFAULT_VIEW)}
        >
          Reset to defaults
        </Button>
      </PopoverContent>
    </Popover>
  );
}
