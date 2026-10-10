"use client";

import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SetPickerMenu } from "@/components/set-menu";
import { ArmorThumb } from "@/components/armor-thumb";
import { FilterMultiselect } from "@/components/armor-table/filter-multiselect";
import { StatGlyph } from "@/components/stat-glyph";
import type { ArmorPiece } from "@/lib/armory/normalize";
import type { ArmorSetInfo, SetSlotIcon } from "@/lib/armory/sets";
import {
  archetypeCounts,
  coveredSlots,
  setArchetypeGrid,
  twoPlusTwoSplits,
  type SetGridCell,
} from "@/lib/armory/set-grid";
import {
  ARMOR_SLOTS,
  SLOT_LABELS,
  STAT_DISPLAY_ORDER,
  STAT_LABELS,
  STAT_ORDER,
  type ArmorSlot,
  type StatIconMap,
} from "@/lib/armory/stats";
import type { ArmorArchetype } from "@/lib/armory/archetypes";
import { cn } from "@/lib/utils";

/** Inset the menu so item text lines up with the trigger's and highlights don't touch the edges. */
const MENU_CLASS = "p-1";
const MENU_ITEM_CLASS = "pl-2.5";

/** The two sets' colours: the first in the positive green, the second in the set-badge blue. */
const FIRST = { fill: "bg-positive/20", border: "border-positive/60", swatch: "bg-positive/70" };
const SECOND = { fill: "bg-[#41a6ff]/25", border: "border-[#41a6ff]/60", swatch: "bg-[#41a6ff]/80" };

type SlotLooks = Partial<Record<ArmorSlot, SetSlotIcon>>;

/** Bungie's generic "Exotic Armor" icon (DestinyInventoryItemDefinition 319240191). */
const EXOTIC_PLACEHOLDER_ICON = "/common/destiny2_content/icons/f30063b2d2c46c41f7ca7552eaec8bc9.jpg";

/**
 * The roll-grid modal: for one archetype, how many pieces of a set you own per slot ×
 * tertiary stat, and their tuned stats — optionally side by side with a second set, with
 * the slots an exotic can take while the two still make a 2pc + 2pc. Opens on `initialSetHash`; the set can be switched
 * without closing it. One instance serves the whole set list.
 */
export function SetGridDialog({
  open,
  onOpenChange,
  initialSetHash,
  sets,
  pieces,
  archetypes,
  statIcons,
  getSlotIcons,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The set it opens on (the row whose grid button was pressed). */
  initialSetHash: number;
  /** Every set in the pool, pinned first then the list's sort — the set pickers' order. */
  sets: readonly ArmorSetInfo[];
  /** The optimizer pool's pieces (any set — filtered inside). */
  pieces: readonly ArmorPiece[];
  archetypes: readonly ArmorArchetype[];
  statIcons: StatIconMap;
  /** The set's own thumbnail per slot (row headers). */
  getSlotIcons: (setHash: number) => SlotLooks;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] gap-4 overflow-y-auto p-5 sm:max-w-3xl">
        {/* Mounted only while open, so each open starts on the pressed row's set. */}
        <SetGridBody
          initialSetHash={initialSetHash}
          sets={sets}
          pieces={pieces}
          archetypes={archetypes}
          statIcons={statIcons}
          getSlotIcons={getSlotIcons}
        />
      </DialogContent>
    </Dialog>
  );
}

/** The set's thumbnails per slot, falling back to an owned piece's icon. */
function useSlotLooks(
  setHash: number | null,
  pieces: readonly ArmorPiece[],
  getSlotIcons: (setHash: number) => SlotLooks,
): SlotLooks {
  return useMemo(() => {
    if (setHash === null) return {};
    const out = { ...getSlotIcons(setHash) };
    for (const p of pieces) {
      if (p.setHash === setHash && p.icon && !out[p.slot]) {
        out[p.slot] = { icon: p.icon, watermark: p.watermark };
      }
    }
    return out;
  }, [setHash, pieces, getSlotIcons]);
}

