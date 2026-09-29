"use client";

import { useState, type CSSProperties, type DragEvent } from "react";
import Image from "next/image";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  ArrowDown02Icon,
  ArrowUp01Icon,
  Cancel01Icon,
  DragDropVerticalIcon,
  InformationCircleIcon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TooltipLabel } from "@/components/ui/tooltip";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import {
  addCombo,
  defaultPriority,
  isPoolPick,
  leftColumn,
  masterworkColumn,
  orderColumns as orderColumnIndexes,
  poolColumns as poolColumnIndexes,
  rightColumn,
  samePick,
  splitPicks,
  type PerkCombo,
  type PerkFinderColumn,
  type PerkFinderOption,
  type PerkFinderResult,
  type PerkMatchMode,
  type PerkPick,
  type PerkPriority,
} from "@/lib/inventory/perk-finder";
import { cn } from "@/lib/utils";
import { TAG_ICONS } from "./tag-icons";

const MODES: { value: PerkMatchMode; label: string; help: string }[] = [
  {
    value: "strict",
    label: "Every combo",
    help: "Stricter. Every combo of your left and right perks should be on one copy, so you'll keep more copies.",
  },
  {
    value: "loose",
    label: "Every perk",
    help: "Looser. Each left and right perk you picked just has to be on some copy you keep, so you'll keep fewer copies.",
  },
  {
    value: "combos",
    label: "My combos",
    help: "Choose exactly which left and right perks you want together. Pick a left perk and a right perk to make each combo.",
  },
];

const plural = (count: number, one: string, other: string) => (count === 1 ? one : other);

/**
 * Pick the perks you want from every perk the compared copies can roll, then see the
 * fewest copies to keep for them. In My combos mode left and right perks are picked in
 * pairs instead, to make combos.
 */
