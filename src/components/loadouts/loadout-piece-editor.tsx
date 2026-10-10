"use client";

import { memo, useCallback, useMemo } from "react";
import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import Image from "next/image";
import { armorPipTier, type ArmorPiece, type ArmorSocket } from "@/lib/armory/normalize";
import { isFullyMasterworked } from "@/lib/armory/masterwork";
import { SLOT_LABELS } from "@/lib/armory/stats";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import { ArmorThumb, ItemWatermark } from "@/components/armor-thumb";
import { PowerValue } from "@/components/power-value";
import type { ModOption, ModOptionCatalog } from "@/lib/loadouts/mod-options";
import {
  chosenCount,
  cycleModStack,
  toggleExclusiveMod,
  pieceEnergyUsed,
} from "@/lib/loadouts/mod-placement";
import { TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<ArmorSocket["kind"], string> = {
  general: "Stat mod",
  other: "Armor mod",
  tuning: "Tuning",
  artifice: "Artifice",
};

/** A Bungie icon, or a muted square when the item has none. */
export function ItemIcon({
  icon,
  watermark,
  className,
  size = 32,
}: {
  icon?: string;
  watermark?: string;
  className?: string;
  size?: 24 | 32 | 40 | 48 | 64;
}) {
  const sizeClass =
    size === 64
      ? "size-16"
      : size === 48
        ? "size-12"
        : size === 40
          ? "size-10"
          : size === 24
            ? "size-6"
            : "size-8";
  return (
    <span
      className={cn(
        "relative inline-block shrink-0 overflow-hidden rounded-none",
        sizeClass,
        className,
      )}
    >
      {icon ? (
        <Image
          src={`${BUNGIE_IMAGE_BASE}${icon}`}
          alt=""
          width={size}
          height={size}
          className="size-full"
          unoptimized
        />
      ) : (
        <span className="bg-muted block size-full" aria-hidden />
      )}
      {watermark && <ItemWatermark watermark={watermark} />}
    </span>
  );
}

/** Square piece art: watermark when supplied, pip rail from gear tier, gold frame when fully masterworked. */
function PieceThumb({ piece }: { piece: ArmorPiece }) {
  return (
    <ArmorThumb
      icon={piece.icon}
      watermark={piece.watermark}
      size={64}
      masterworked={isFullyMasterworked(piece)}
      gearTier={armorPipTier(piece)}
    />
  );
}

/**
 * One 56px mod cell with a 48px icon (Figma 22:8202): chosen = emphatic outline on a
 * 6% emphatic fill; blocked (no socket or energy left for it) = 40% and not clickable.
 * `count` > 1 shows how many copies are stacked on the piece.: chosen = emphatic outline on a 6% emphatic fill.
 * Once something in the group is chosen the other mods drop to 40% so the picks stand
 * out; an untouched group stays at full strength. `count` > 1 shows how many copies
 * are stacked on the piece. `problem` marks a loadout mod the planner couldn't place
 * (red badge).
 */
const ModCell = memo(function ModCell({
  option,
  count,
  blocked,
  problem,
  onPick,
  tooltipHandle,
}: {
  option: ModOption;
  count: number;
  /** No socket or energy left for this mod (clicking a chosen one still clears it). */
  blocked: boolean;
  problem?: string;
  onPick: (option: ModOption) => void;
  tooltipHandle: BaseTooltip.Handle<string>;
}) {
  const chosen = count > 0;
  const cost = option.cost > 0 ? `${option.cost} energy` : undefined;
  const state = chosen
    ? count > 1
      ? `${count} equipped`
      : "equipped"
    : blocked && !problem
      ? "won't fit"
      : undefined;
  const label = [option.name, cost, state, problem && `not placed: ${problem}`]
    .filter(Boolean)
    .join(" · ");
  return (
    <TooltipTrigger
      handle={tooltipHandle}
      payload={option.name}
      render={
        <button
          type="button"
          aria-pressed={chosen}
          aria-label={label}
          aria-disabled={!chosen && blocked}
          onClick={() => onPick(option)}
          className={cn(
            "relative flex size-14 shrink-0 items-center justify-center rounded-none border p-1 transition-[opacity,border-color,background-color,box-shadow] outline-none focus-visible:d2-tile-selected",
            chosen
              ? "border-foreground bg-foreground/10 cursor-pointer d2-tile-selected"
              : blocked
                ? // Flagged mods stay at full strength so the badge reads.
                  cn("cursor-not-allowed border-foreground/20", !problem && "opacity-40")
                : "hover:border-foreground/70 hover:bg-foreground/6 focus-visible:bg-foreground/6 cursor-pointer border-foreground/25",
          )}
        >
          <ItemIcon icon={option.icon} size={48} className="rounded-none" />
          {count > 1 && (
            <span className="bg-foreground text-background absolute -top-1 -right-1 rounded-none px-1 text-[9px] leading-3 font-medium tabular-nums">
              ×{count}
            </span>
          )}
          {problem && (
            <span
              className="bg-destructive absolute -top-1 -left-1 flex size-3.5 items-center justify-center rounded-none text-[9px] leading-none font-bold text-white"
              aria-hidden
            >
              !
            </span>
          )}
        </button>
      }
    />
  );
});

/**
 * One grid for every socket of a kind on the piece ("Armor mods" = the three helmet
 * sockets). Armor mods stack another copy into the next free socket; at the limit the
 * click clears that mod. Stat and tuning are exclusive — clicking a different option
 * replaces the current pick. Options are those the sockets' plug set lists, so only
 * mods that fit this slot appear.
 */
function KindGrid({
  piece,
  sockets,
  catalog,
  insertable,
  chosen,
  energyLeft,
  costOf,
  problems,
  onChange,
}: {
  piece: ArmorPiece;
  sockets: ArmorSocket[];
  catalog: ModOptionCatalog;
  insertable?: ReadonlySet<number>;
  chosen: Record<number, number> | undefined;
  /** Armor energy the piece has left with the current choices (undefined = unknown). */
  energyLeft: number | undefined;
  costOf: (hash: number) => number;
  /** Mod name → why the planner couldn't place it (see `unplacedProblems`). */
  problems: ReadonlyMap<number | string, string>;
  /** Functional so back-to-back clicks each build on the latest choices. */
  onChange: (update: (chosen: Record<number, number> | undefined) => Record<number, number>) => void;
}) {
  const kind = sockets[0].kind;
  const options = useMemo(() => {
    // Same-kind sockets share a plug set; merge anyway in case one differs.
    const seen = new Set<number>();
    const out: ModOption[] = [];
    for (const socket of sockets) {
      for (const o of catalog.optionsFor(piece, socket, insertable)) {
        if (seen.has(o.hash)) continue;
        seen.add(o.hash);
        out.push(o);
      }
    }
    return out.sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));
  }, [catalog, piece, sockets, insertable]);
  const used = sockets.filter((s) => chosen?.[s.index] !== undefined).length;
  const full = used >= sockets.length;
  // Stat / tuning: one pick per group; a new click replaces it. Armor mods stack.
  const exclusive = kind === "general" || kind === "tuning";
  // Replacing an exclusive pick frees its loadout cost. Stacking fills an empty
  // socket, so vault plugs don't credit anything.
  const occupied = sockets.find((s) => chosen?.[s.index] !== undefined);
  const outgoing = exclusive && occupied ? chosen?.[occupied.index] : undefined;
  const credit = outgoing ? costOf(outgoing) : 0;
  const fits = (o: ModOption) =>
    (exclusive || !full) && (energyLeft === undefined || o.cost <= energyLeft + credit);
  const heading = sockets.length > 1 ? `${KIND_LABEL[kind]}s` : KIND_LABEL[kind];

  const tooltipHandle = useMemo(() => BaseTooltip.createHandle<string>(), []);

  const onPick = useCallback(
    (o: ModOption) => {
      const count = chosenCount(chosen, sockets, o.hash);
      const canAdd =
        (exclusive || !full) &&
        (energyLeft === undefined || o.cost <= energyLeft + credit);
      if (count === 0 && !canAdd) return;
      if (exclusive) {
        onChange((prev) => toggleExclusiveMod(prev, sockets, o.hash));
        return;
      }
      // No room for another copy → the click clears instead.
      const limit = canAdd ? (o.stackable ? sockets.length : 1) : count;
      onChange((prev) => cycleModStack(prev, sockets, o.hash, limit));
    },
    [chosen, credit, energyLeft, exclusive, full, onChange, sockets],
  );

  return (
    // auto-fill tracks are explicit, so the Clear row's `col-span-full` ends at the last
    // column of cells, not the panel edge. The row keeps its height with nothing to clear.
    <section
      aria-label={`${heading} on ${piece.name}`}
      className="grid grid-cols-[repeat(auto-fill,3.5rem)] gap-0.5 text-xs"
    >
      <div className="col-span-full mb-0.5 flex h-4 justify-end">
        {used > 0 && (
          <button
            type="button"
            aria-label={`Clear ${heading.toLowerCase()} on ${piece.name}`}
            onClick={() =>
              onChange((prev) => {
                const next = { ...(prev ?? {}) };
                for (const s of sockets) delete next[s.index];
                return next;
              })
            }
            className="text-foreground/70 hover:text-foreground cursor-pointer leading-4 underline-offset-2 hover:underline"
          >
            Clear
          </button>
        )}
      </div>
      {options.map((o) => {
          const count = chosenCount(chosen, sockets, o.hash);
          const canAdd = fits(o);
          return (
            <ModCell
              key={o.hash}
              option={o}
              count={count}
              blocked={count === 0 && !canAdd}
              problem={problems.get(o.hash) ?? problems.get(o.name)}
              onPick={onPick}
              tooltipHandle={tooltipHandle}
            />
          );
        })}
      <BaseTooltip.Root handle={tooltipHandle} disableHoverablePopup>
        {({ payload }) =>
          payload !== undefined ? <TooltipContent>{payload}</TooltipContent> : null
        }
      </BaseTooltip.Root>
    </section>
  );
}

