"use client";

import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  ArrowUpDownIcon,
  Cancel01Icon,
  DragDropVerticalIcon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TooltipLabel } from "@/components/ui/tooltip";
import { annotationsStore, type Annotations } from "@/lib/inventory/annotations";
import type { InventoryItem } from "@/lib/inventory/build";
import {
  ARMOR_GROUP_KEYS,
  GROUP_LABELS,
  WEAPON_GROUP_KEYS,
  SORT_KEYS,
  SORT_LABELS,
  itemComparator,
  resetSortAndGrouping,
  setViewSettings,
  useViewSettings,
  type GroupKey,
  type SortKey,
} from "@/lib/inventory/view-settings";
import { moveItem } from "@/lib/move-item";
import { cn } from "@/lib/utils";
import { TOOLBAR_ICON_BUTTON } from "./toolbar-icon";

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

/** A drag in progress: the row picked up, the slot it would drop into, and how far it has moved. */
interface SortDrag {
  /** The key picked up: if the saved sort changes mid-drag (Reset, another tab), the drop is dropped. */
  key: SortKey;
  from: number;
  to: number;
  /** Pointer travel since the press, held inside the list. */
  dy: number;
  startY: number;
  /** One row plus the gap below it. */
  pitch: number;
}

/**
 * Where row `i` draws during `drag`: the picked-up row follows the pointer, and the rows
 * between its old and new slots step aside to open the gap. The DOM keeps the saved order
 * until the drop, so the steps can animate.
 */
function dragOffset(drag: SortDrag, i: number): number {
  const { from, to, pitch } = drag;
  if (i === from) return drag.dy;
  if (from < to && i > from && i <= to) return -pitch;
  if (from > to && i >= to && i < from) return pitch;
  return 0;
}

/**
 * The sort keys in use, one outlined box each, in the order they apply. Pressing a box lifts
 * it; drag it (or focus its grip and press the up and down arrows) to reorder. The order
 * saves on release.
 */
function SortList({ sort, onChange }: { sort: readonly SortKey[]; onChange: (sort: SortKey[]) => void }) {
  const listRef = useRef<HTMLOListElement>(null);
  const [drag, setDrag] = useState<SortDrag | null>(null);
  const endDrag = () => setDrag(null);
  // A keyed row that React moves can lose focus on the way; put it back on the grip.
  const refocus = (key: SortKey) =>
    requestAnimationFrame(() =>
      listRef.current?.querySelector<HTMLElement>(`[data-sort-grip="${key}"]`)?.focus(),
    );

  return (
    // The list holds the pointer during a drag, so the rows can move under it.
    <ol
      ref={listRef}
      className={cn("flex flex-col gap-1.5", drag && "cursor-grabbing")}
      onPointerMove={(e) => {
        if (!drag) return;
        // Kept between the first and last slots.
        const dy = Math.max(-drag.from * drag.pitch, Math.min((sort.length - 1 - drag.from) * drag.pitch, e.clientY - drag.startY));
        setDrag({ ...drag, dy, to: drag.from + Math.round(dy / drag.pitch) });
      }}
      onPointerUp={() => {
        if (!drag) return;
        if (drag.to !== drag.from && sort[drag.from] === drag.key) onChange(moveItem(sort, drag.from, drag.to));
        endDrag();
      }}
      onPointerCancel={endDrag}
      // Capture can end without a pointerup (the popover closing, focus moving): end the drag too.
      onLostPointerCapture={endDrag}
    >
      {sort.map((key, i) => {
        const lifted = drag?.from === i;
        const offset = drag ? dragOffset(drag, i) : 0;
        return (
          <li
            key={key}
            className={cn(
              "d2-line d2-hover-ring relative flex h-8 cursor-grab touch-none items-center gap-1.5 pr-1 pl-1 select-none hover:bg-foreground/6 hover:[--line-alpha:1.6]",
              // Rows stepping aside glide; once dropped, the new order lands without a slide.
              drag && !lifted && "transition-transform duration-150 ease-out",
              lifted &&
                "z-10 cursor-grabbing bg-foreground/18 shadow-[0_8px_20px_rgb(0_0_0/0.4)] backdrop-blur-md [--line-alpha:2.6] hover:bg-foreground/18",
            )}
            style={
              drag
                ? { transform: `translateY(${offset}px)${lifted ? " scale(1.04)" : ""}` }
                : undefined
            }
            onPointerDown={(e) => {
              const list = listRef.current;
              if (e.button !== 0 || !list || (e.target as Element).closest("[data-no-drag]")) return;
              // No text selection or focus shift from the press; the grip takes focus instead,
              // so the arrow keys carry on from a click.
              e.preventDefault();
              e.currentTarget.querySelector<HTMLElement>("[data-sort-grip]")?.focus({ preventScroll: true });
              const [first, second] = list.children;
              const pitch = first && second ? second.getBoundingClientRect().top - first.getBoundingClientRect().top : 38;
              list.setPointerCapture(e.pointerId);
              setDrag({ key, from: i, to: i, dy: 0, startY: e.clientY, pitch });
            }}
          >
            <button
              type="button"
              data-sort-grip={key}
              aria-label={`Reorder ${SORT_LABELS[key]}: drag, or use the up and down arrow keys`}
              className="text-muted-foreground flex size-6 shrink-0 cursor-[inherit] items-center justify-center outline-none focus-visible:ring-1 focus-visible:ring-outline-strong"
              onKeyDown={(e) => {
                const to = e.key === "ArrowUp" ? i - 1 : e.key === "ArrowDown" ? i + 1 : -1;
                if (to < 0 || to >= sort.length) return;
                e.preventDefault();
                onChange(moveItem(sort, i, to));
                refocus(key);
              }}
            >
              <HugeiconsIcon icon={DragDropVerticalIcon} className="size-4" aria-hidden />
            </button>
            <span className="flex-1 truncate">{SORT_LABELS[key]}</span>
            <Button
              data-no-drag
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground hover:text-foreground cursor-pointer"
              aria-label={`Stop sorting by ${SORT_LABELS[key]}`}
              onClick={() => onChange(sort.filter((k) => k !== key))}
            >
              <HugeiconsIcon icon={Cancel01Icon} aria-hidden />
            </Button>
          </li>
        );
      })}
    </ol>
  );
}