export function PerkFinder({
  columns,
  priority,
  combos,
  onCombosChange,
  rankingEnabled,
  onRankingEnabledChange,
  mode,
  result,
  slow,
  onTogglePerk,
  onPriorityChange,
  onModeChange,
  onClear,
  junkCount,
  onTagJunk,
}: {
  columns: PerkFinderColumn[];
  /** The picked perks, most important first. */
  priority: PerkPriority;
  /** The left + right combos the user made, for My combos. */
  combos: PerkCombo[];
  onCombosChange: (combos: PerkCombo[]) => void;
  /** Whether the user's own ranking of their picks is on. */
  rankingEnabled: boolean;
  onRankingEnabledChange: (enabled: boolean) => void;
  mode: PerkMatchMode;
  result: PerkFinderResult;
  /** A search for the latest picks has been running a while; `result` is for earlier ones. */
  slow: boolean;
  onTogglePerk: (pick: PerkPick) => void;
  onPriorityChange: (priority: PerkPriority) => void;
  onModeChange: (mode: PerkMatchMode) => void;
  onClear: () => void;
  /** How many copies not being kept can be tagged Junk. */
  junkCount: number;
  onTagJunk: () => void;
}) {
  const poolColumns = columns.filter((c) => poolColumnIndexes.includes(c.index));
  const orderColumns = orderColumnIndexes
    .map((index) => columns.find((c) => c.index === index))
    .filter((c) => c !== undefined);

  const comboMode = mode === "combos";
  // In combo mode, the first half of the combo being made.
  const [pendingPick, setPendingPick] = useState<PerkPick>();
  const pending = comboMode ? pendingPick : undefined;
  // Combos to point out, by index, while hovering a combo.
  const [hoveredCombos, setHoveredCombos] = useState<number[]>([]);

  const optionFor = (pick: PerkPick) =>
    columns.find((c) => c.index === pick.column)?.options.find((o) => o.hash === pick.hash);

  // Masterwork, barrel, and magazine picks ranked above a left or right perk decide
  // which copies are kept, rather than only sorting them.
  const promotedNames = splitPicks(priority, rankingEnabled && !comboMode)
    .poolPicks.filter((pick) => !isPoolPick(pick))
    .map((pick) => optionFor(pick)?.name)
    .filter((name) => name !== undefined);

  // Pick one half of a combo, then the other half from the other column to make it.
  const pickForCombo = (pick: PerkPick) => {
    if (!pending || pending.column === pick.column) {
      setPendingPick(pending && samePick(pending, pick) ? undefined : pick);
      return;
    }
    onCombosChange(addCombo(combos, pick.column === leftColumn ? [pick, pending] : [pending, pick]));
    setPendingPick(undefined);
  };

  const clear = () => {
    setPendingPick(undefined);
    onClear();
  };

  const renderColumn = (column: PerkFinderColumn) => (
    <div key={column.index} className="flex w-44 shrink-0 flex-col gap-1">
      <p className="d2-label">{columnLabel(column)}</p>
      {column.options.map((option) => {
        const pick = { column: column.index, hash: option.hash };
        const makesCombos = comboMode && isPoolPick(pick);
        // The combos this perk is in, by index.
        const inCombos = makesCombos
          ? combos.flatMap((combo, i) => (combo.some((p) => samePick(p, pick)) ? [i] : []))
          : [];
        const selected = makesCombos ? inCombos.length > 0 : priority.some((p) => samePick(p, pick));
        const isPending = pending !== undefined && samePick(pending, pick);
        const copies =
          column.index === masterworkColumn
            ? `${option.count} ${plural(option.count, "copy has", "copies have")} this masterwork`
            : `${option.count} ${plural(option.count, "copy", "copies")} can roll this`;
        return (
          <button
            key={option.hash}
            type="button"
            aria-pressed={selected || isPending}
            onClick={() => (makesCombos ? pickForCombo(pick) : onTogglePerk(pick))}
            style={
              makesCombos && (isPending || inCombos.length > 0)
                ? comboFill(isPending ? [combos.length] : inCombos)
                : undefined
            }
            className={cn(
              "d2-hover-ring flex h-8 items-center gap-2 pr-2 pl-1 text-left text-[13px] outline-none focus-visible:d2-tile-selected",
              makesCombos
                ? "bg-foreground/5"
                : selected
                  ? "bg-[#305f8e] text-white"
                  : "bg-foreground/5 hover:bg-foreground/10",
              isPending && "animate-pulse",
              inCombos.some((i) => hoveredCombos.includes(i)) && "brightness-150",
            )}
          >
            <PerkIcon option={option} />
            <span className="min-w-0 flex-1 truncate">{option.name}</span>
            {inCombos.length > 0 && (
              <span
                className="flex shrink-0 gap-0.5"
                title={`In ${inCombos.length} ${plural(inCombos.length, "combo", "combos")}`}
              >
                {inCombos.map((i) => (
                  <ComboDot key={i} index={i} />
                ))}
              </span>
            )}
            <span className="shrink-0 text-xs tabular-nums opacity-60" title={copies}>
              {option.count}
            </span>
          </button>
        );
      })}
    </div>
  );

  return (
    <section className="border-foreground/12 flex flex-col gap-3 border-b px-4 py-3" aria-label="Find a roll">
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm">Pick the perks you want, then we&apos;ll find the fewest copies to keep.</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex gap-1" role="radiogroup" aria-label="Match">
            {MODES.map((m) => (
              <TooltipLabel key={m.value} label={<span className="block max-w-64">{m.help}</span>}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={mode === m.value}
                  onClick={() => onModeChange(m.value)}
                  className={cn(
                    "d2-hover-ring h-7 px-2.5 text-xs outline-none focus-visible:d2-tile-selected",
                    mode === m.value ? "bg-foreground text-background" : "bg-foreground/10",
                  )}
                >
                  {m.label}
                </button>
              </TooltipLabel>
            ))}
          </div>
          {result.pickedCount > 0 && (
            <>
              {/* Combos all count equally, so there's nothing to rank. */}
              {!comboMode && (
                <PriorityMenu
                  priority={priority}
                  rankingEnabled={rankingEnabled}
                  onRankingEnabledChange={onRankingEnabledChange}
                  columns={columns}
                  onPriorityChange={onPriorityChange}
                />
              )}
              {junkCount > 0 && (
                <TooltipLabel label="Tags every copy you don't need to keep as Junk. Copies tagged Favorite or Keep are skipped.">
                  <Button size="sm" variant="default" disabled={slow} onClick={onTagJunk}>
                    <HugeiconsIcon icon={TAG_ICONS.junk} aria-hidden />
                    Tag {junkCount} other {plural(junkCount, "copy", "copies")} as Junk
                  </Button>
                </TooltipLabel>
              )}
              <Button size="sm" variant="ghost" onClick={clear}>
                Clear
              </Button>
            </>
          )}
        </div>
      </div>

      {/* One grid for both sections, so their help text and perk columns share rows and the column headers line up. */}
      <div className="grid gap-x-8 gap-y-2 lg:grid-cols-[auto_auto] lg:justify-start">
        {/* Masterwork, barrel, and magazine first, then perks, like the game's perk grid. */}
        {orderColumns.length > 0 && (
          <div className="row-span-2 grid grid-rows-subgrid">
            {promotedNames.length > 0 ? (
              <p className="flex max-w-xl items-start gap-1.5 text-xs">
                <HugeiconsIcon icon={InformationCircleIcon} className="mt-px size-3.5 shrink-0" aria-hidden />
                {new Intl.ListFormat("en").format(promotedNames)}{" "}
                {plural(promotedNames.length, "is", "are")} ranked above a left or right perk, so{" "}
                {plural(promotedNames.length, "it also decides", "they also decide")} which copies you keep, not
                just their order.
              </p>
            ) : (
              <p className="text-muted-foreground max-w-xl text-xs">
                These sort the copies you keep, so ones with more of what you want come first. Rank one above a
                perk to make it decide which copies you keep too.
              </p>
            )}
            <div className="flex gap-2">{orderColumns.map(renderColumn)}</div>
          </div>
        )}
        <div className="row-span-2 grid grid-rows-subgrid">
          <p className="text-muted-foreground max-w-xl text-xs">
            {comboMode
              ? "Pick a left perk and a right perk to make a combo. Pick a perk again to use it in another combo."
              : "These decide which copies you keep."}
          </p>
          <div className="flex gap-2">{poolColumns.map(renderColumn)}</div>
        </div>
      </div>

      {comboMode && (combos.length > 0 || pending) && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Your combos">
          {combos.map((combo, i) => (
            <li
              key={combo.map((p) => p.hash).join("-")}
              className={cn(
                "flex h-8 items-center gap-1.5 pr-1 pl-2 text-[13px]",
                hoveredCombos.includes(i) && "brightness-150",
              )}
              style={comboFill([i])}
              onPointerEnter={() => setHoveredCombos([i])}
              onPointerLeave={() => setHoveredCombos([])}
            >
              <ComboDot index={i} />
              <ComboPerk option={optionFor(combo[0])} />
              <span className="opacity-60">+</span>
              <ComboPerk option={optionFor(combo[1])} />
              <button
                type="button"
                aria-label="Remove combo"
                title="Remove combo"
                onClick={() => {
                  onCombosChange(combos.filter((c) => c !== combo));
                  setHoveredCombos([]);
                }}
                className="flex size-6 items-center justify-center opacity-60 outline-none hover:opacity-100 focus-visible:d2-tile-selected"
              >
                <HugeiconsIcon icon={Cancel01Icon} className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
          {pending && (
            <li className="flex h-8 items-center gap-1.5 px-2 text-[13px]" style={comboFill([combos.length])}>
              {/* The colour it'll get once it's made. */}
              <ComboDot index={combos.length} />
              <ComboPerk option={optionFor(pending)} />
              <span className="opacity-60">+</span>
              <span className="text-muted-foreground italic">
                pick a {pending.column === leftColumn ? "right" : "left"} perk
              </span>
            </li>
          )}
        </ul>
      )}

      {(result.pickedCount > 0 || slow) && (
        <div className="bg-foreground/5 flex items-start gap-2 px-3 py-2 text-[13px]" role="status">
          <HugeiconsIcon icon={InformationCircleIcon} className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="flex flex-col gap-0.5">
            {slow && <span>Finding the fewest copies for your picks…</span>}
            {result.poolPickCount === 0 && (
              <span>
                {comboMode
                  ? "Make a left and right perk combo to choose which copies to keep."
                  : "Pick left or right perks to choose which copies to keep."}
              </span>
            )}
            {result.keep.size > 0 && (
              <span>
                Keep {result.keep.size} {plural(result.keep.size, "copy", "copies")} to get{" "}
                {mode === "strict"
                  ? "every combo of your left and right perks."
                  : mode === "loose"
                    ? "every left and right perk you picked."
                    : "every combo you made."}
              </span>
            )}
            {result.partialRequirements > 0 && (
              <span className="text-muted-foreground text-xs">
                {result.partialRequirements}{" "}
                {plural(result.partialRequirements, "combo isn't", "combos aren't")} fully on any copy, so the
                closest {plural(result.partialRequirements, "copy", "copies")} by your priorities{" "}
                {plural(result.partialRequirements, "is", "are")} kept.
              </span>
            )}
            {result.approximate && (
              <span className="text-muted-foreground text-xs">
                There were too many combinations to check them all, so fewer copies might do.
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/** A column's display name. */
function columnLabel(column: PerkFinderColumn) {
  if (column.index === leftColumn) return "Left perk";
  if (column.index === rightColumn) return "Right perk";
  if (column.index === masterworkColumn) return "Masterwork";
  return column.typeName;
}

/**
 * A button that opens the ranking menu. Ranking is off until turned on; then picks can
 * be reordered (drag, or the arrows), most important first. Masterwork, barrel, and
 * magazine picks ranked below every left and right perk only sort.
 */
function PriorityMenu({
  priority,
  rankingEnabled,
  onRankingEnabledChange,
  columns,
  onPriorityChange,
}: {
  priority: PerkPriority;
  rankingEnabled: boolean;
  onRankingEnabledChange: (enabled: boolean) => void;
  columns: PerkFinderColumn[];
  onPriorityChange: (priority: PerkPriority) => void;
}) {
  const defaultOrder = defaultPriority(priority, columns);
  const isDefaultOrder = defaultOrder.every((pick, i) => pick === priority[i]);
  return (
    <Popover>
      <PopoverTrigger render={<Button size="sm" variant="default" aria-label="Prioritize perks" />}>
        Prioritize perks{rankingEnabled && " (on)"}
        <HugeiconsIcon icon={ArrowDown02Icon} aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-3 p-3 text-sm">
        <label className="flex items-center gap-2">
          <Checkbox checked={rankingEnabled} onCheckedChange={(checked) => onRankingEnabledChange(checked)} />
          Rank your picks
        </label>
        <p className="text-muted-foreground text-xs">
          {rankingEnabled
            ? "Most important first. A masterwork, barrel, or magazine ranked above a left or right perk also decides which copies you keep."
            : "Off: your left and right perks count equally, and your masterwork, barrel, and magazine picks count equally."}
        </p>
        {rankingEnabled && (
          <>
            <RankedList picks={priority} columns={columns} onChange={onPriorityChange} />
            <Button
              size="sm"
              variant="ghost"
              className="self-start"
              disabled={isDefaultOrder}
              onClick={() => onPriorityChange(defaultOrder)}
            >
              Reset to default
            </Button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Picks in rank order, reordered by dragging or the arrow buttons. */
function RankedList({
  picks,
  columns,
  onChange,
}: {
  picks: PerkPick[];
  columns: PerkFinderColumn[];
  onChange: (picks: PerkPick[]) => void;
}) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  /** Insertion slot 0…length (before that index / after the last). */
  const [insertBefore, setInsertBefore] = useState<number | null>(null);
  if (picks.length === 0) return null;

  const { orderPicks } = splitPicks(picks, true);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= picks.length) return;
    const next = [...picks];
    const [pick] = next.splice(from, 1);
    next.splice(to, 0, pick!);
    onChange(next);
  };
  const slotFromPointer = (e: DragEvent, index: number) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return e.clientY < rect.top + rect.height / 2 ? index : index + 1;
  };
  const clearDrag = () => {
    setDragFrom(null);
    setInsertBefore(null);
  };
  const drop = (e: DragEvent, index: number) => {
    e.preventDefault();
    const slot = insertBefore ?? slotFromPointer(e, index);
    const from = dragFrom;
    clearDrag();
    if (from === null || slot === from || slot === from + 1) return;
    move(from, from < slot ? slot - 1 : slot);
  };
  const showSlot = (slot: number) =>
    dragFrom !== null && insertBefore === slot && slot !== dragFrom && slot !== dragFrom + 1;

  return (
    <ol className="flex max-h-80 flex-col overflow-y-auto">
      {picks.map((pick, i) => {
        const column = columns.find((c) => c.index === pick.column);
        const option = column?.options.find((o) => o.hash === pick.hash);
        if (!column || !option) return null;
        const sortsOnly = orderPicks.includes(pick);
        return (
          <li key={`${pick.column}-${pick.hash}`} className="relative">
            {showSlot(i) && (
              <div aria-hidden className="bg-foreground absolute inset-x-1 top-0 z-10 h-0.5 -translate-y-1/2" />
            )}
            <div
              draggable
              onDragStart={(e) => {
                setDragFrom(i);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", String(i));
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setInsertBefore(slotFromPointer(e, i));
              }}
              onDrop={(e) => drop(e, i)}
              onDragEnd={clearDrag}
              className={cn(
                "group/row hover:bg-accent flex h-10 cursor-grab items-center gap-1.5 pr-0.5 pl-1 active:cursor-grabbing",
                dragFrom === i && "bg-accent opacity-60",
              )}
            >
              <HugeiconsIcon
                icon={DragDropVerticalIcon}
                strokeWidth={2}
                className="text-muted-foreground size-3.5 shrink-0"
                aria-hidden
              />
              <span className="text-muted-foreground w-4 shrink-0 text-right text-xs tabular-nums">{i + 1}</span>
              <PerkIcon option={option} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px]">{option.name}</span>
                <span className="text-muted-foreground flex gap-1.5 text-[11px]">
                  {columnLabel(column)}
                  {sortsOnly && (
                    <span title="Ranked below every left and right perk, so this only sorts the copies you keep. Drag it above a perk to make it decide which copies you keep.">
                      (sorts only)
                    </span>
                  )}
                </span>
              </span>
              <button
                type="button"
                aria-label={`Move ${option.name} up`}
                disabled={i === 0}
                onClick={() => move(i, i - 1)}
                className="text-muted-foreground hover:text-foreground flex size-6 items-center justify-center outline-none focus-visible:ring-1 disabled:opacity-30"
              >
                <HugeiconsIcon icon={ArrowUp01Icon} strokeWidth={2} className="size-3.5" aria-hidden />
              </button>
              <button
                type="button"
                aria-label={`Move ${option.name} down`}
                disabled={i === picks.length - 1}
                onClick={() => move(i, i + 1)}
                className="text-muted-foreground hover:text-foreground flex size-6 items-center justify-center outline-none focus-visible:ring-1 disabled:opacity-30"
              >
                <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} className="size-3.5" aria-hidden />
              </button>
            </div>
            {i === picks.length - 1 && showSlot(picks.length) && (
              <div aria-hidden className="bg-foreground absolute inset-x-1 bottom-0 z-10 h-0.5 translate-y-1/2" />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Colours that tell combos apart; they repeat after the last one. */
const COMBO_COLORS = ["#4fc3f7", "#81c784", "#f06292", "#ffd54f", "#ba68c8", "#4db6ac", "#e57373", "#90a4ae"];
const comboColor = (index: number) => COMBO_COLORS[index % COMBO_COLORS.length]!;

/** A tint of a perk's combo colour; a perk in several combos gets their colours side by side. */
function comboFill(inCombos: number[]): CSSProperties {
  const tint = (i: number) => `color-mix(in srgb, ${comboColor(i)} 28%, transparent)`;
  if (inCombos.length === 1) return { backgroundColor: tint(inCombos[0]!) };
  const share = 100 / inCombos.length;
  const stops = inCombos.map((i, n) => `${tint(i)} ${n * share}% ${(n + 1) * share}%`);
  return { backgroundImage: `linear-gradient(90deg, ${stops.join(", ")})` };
}

function ComboDot({ index }: { index: number }) {
  return <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: comboColor(index) }} />;
}

function ComboPerk({ option }: { option: PerkFinderOption | undefined }) {
  if (!option) return null;
  return (
    <span className="flex items-center gap-1.5">
      <PerkIcon option={option} />
      {option.name}
    </span>
  );
}

function PerkIcon({ option }: { option: PerkFinderOption }) {
  return option.icon ? (
    <Image
      src={`${BUNGIE_IMAGE_BASE}${option.icon}`}
      alt=""
      width={24}
      height={24}
      className="size-6 shrink-0"
      unoptimized
    />
  ) : (
    <span className="bg-muted size-6 shrink-0" />
  );
}