/** A subclass or armor column: the same corner-tick well as the equipment slots above it. */
export const EDITOR_COLUMN_CLASS = "d2-corner-well flex min-h-0 min-w-0 flex-col gap-3 p-3";

export type PieceChosenUpdate = (
  chosen: Record<number, number> | undefined,
) => Record<number, number>;

/** One armor piece: compact header (icon, name, energy used/capacity) and a group per socket kind. */
export const PiecePanel = memo(function PiecePanel({
  piece,
  catalog,
  insertable,
  placement,
  problems,
  costOf,
  onChange,
}: {
  piece: ArmorPiece;
  catalog: ModOptionCatalog;
  insertable?: ReadonlySet<number>;
  placement: Record<number, number> | undefined;
  problems: ReadonlyMap<number | string, string>;
  costOf: (hash: number) => number;
  onChange: (instanceId: string, update: PieceChosenUpdate) => void;
}) {
  const handleChange = useCallback(
    (update: PieceChosenUpdate) => onChange(piece.instanceId, update),
    [onChange, piece.instanceId],
  );
  const used = pieceEnergyUsed(piece, placement, costOf);
  const usedWithoutStat = pieceEnergyUsed(piece, placement, costOf, "general");
  const capacity = piece.energy?.capacity;
  const over = capacity !== undefined && used > capacity;
  // One group per socket kind, in first-socket order (stat mod, armor mods, tuning…).
  const groups = useMemo(() => {
    const byKind = new Map<ArmorSocket["kind"], ArmorSocket[]>();
    for (const s of piece.armorSockets ?? []) byKind.set(s.kind, [...(byKind.get(s.kind) ?? []), s]);
    return [...byKind.values()];
  }, [piece.armorSockets]);

  return (
    <section
      aria-label={`${piece.name}, ${SLOT_LABELS[piece.slot]}`}
      className={EDITOR_COLUMN_CLASS}
    >
      <div className="flex min-w-0 shrink-0 items-center gap-2.5">
        <PieceThumb piece={piece} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{piece.name}</span>
          {(piece.power !== undefined || capacity !== undefined) && (
            <span className="flex items-center gap-2">
              {piece.power !== undefined && (
                <PowerValue
                  value={piece.power}
                  size="xs"
                  tone="gold"
                  className="shrink-0 items-center gap-0.5 text-xs"
                  title="Power"
                />
              )}
              {capacity !== undefined && (
                <span
                  className={cn(
                    "text-muted-foreground text-xs tabular-nums",
                    over && "text-destructive font-medium",
                  )}
                >
                  Energy {used}/{capacity}
                </span>
              )}
            </span>
          )}
        </div>
      </div>
      {/* Mods scroll inside the column, not the drawer. */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain">
        {groups.length === 0 ? (
          <p className="text-muted-foreground text-xs">No mod sockets.</p>
        ) : (
          groups.map((group) => (
            <KindGrid
              key={group[0].kind}
              piece={piece}
              sockets={group}
              catalog={catalog}
              insertable={insertable}
              chosen={placement}
              energyLeft={
                capacity === undefined
                  ? undefined
                  : capacity - (group[0].kind === "other" ? usedWithoutStat : used)
              }
              costOf={costOf}
              problems={problems}
              onChange={handleChange}
            />
          ))
        )}
      </div>
    </section>
  );
});