/** One kind's grouping: every option shown, the picked one filled. */
function GroupPicker<K extends GroupKey>({
  label,
  keys,
  value,
  onChange,
}: {
  label: string;
  keys: readonly K[];
  value: K;
  onChange: (key: K) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <div
        // Even cells: weapons' six options in two rows of three, armor's four in one row.
        className={cn("grid gap-1", keys.length <= 4 ? "grid-cols-4" : "grid-cols-3")}
        role="radiogroup" aria-label={`Group vault ${label.toLowerCase()} by`}>
        {keys.map((key) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={value === key}
            onClick={() => onChange(key)}
            className={cn(
              "d2-hover-ring h-7 truncate px-1 text-xs outline-none focus-visible:d2-tile-selected",
              value === key
                ? "d2-equip text-emphatic-foreground hover:[--equip-fill:var(--emphatic-light)]"
                : "bg-foreground/8 hover:bg-foreground/12",
            )}
          >
            {GROUP_LABELS[key]}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Sort order (a chain of keys) and how the vault's weapon and armor rows group. */
export function ViewMenu() {
  const view = useViewSettings();
  const unused = SORT_KEYS.filter((k) => !view.sort.includes(k));
  const setSort = (sort: SortKey[]) => setViewSettings({ ...view, sort });

  return (
    <Popover>
      <TooltipLabel label="Sort and group">
        <PopoverTrigger aria-label="Sort and group" className={TOOLBAR_ICON_BUTTON}>
          <HugeiconsIcon icon={ArrowUpDownIcon} aria-hidden />
        </PopoverTrigger>
      </TooltipLabel>
      <PopoverContent align="end" className="w-72 gap-5 p-3 text-sm">
        <section className="flex flex-col gap-2" aria-label="Sort by">
          <div className="flex h-6 items-center justify-between">
            <p className="d2-label">Sort by</p>
            {unused.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="outline" size="xs" />}>
                  <HugeiconsIcon icon={Add01Icon} aria-hidden />
                  Add
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-40">
                  {unused.map((key) => (
                    <DropdownMenuItem key={key} onClick={() => setSort([...view.sort, key])}>
                      {SORT_LABELS[key]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          <SortList sort={view.sort} onChange={setSort} />
          {!view.sort.includes("name") && <p className="text-muted-foreground text-xs">Ties go by name.</p>}
        </section>

        <section className="flex flex-col gap-2" aria-label="Group vault by">
          <p className="d2-label">Group vault by</p>
          <div className="flex flex-col gap-3">
            <GroupPicker
              label="Weapons"
              keys={WEAPON_GROUP_KEYS}
              value={view.weaponGroup}
              onChange={(weaponGroup) => setViewSettings({ ...view, weaponGroup })}
            />
            <GroupPicker
              label="Armor"
              keys={ARMOR_GROUP_KEYS}
              value={view.armorGroup}
              onChange={(armorGroup) => setViewSettings({ ...view, armorGroup })}
            />
          </div>
        </section>

        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => setViewSettings(resetSortAndGrouping(view))}
        >
          Reset to defaults
        </Button>
      </PopoverContent>
    </Popover>
  );
}
