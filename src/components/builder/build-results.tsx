"use client";

import { Fragment, useState, type ReactNode } from "react";
import Image from "next/image";
import { CaretDown } from "@phosphor-icons/react";
import type { ArmorPiece } from "@/lib/armory/normalize";
import type { ArmorSetInfo } from "@/lib/armory/sets";
import {
  STAT_DISPLAY_ORDER,
  STAT_LABELS,
  STAT_ORDER,
  type StatIconMap,
} from "@/lib/armory/stats";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import type {
  AppliedTuning,
  OptimizerLoadout,
  OptimizerOutput,
} from "@/lib/optimizer/types";

const MAX_SHOWN = 25;
/** Display stat columns paired with their STAT_ORDER index (used by the build breakdown). */
const STAT_COLS = STAT_DISPLAY_ORDER.map((key) => ({
  key,
  i: STAT_ORDER.indexOf(key),
}));

/**
 * The Tuned-column cell for one piece: the tuned stat's icon for a directional tune
 * (the +5 is implied by the icon), the Balanced Tuning plug icon for a balanced tune,
 * and nothing when the piece was left untuned.
 */
function TunedCell({
  tune,
  statIcons,
  balancedTuningIcon,
}: {
  tune: AppliedTuning | null;
  statIcons: StatIconMap;
  balancedTuningIcon?: string;
}) {
  if (!tune) return null;
  if (tune.kind === "balanced")
    return (
      <StatGlyph
        src={balancedTuningIcon}
        label="Balanced Tuning"
        invert={false}
      />
    );
  const key = STAT_ORDER[tune.plus];
  return (
    <StatGlyph src={statIcons[key]} label={`Tuned +5 ${STAT_LABELS[key]}`} />
  );
}

function StatGlyph({
  src,
  label,
  className,
  invert = true,
}: {
  src?: string;
  label: string;
  className?: string;
  invert?: boolean;
}) {
  if (!src)
    return (
      <span
        className={cn("inline-block size-4 shrink-0", className)}
        aria-hidden
      />
    );
  return (
    <Image
      src={`${BUNGIE_IMAGE_BASE}${src}`}
      alt={label}
      title={label}
      width={16}
      height={16}
      className={cn(
        "inline-block size-4 shrink-0",
        invert && "invert dark:invert-0",
        className,
      )}
      unoptimized
    />
  );
}

const BREAKDOWN_COLS =
  "minmax(0,1fr) repeat(6, minmax(1.75rem, 1fr)) minmax(2.75rem, auto)";

/** One aligned row of the breakdown grid: a label cell, the six stat cells, and a trailing (empty) Tuned cell. */
function BreakdownRow({
  label,
  labelClass,
  render,
}: {
  label: string;
  labelClass?: string;
  render: (i: number) => ReactNode;
}) {
  return (
    <>
      <div className={cn("text-muted-foreground truncate", labelClass)}>
        {label}
      </div>
      {STAT_COLS.map(({ key, i }) => (
        <div key={key} className="text-center tabular-nums">
          {render(i)}
        </div>
      ))}
      <div />
    </>
  );
}