function SetGridBody({
  initialSetHash,
  sets,
  pieces,
  archetypes,
  statIcons,
  getSlotIcons,
}: {
  initialSetHash: number;
  sets: readonly ArmorSetInfo[];
  pieces: readonly ArmorPiece[];
  archetypes: readonly ArmorArchetype[];
  statIcons: StatIconMap;
  getSlotIcons: (setHash: number) => SlotLooks;
}) {
  const [setPick, setSetPick] = useState(initialSetHash);
  const set = sets.find((s) => s.setHash === setPick) ?? sets[0];
  const [comparePick, setComparePick] = useState<number | null>(null);
  const other =
    comparePick === null
      ? undefined
      : sets.find((s) => s.setHash === comparePick && s.setHash !== set?.setHash);
  const otherHash = other?.setHash ?? null;

  const setHash = set?.setHash ?? initialSetHash;
  const looks = useSlotLooks(setHash, pieces, getSlotIcons);
  const otherLooks = useSlotLooks(otherHash, pieces, getSlotIcons);

  const counts = useMemo(() => archetypeCounts(pieces, setHash), [pieces, setHash]);
  const otherCounts = useMemo(
    () => (otherHash === null ? new Map<string, number>() : archetypeCounts(pieces, otherHash)),
    [pieces, otherHash],
  );
  // Only archetypes owned in the set(s), most pieces first.
  const ordered = useMemo(() => {
    const total = (name: string) => (counts.get(name) ?? 0) + (otherCounts.get(name) ?? 0);
    return archetypes
      .filter((a) => total(a.name) > 0)
      .sort((a, b) => total(b.name) - total(a.name) || a.name.localeCompare(b.name));
  }, [archetypes, counts, otherCounts]);
  const [archetypeName, setArchetypeName] = useState(ordered[0]?.name ?? "");
  const archetype = ordered.find((a) => a.name === archetypeName) ?? ordered[0];

  // Only tuned stats owned in the set(s) for this archetype; picks it lacks are ignored,
  // and nothing left picked means any tuning.
  const ownedTuned = useMemo(() => {
    const out = new Set<number>();
    for (const p of pieces) {
      const inSets = p.setHash === setHash || (otherHash !== null && p.setHash === otherHash);
      if (inSets && p.archetype === archetype?.name && p.tunedStat !== undefined) {
        out.add(p.tunedStat);
      }
    }
    return out;
  }, [pieces, setHash, otherHash, archetype]);
  const [tuningPicks, setTuningPicks] = useState<number[]>([]);
  const tuned = useMemo(
    () => tuningPicks.filter((t) => ownedTuned.has(t)),
    [tuningPicks, ownedTuned],
  );

  const grid = useMemo(
    () => (archetype ? setArchetypeGrid(pieces, setHash, archetype, tuned) : null),
    [pieces, setHash, archetype, tuned],
  );
  const otherGrid = useMemo(
    () =>
      archetype && otherHash !== null
        ? setArchetypeGrid(pieces, otherHash, archetype, tuned)
        : null,
    [pieces, otherHash, archetype, tuned],
  );

  const setOptions = sets.map((s) => ({ value: s.setHash, label: s.name, count: s.ownedCount }));
  const setSelect = (
    <SetPickerMenu
      options={setOptions}
      value={setHash}
      onChange={(v) => v !== null && setSetPick(v)}
      className="w-full"
    />
  );
  const compareSelect = (
    <SetPickerMenu
      label="Compared set"
      options={setOptions.filter((o) => o.value !== setHash)}
      value={other?.setHash ?? null}
      onChange={setComparePick}
      noneLabel="No comparison"
      placeholder="Compare with another set…"
      className="w-full"
    />
  );

  if (!set) return null;
  const header = (
    <DialogHeader className="pr-8">
      <DialogTitle>
        {other ? `${set.name} vs ${other.name}` : set.name}
        {archetype && ` / ${archetype.name}`}
      </DialogTitle>
      <DialogDescription>
        Your pieces by slot and tertiary stat, with the tuned stats they carry.
      </DialogDescription>
    </DialogHeader>
  );
  if (!archetype || !grid) {
    return (
      <>
        {header}
        <div className="grid grid-cols-2 gap-2">
          {setSelect}
          {compareSelect}
        </div>
        <p className="text-muted-foreground text-sm">
          No {set.name} pieces with an archetype in your pool.
        </p>
      </>
    );
  }

  const archetypeItems = Object.fromEntries(
    ordered.map((a) => [
      a.name,
      other
        ? `${a.name} (${counts.get(a.name) ?? 0} · ${otherCounts.get(a.name) ?? 0})`
        : `${a.name} (${counts.get(a.name) ?? 0})`,
    ]),
  );
  const tuningOptions = STAT_DISPLAY_ORDER.map((key) => STAT_ORDER.indexOf(key))
    .filter((stat) => ownedTuned.has(stat))
    .map((stat) => ({ value: stat, label: `${STAT_LABELS[STAT_ORDER[stat]]} tuning` }));

  return (
    <>
      {header}
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          {setSelect}
          {compareSelect}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Select
            items={archetypeItems}
            value={archetype.name}
            onValueChange={(v) => v != null && setArchetypeName(String(v))}
          >
            <SelectTrigger className="w-full" aria-label="Archetype">
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false} className={MENU_CLASS}>
              {ordered.map((a) => (
                <SelectItem key={a.name} value={a.name} className={MENU_ITEM_CLASS}>
                  {archetypeItems[a.name]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FilterMultiselect
            label="Tuning"
            allLabel="Any tuning"
            options={tuningOptions}
            value={tuned}
            onChange={setTuningPicks}
            className="w-full"
          />
        </div>
        {other && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <Swatch className={FIRST.swatch} name={set.name} />
            <Swatch className={SECOND.swatch} name={other.name} />
          </div>
        )}
      </div>

      <div
        className={cn(
          "grid items-center gap-x-2 gap-y-2",
          other
            ? "grid-cols-[auto_repeat(4,minmax(0,1fr))_auto]"
            : "grid-cols-[auto_repeat(4,minmax(0,1fr))]",
        )}
        role="table"
        aria-label={`${other ? `${set.name} and ${other.name}` : set.name} ${archetype.name} pieces by slot and tertiary stat`}
      >
        <div role="row" className="col-span-full grid grid-cols-subgrid items-center">
        <span className="text-muted-foreground text-xs" role="columnheader">
          Tertiary
        </span>
        {grid.columns.map((s) => (
          <span
            key={s}
            role="columnheader"
            className="text-muted-foreground flex items-center justify-center gap-1 text-xs"
          >
            <StatGlyph src={statIcons[STAT_ORDER[s]]} label={STAT_LABELS[STAT_ORDER[s]]} plain />
            {STAT_LABELS[STAT_ORDER[s]]}
          </span>
        ))}
        {other && <span aria-hidden />}
        </div>
        {grid.rows.map((row, r) => {
          const slot = ARMOR_SLOTS[r];
          return (
            <div key={r} role="row" className="col-span-full grid grid-cols-subgrid items-center">
              <SlotHeader slot={slot} look={looks[slot]} />
              {row.map((cell, c) => {
                const label = `${SLOT_LABELS[slot]}, ${STAT_LABELS[STAT_ORDER[grid.columns[c]]]} tertiary`;
                return otherGrid && other ? (
                  <SplitCell
                    key={grid.columns[c]}
                    first={cell}
                    second={otherGrid.rows[r][c]}
                    names={[set.name, other.name]}
                    statIcons={statIcons}
                    label={label}
                  />
                ) : (
                  <GridCell key={grid.columns[c]} cell={cell} statIcons={statIcons} label={label} />
                );
              })}
              {/* The compared set's thumbnail closes the row, on its own side. */}
              {other && <SlotHeader slot={slot} look={otherLooks[slot]} decorative />}
            </div>
          );
        })}
      </div>

      {other && otherGrid && (
        <ExoticSlots
          first={set.name}
          second={other.name}
          archetype={archetype.name}
          tunedLabel={
            tuned.length > 0
              ? tuned.map((t) => STAT_LABELS[STAT_ORDER[t]]).join(" or ")
              : undefined
          }
          coveredFirst={coveredSlots(grid)}
          coveredSecond={coveredSlots(otherGrid)}
        />
      )}
    </>
  );
}

function Swatch({ className, name }: { className: string; name: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className={cn("size-3 shrink-0", className)} aria-hidden />
      <span className="truncate">{name}</span>
    </span>
  );
}

/**
 * A set's thumbnail for the slot (named on hover), or the slot name. `decorative`: the
 * compared set's copy at the row's end — the row is already named by the first.
 */
function SlotHeader({
  slot,
  look,
  decorative = false,
}: {
  slot: ArmorSlot;
  look?: SetSlotIcon;
  decorative?: boolean;
}) {
  const name = SLOT_LABELS[slot];
  const a11y = decorative ? { "aria-hidden": true } : { role: "rowheader", "aria-label": name };
  if (!look) {
    return (
      <span {...a11y} className="text-sm">
        {name}
      </span>
    );
  }
  return (
    <span {...a11y} title={name} className="flex">
      <ArmorThumb icon={look.icon} watermark={look.watermark} alt={decorative ? "" : name} size={48} />
    </span>
  );
}

function tunedNames(tuned: number[]): string {
  return tuned.map((t) => STAT_LABELS[STAT_ORDER[t]]).join(", ");
}

function cellLabel(prefix: string, cell: SetGridCell): string {
  if (!cell.count) return `${prefix}: none owned`;
  const names = tunedNames(cell.tuned);
  return `${prefix}: ${cell.count} owned${names ? `, tuned ${names}` : ""}`;
}

/** The count and tuned-stat icons inside a filled cell. */
function CellContent({
  cell,
  statIcons,
  compact = false,
}: {
  cell: SetGridCell;
  statIcons: StatIconMap;
  compact?: boolean;
}) {
  if (!cell.count) return null;
  return (
    <>
      <span className={cn("font-medium tabular-nums", compact ? "text-xs" : "text-sm")}>
        {cell.count}
      </span>
      {cell.tuned.length > 0 && (
        <span className="flex flex-wrap justify-center gap-0.5" title={`Tuned: ${tunedNames(cell.tuned)}`}>
          {cell.tuned.map((t) => (
            <StatGlyph
              key={t}
              src={statIcons[STAT_ORDER[t]]}
              label={`Tuned ${STAT_LABELS[STAT_ORDER[t]]}`}
              className="size-3"
              plain
            />
          ))}
        </span>
      )}
    </>
  );
}

/** One slot × tertiary cell: filled with the owned count when any, the tuned stats below. */
function GridCell({
  cell,
  statIcons,
  label,
}: {
  cell: SetGridCell;
  statIcons: StatIconMap;
  label: string;
}) {
  return (
    <div
      role="cell"
      aria-label={cellLabel(label, cell)}
      className={cn(
        "flex h-14 flex-col items-center justify-center gap-1 border",
        cell.count ? cn(FIRST.border, FIRST.fill) : "border-foreground/15",
      )}
    >
      <CellContent cell={cell} statIcons={statIcons} />
    </div>
  );
}

/**
 * A compare-mode cell: one box in the colour of whichever set has pieces there; when both
 * do, split down the middle — the first set's colour and count on the left, the second's
 * on the right.
 */
function SplitCell({
  first,
  second,
  names,
  statIcons,
  label,
}: {
  first: SetGridCell;
  second: SetGridCell;
  names: [string, string];
  statIcons: StatIconMap;
  label: string;
}) {
  const ariaLabel = `${cellLabel(`${label}, ${names[0]}`, first)}; ${cellLabel(names[1], second)}`;
  const both = first.count > 0 && second.count > 0;
  if (!both) {
    const only = first.count > 0 ? first : second.count > 0 ? second : null;
    const look = first.count > 0 ? FIRST : SECOND;
    return (
      <div
        role="cell"
        aria-label={ariaLabel}
        className={cn(
          "flex h-14 flex-col items-center justify-center gap-1 border",
          only ? cn(look.border, look.fill) : "border-foreground/15",
        )}
      >
        {only && <CellContent cell={only} statIcons={statIcons} />}
      </div>
    );
  }
  return (
    <div
      role="cell"
      aria-label={ariaLabel}
      className="border-foreground/25 from-positive/20 grid h-14 grid-cols-2 border bg-linear-to-r from-50% to-[#41a6ff]/25 to-50%"
    >
      {[first, second].map((cell, i) => (
        <div key={i} className="flex min-w-0 flex-col items-center justify-center gap-0.5">
          <CellContent cell={cell} statIcons={statIcons} compact />
        </div>
      ))}
    </div>
  );
}

/**
 * Where the exotic can go: each slot that's left free by at least one 2pc + 2pc split of
 * the two sets, so wearing an exotic there still keeps both 2-piece bonuses.
 */
function ExoticSlots({
  first,
  second,
  archetype,
  tunedLabel,
  coveredFirst,
  coveredSecond,
}: {
  first: string;
  second: string;
  archetype: string;
  /** The tuning filter in effect, if any — coverage is counted under it. */
  tunedLabel?: string;
  coveredFirst: boolean[];
  coveredSecond: boolean[];
}) {
  const splits = twoPlusTwoSplits(coveredFirst, coveredSecond);
  const open = new Set(splits.map((s) => s.free));
  const nFirst = coveredFirst.filter(Boolean).length;
  const nSecond = coveredSecond.filter(Boolean).length;
  return (
    <div className="border-foreground/8 flex flex-col gap-2 border-t pt-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="d2-label">Exotic slot</span>
        {splits.length > 0 && (
          <span className="text-muted-foreground text-xs">Keeps both 2-piece bonuses</span>
        )}
      </div>
      {splits.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          No 2 + 2 split with {archetype} pieces
          {tunedLabel ? ` tuned to ${tunedLabel}` : ""}: {first} covers {nFirst} slot
          {nFirst === 1 ? "" : "s"} and {second} {nSecond}, and each needs two slots the
          other isn&apos;t using.
        </p>
      ) : (
        <ul className="grid grid-cols-5 gap-2" aria-label="Slots your exotic can take">
          {ARMOR_SLOTS.map((slot, i) => {
            const fits = open.has(i);
            return (
              <li
                key={slot}
                aria-label={`${SLOT_LABELS[slot]} exotic: ${fits ? "keeps both bonuses" : "breaks a bonus"}`}
                className={cn(
                  "flex h-10 min-w-0 items-center gap-2 border px-2.5 text-sm leading-5",
                  fits
                    ? "border-exotic-line/60 bg-exotic/15 text-exotic-line"
                    : "bg-foreground/4 text-muted-foreground border-transparent",
                )}
              >
                <ArmorThumb
                  icon={EXOTIC_PLACEHOLDER_ICON}
                  size={20}
                  className={cn(!fits && "opacity-35 grayscale")}
                />
                <span className="truncate">{SLOT_LABELS[slot]}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
