"use client";

import Image from "next/image";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon, Cancel01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import {
  categoryValues,
  matchingCategories,
  pendingPairValue,
  suggestFilters,
  type FilterCategory,
  type FilterChip,
  type FilterIndexEntry,
  type FilterValue,
} from "@/lib/weapons/filter-suggestions";
import { matchRank } from "@/lib/weapons/rank";
import type { AmmoTypeRef, DamageTypeRef } from "@/lib/weapons/types";
import { cn } from "@/lib/utils";

/** Drilled-in category lists run to ~900 perks; mount a page of them until the user types. */
const MAX_CATEGORY_VALUES = 100;

/** Chip colours by filter, from noeyarmory's filter pills. */
const TRAIT_CHIP = "bg-[rgb(57_148_229/0.7)] text-white";
const CHIP_TONE: Record<string, string> = {
  trait: TRAIT_CHIP,
  trait1: TRAIT_CHIP,
  trait2: TRAIT_CHIP,
  trait1DamagePerks: TRAIT_CHIP,
  trait2DamagePerks: TRAIT_CHIP,
  perkCombo: TRAIT_CHIP,
  group: TRAIT_CHIP,
  frame: TRAIT_CHIP,
  gear: TRAIT_CHIP,
};
const ELEMENT_CHIP: Record<string, string> = {
  Solar: "bg-[rgb(255_120_40/0.85)] text-white",
  Arc: "bg-[rgb(40_180_220/0.85)] text-white",
  Void: "bg-[rgb(125_88_194/0.85)] text-white",
  Stasis: "bg-[rgb(60_140_220/0.85)] text-white",
  Strand: "bg-[rgb(60_200_120/0.85)] text-white",
  Kinetic: "bg-[rgb(180_180_180/0.75)] text-white",
};
const AMMO_CHIP: Record<string, string> = {
  Primary: "bg-white/10 text-white",
  Special: "bg-[rgb(88_194_108/0.15)] text-white",
  Heavy: "bg-[rgb(125_88_194/0.15)] text-white",
};
const DEFAULT_CHIP = "bg-white/70 text-neutral-900";

/** Ammo glyphs are grey; tint them like the in-game HUD. */
const AMMO_TINT: Record<string, string> = {
  Primary: "bg-white",
  Special: "bg-[#58c26c]",
  Heavy: "bg-[#7d58c2]",
};

/** Element and ammo chips show the in-game glyph instead of "Element: Solar". */
function chipIcon(
  chip: FilterChip,
  damageTypes: readonly DamageTypeRef[] | undefined,
  ammoTypes: readonly AmmoTypeRef[] | undefined,
) {
  if (chip.param === "element") {
    const icon = damageTypes?.find((type) => type.name === chip.value)?.icon;
    if (!icon) return null;
    return (
      <Image
        className="size-4 shrink-0 brightness-0 invert"
        src={`https://www.bungie.net${icon}`}
        alt=""
        width={16}
        height={16}
        unoptimized
      />
    );
  }
  if (chip.param === "ammo") {
    const icon = ammoTypes?.find((type) => type.name === chip.value)?.icon;
    if (!icon) return null;
    const mask = `url("https://www.bungie.net${icon}") center / contain no-repeat`;
    return (
      <span
        aria-hidden
        className={cn("size-6 shrink-0", AMMO_TINT[chip.value] ?? "bg-white")}
        style={{ mask, WebkitMask: mask }}
      />
    );
  }
  return null;
}

function chipTone(chip: FilterChip): string {
  if (chip.param === "element") return ELEMENT_CHIP[chip.value] ?? DEFAULT_CHIP;
  if (chip.param === "ammo") return AMMO_CHIP[chip.value] ?? DEFAULT_CHIP;
  return CHIP_TONE[chip.param] ?? DEFAULT_CHIP;
}

type Item =
  | { kind: "value"; category: FilterCategory; value: FilterValue }
  | { kind: "category"; entry: FilterIndexEntry };

type Section = { heading?: string; items: Item[]; note?: string };

/**
 * Search input with the applied filters as chips inside it. Typing suggests
 * "Category: value" filters beneath it (noeyarmory's command palette); an empty
 * box lists the categories; picking a category browses its values.
 */