/** A single build: a collapsed stat header that expands to a per-piece breakdown. */
function BuildRow({
  loadout,
  pieceMap,
  setMap,
  statIcons,
  balancedTuningIcon,
  targets,
}: {
  loadout: OptimizerLoadout;
  pieceMap: Map<string, ArmorPiece>;
  setMap: Map<number, ArmorSetInfo>;
  statIcons: StatIconMap;
  balancedTuningIcon?: string;
  targets: number[];
}) {
  const [open, setOpen] = useState(false);
  const pieces = loadout.pieceIds.map((id) => pieceMap.get(id));
  const exotic = pieces.find((p) => p?.isExotic);

  const setCounts = new Map<number, number>();
  for (const p of pieces) {
    if (p?.setHash) setCounts.set(p.setHash, (setCounts.get(p.setHash) ?? 0) + 1);
  }
  const setBadges: { name: string; count: number }[] = [];
  for (const [hash, cnt] of setCounts) {
    if (cnt < 2) continue;
    const info = setMap.get(hash);
    if (info) setBadges.push({ name: info.name, count: cnt });
  }

  return (
    <div className="border-border/60 overflow-hidden rounded-lg border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="hover:bg-muted/40 flex w-full items-center gap-3 p-2.5 text-left transition-colors"
      >
        {exotic?.icon ? (
          <Image
            src={`${BUNGIE_IMAGE_BASE}${exotic.icon}`}
            alt={exotic.name}
            width={28}
            height={28}
            className="size-7 shrink-0 rounded"
            unoptimized
          />
        ) : (
          <span className="bg-muted size-7 shrink-0 rounded" aria-hidden />
        )}
        <div className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {STAT_COLS.map(({ key, i }) => {
            const met = targets[i] > 0 && loadout.stats[i] >= targets[i];
            return (
              <span key={key} className="flex items-center gap-1 tabular-nums">
                <span className={met ? "text-emerald-500" : "text-foreground"}>
                  {loadout.stats[i]}
                </span>
                <StatGlyph src={statIcons[key]} label={STAT_LABELS[key]} />
              </span>
            );
          })}
        </div>
        <span className="text-muted-foreground shrink-0 text-sm tabular-nums">
          {loadout.total}
        </span>
        {setBadges.map((b) => (
          <Badge
            key={b.name}
            variant="secondary"
            className="shrink-0 px-1.5 py-0 text-[10px]"
            title={b.name}
          >
            {b.count}pc
          </Badge>
        ))}
        <CaretDown
          weight="duotone"
          className={cn(
            "text-muted-foreground size-4 shrink-0 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div
          className="border-border/60 grid items-center gap-x-1 gap-y-1 border-t px-2.5 py-2 text-xs"
          style={{ gridTemplateColumns: BREAKDOWN_COLS }}
        >
          <div />
          {STAT_COLS.map(({ key }) => (
            <div key={key} className="flex justify-center pb-0.5">
              <StatGlyph src={statIcons[key]} label={STAT_LABELS[key]} />
            </div>
          ))}
          <div className="text-muted-foreground pb-0.5 text-center text-[10px] leading-4">
            Tuned
          </div>

          {loadout.pieceIds.map((id, pi) => {
            const piece = pieceMap.get(id);
            if (!piece) return null;
            return (
              <Fragment key={id}>
                <div className="flex min-w-0 items-center gap-1.5">
                  {piece.icon ? (
                    <Image
                      src={`${BUNGIE_IMAGE_BASE}${piece.icon}`}
                      alt=""
                      width={20}
                      height={20}
                      className="size-5 shrink-0 rounded-sm"
                      unoptimized
                    />
                  ) : (
                    <span
                      className="bg-muted size-5 shrink-0 rounded-sm"
                      aria-hidden
                    />
                  )}
                  <span className="truncate">{piece.name}</span>
                </div>
                {STAT_COLS.map(({ key, i }) => (
                  <div
                    key={key}
                    className="text-muted-foreground text-center tabular-nums"
                  >
                    {piece.stats[i] || ""}
                  </div>
                ))}
                <div className="flex justify-center">
                  <TunedCell
                    tune={loadout.tuning[pi]}
                    statIcons={statIcons}
                    balancedTuningIcon={balancedTuningIcon}
                  />
                </div>
              </Fragment>
            );
          })}

          <div className="border-border/60 col-span-full my-0.5 border-t" />

          <BreakdownRow label="Armor" render={(i) => loadout.baseStats[i] || ""} />
          <BreakdownRow
            label="Mods"
            render={(i) =>
              loadout.modBonus[i] ? (
                <span className="text-sky-400/80">+{loadout.modBonus[i]}</span>
              ) : (
                ""
              )
            }
          />
          <BreakdownRow
            label="Tuning"
            render={(i) => {
              const v = loadout.tuningBonus[i];
              if (!v) return "";
              return (
                <span className={v < 0 ? "text-red-400/80" : "text-sky-400/80"}>
                  {v > 0 ? `+${v}` : v}
                </span>
              );
            }}
          />

          <div className="border-border/60 col-span-full my-0.5 border-t" />

          <BreakdownRow
            label="Total"
            labelClass="text-foreground font-medium"
            render={(i) => (
              <span className="text-foreground font-medium">
                {loadout.stats[i]}
              </span>
            )}
          />
        </div>
      )}
    </div>
  );
}

export function BuildResults({
  result,
  pieceMap,
  targets,
  setMap,
  statIcons,
  balancedTuningIcon,
}: {
  result: OptimizerOutput;
  pieceMap: Map<string, ArmorPiece>;
  targets: number[];
  setMap: Map<number, ArmorSetInfo>;
  statIcons: StatIconMap;
  balancedTuningIcon?: string;
}) {
  if (result.loadouts.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No loadouts from your gear meet those constraints — even with mods. Try
        easing a target, a set bonus, or raising your mod budget.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        {result.combosValid.toLocaleString()} matching loadouts · showing top{" "}
        {Math.min(MAX_SHOWN, result.loadouts.length)}
      </p>
      {result.capped && (
        <p className="text-xs text-amber-600/90 dark:text-amber-500/90">
          Hit the time limit — showing the best found so far. Narrow your targets
          for an exhaustive search.
        </p>
      )}
      <div className="space-y-1.5">
        {result.loadouts.slice(0, MAX_SHOWN).map((loadout, idx) => (
          <BuildRow
            key={idx}
            loadout={loadout}
            pieceMap={pieceMap}
            setMap={setMap}
            statIcons={statIcons}
            balancedTuningIcon={balancedTuningIcon}
            targets={targets}
          />
        ))}
      </div>
    </div>
  );
}