export function WeaponSearchBox({
  index,
  query,
  params,
  chips,
  onQuery,
  onAdd,
  onRemove,
  onClear,
  damageTypes,
  ammoTypes,
}: {
  index: readonly FilterIndexEntry[];
  query: string;
  params: URLSearchParams;
  chips: FilterChip[];
  onQuery: (text: string) => void;
  onAdd: (value: FilterValue, category: FilterCategory) => void;
  onRemove: (chip: FilterChip) => void;
  onClear: () => void;
  damageTypes?: readonly DamageTypeRef[];
  ammoTypes?: readonly AmmoTypeRef[];
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  // By param, not entry: a half-picked pair swaps its category's values.
  const [drillParam, setDrillParam] = useState<string | null>(null);
  const drill = drillParam
    ? (index.find((entry) => entry.category.param === drillParam) ?? null)
    : null;
  const [drillText, setDrillText] = useState("");
  const [active, setActive] = useState(0);
  const text = drill ? drillText : query;
  const pending = drillParam ? pendingPairValue(params, drillParam) : undefined;
  // The half-picked pair shows as the drill label instead of its own chip.
  const shownChips = pending
    ? chips.filter((chip) => chip.param !== drillParam)
    : chips;

  const sections = useMemo<Section[]>(() => {
    if (drill) {
      const { values, hidden } = categoryValues(
        drill,
        drillText,
        params,
        MAX_CATEGORY_VALUES,
      );
      return [
        {
          heading: pending ? `Rolls with ${pending}` : drill.category.label,
          items: values.map((value) => ({
            kind: "value",
            category: drill.category,
            value,
          })),
          note: hidden
            ? `${hidden.toLocaleString()} more — type to narrow`
            : drill.category.numeric && !values.length
              ? "Type a number"
              : undefined,
        },
      ];
    }
    const categories = matchingCategories(index, query).map((entry): Item => ({
      kind: "category",
      entry,
    }));
    const suggestions = suggestFilters(index, query, params).map(
      ({ category, value }): Item => ({ kind: "value", category, value }),
    );
    const q = query.trim();
    const browse = {
      heading: q ? "Browse filters" : "Filter by",
      items: categories,
    };
    // Typing a category's name ("frame", "ammo") means browsing it, so lead with it.
    const leadWithCategories =
      q.length >= 3 &&
      categories.some(
        (item) =>
          item.kind === "category" &&
          (matchRank(item.entry.category.label, q) ?? 9) <= 1,
      );
    return (
      leadWithCategories
        ? [browse, { items: suggestions }]
        : [{ items: suggestions }, browse]
    ).filter((section) => section.items.length);
  }, [drill, drillText, index, params, pending, query]);
  const items = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const expanded =
    open && sections.some((section) => section.items.length || section.note);
  // The top row is what Enter picks, so reset to it whenever the list changes.
  const [activeFor, setActiveFor] = useState(items);
  if (activeFor !== items) {
    setActiveFor(items);
    setActive(0);
  }
  useEffect(() => {
    if (expanded)
      document
        .getElementById(`${id}-option-${active}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, expanded, id]);

  function leaveDrill() {
    setDrillParam(null);
    setDrillText("");
  }
  function choose(item: Item) {
    if (item.kind === "category") {
      setDrillParam(item.entry.category.param);
      setDrillText("");
      if (query) onQuery("");
      return;
    }
    const { category } = item;
    const startsPair =
      category.pair && !pendingPairValue(params, category.param);
    onAdd(item.value, category);
    if (startsPair) {
      // Stay open on the same category for the pair's second pick.
      setDrillParam(category.param);
      setDrillText("");
      return;
    }
    leaveDrill();
    setOpen(false);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!open) setOpen(true);
        else setActive((i) => Math.min(i + 1, items.length - 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
        break;
      case "Enter":
        if (expanded && items[active]) {
          event.preventDefault();
          choose(items[active]);
        } else {
          setOpen(false);
        }
        break;
      case "Escape":
        // Step back one layer at a time: category → dropdown → typed text.
        if (drill) leaveDrill();
        else if (open) setOpen(false);
        else if (query) onQuery("");
        else break;
        event.preventDefault();
        break;
      case "Backspace":
        if (text || event.currentTarget.selectionStart !== 0) break;
        if (drill) leaveDrill();
        else if (chips.length) onRemove(chips[chips.length - 1]);
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  }

  const offsets = sections.map((_, s) =>
    sections
      .slice(0, s)
      .reduce((sum, section) => sum + section.items.length, 0),
  );
  return (
    <div
      className="relative min-w-0 flex-1"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
          leaveDrill();
        }
      }}
    >
      <div
        className="flex min-h-[42px] cursor-text flex-wrap items-center gap-1.5 border-y border-foreground/12 bg-foreground/8 px-4 py-1.5 transition-colors hover:border-foreground/20 focus-within:border-foreground/30"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            event.preventDefault();
            inputRef.current?.focus();
            setOpen(true);
          }
        }}
      >
        <HugeiconsIcon icon={Search01Icon} className="pointer-events-none size-4 shrink-0" />
        {shownChips.map((chip) => {
          const icon = chipIcon(chip, damageTypes, ammoTypes);
          return (
            <button
              key={`${chip.param}:${chip.value}`}
              type="button"
              className={cn(
                "flex h-7 max-w-full items-center gap-1 text-xs font-medium hover:brightness-125 focus-visible:outline-1",
                icon ? "pr-1.5 pl-1" : "px-2",
                chipTone(chip),
              )}
              onClick={() => onRemove(chip)}
              aria-label={`Remove ${chip.text}`}
              title={icon ? chip.text : undefined}
            >
              {icon ?? <span className="truncate">{chip.text}</span>}
              <HugeiconsIcon icon={Cancel01Icon} className="size-3 shrink-0" />
            </button>
          );
        })}
        {drill && (
          <span className="flex h-7 items-center bg-foreground/15 px-2 text-xs font-medium">
            {drill.category.label}
            {drill.category.numeric ? " >" : ":"}
            {pending && ` ${pending} +`}
          </span>
        )}
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label="Search weapons"
          aria-expanded={expanded}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={
            expanded && items[active] ? `${id}-option-${active}` : undefined
          }
          inputMode={drill?.category.numeric ? "numeric" : undefined}
          autoComplete="off"
          spellCheck={false}
          className="h-7 min-w-32 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-sm"
          placeholder={
            pending
              ? "Pick the second perk…"
              : drill?.category.numeric
                ? "Number…"
                : drill
                  ? `Search ${drill.category.label.toLowerCase()}…`
                  : chips.length
                    ? "Add a filter or search…"
                    : "Search"
          }
          value={text}
          onChange={(event) => {
            setOpen(true);
            if (drill) setDrillText(event.target.value);
            else onQuery(event.target.value);
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {(query || chips.length > 0) && !drill && (
          <button
            type="button"
            className="flex size-7 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-1"
            aria-label="Clear search and filters"
            onClick={() => {
              onClear();
              inputRef.current?.focus();
            }}
          >
            <HugeiconsIcon icon={Cancel01Icon} className="size-4" />
          </button>
        )}
      </div>
      {expanded && (
        <div
          id={`${id}-list`}
          role="listbox"
          aria-label="Filter suggestions"
          className="absolute top-full right-0 left-0 z-30 mt-1 max-h-[min(26rem,60dvh)] overflow-y-auto d2-glass p-1 text-sm"
          // Keep focus in the input while clicking rows.
          onMouseDown={(event) => event.preventDefault()}
        >
          {sections.map((section, s) => (
            <div key={s} role="presentation">
              {section.heading && (
                <div
                  role="presentation"
                  className={cn(
                    "px-2 pt-2 pb-1 text-[11px] font-medium tracking-wider text-muted-foreground uppercase",
                    s > 0 && "mt-1 border-t border-foreground/8",
                  )}
                >
                  {section.heading}
                </div>
              )}
              {section.items.map((item, j) => {
                const i = offsets[s] + j;
                return (
                  <div
                    key={
                      item.kind === "category"
                        ? `category:${item.entry.category.param}`
                        : `${item.category.param}:${item.value.param}:${item.value.value}`
                    }
                    id={`${id}-option-${i}`}
                    role="option"
                    aria-selected={i === active}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 px-2 py-1.5 text-xs",
                      i === active && "bg-foreground/10",
                    )}
                    onMouseMove={() => i !== active && setActive(i)}
                    onClick={() => choose(item)}
                  >
                    {item.kind === "category" ? (
                      <>
                        <span className="flex-1">
                          {item.entry.category.label}
                        </span>
                        {!item.entry.category.numeric && (
                          <span className="text-muted-foreground tabular-nums">
                            {item.entry.values.length.toLocaleString()}
                          </span>
                        )}
                        <HugeiconsIcon icon={ArrowRight01Icon} className="size-3 text-muted-foreground" />
                      </>
                    ) : (
                      <>
                        <span className="flex min-w-0 flex-1 items-baseline gap-2">
                          {!drill && (
                            <span className="shrink-0">
                              {item.category.label}
                              {!item.category.numeric && ":"}
                            </span>
                          )}
                          <span
                            className={cn(
                              "truncate",
                              !drill && "text-muted-foreground",
                            )}
                          >
                            {item.value.label}
                          </span>
                        </span>
                        {item.value.count != null && (
                          <span className="text-muted-foreground tabular-nums">
                            {item.value.count.toLocaleString()}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
              {section.note && (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">
                  {section.note}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
