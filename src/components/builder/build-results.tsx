"use client";

import { TooltipLabel } from "@/components/ui/tooltip";
import {
  Fragment,
  memo,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import Image from "next/image";
import { CaretDown, CheckCircle, CircleNotch, X } from "@phosphor-icons/react";
import type { ArmorPiece } from "@/lib/armory/normalize";
import type { ArmorSetInfo } from "@/lib/armory/sets";
import {
  STAT_DISPLAY_ORDER,
  STAT_LABELS,
  STAT_ORDER,
  type StatIconMap,
} from "@/lib/armory/stats";
import {
  sortLoadouts,
  type LoadoutSortState,
} from "@/lib/builder/sort-loadouts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatGlyph } from "@/components/stat-glyph";
import {
  BuildActions,
  type BuildActionProps,
} from "@/components/builder/build-actions";
import { cn } from "@/lib/utils";
import { useStoreValue, type ValueStore } from "@/lib/value-store";
import { liveTargets } from "@/lib/builder/live-targets";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import type {
  AppliedTuning,
  OptimizerLoadout,
  OptimizerOutput,
  RefinementState,
} from "@/lib/optimizer/types";

export type { DimSubclassInput, GetBuilderState } from "@/components/builder/build-actions";

const MAX_SHOWN = 50;
export { MAX_SHOWN };

/** Figma 54:6099 — fading 1px edge, inset highlight, 0 1px 2px drop shadow. */
export const BUILD_CARD_LIFT_CLASS =
  "build-card-edge relative rounded-[8px] shadow-[0px_1px_2px_0px_rgba(0,0,0,0.24)] after:pointer-events-none after:absolute after:inset-0 after:rounded-[8px] after:shadow-[inset_0px_1px_2px_0px_rgb(255_255_255/0.06)] after:content-['']";

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
        className="size-6"
      />
    );
  const key = STAT_ORDER[tune.plus];
  return (
    <StatGlyph
      src={statIcons[key]}
      label={`Tuned +5 ${STAT_LABELS[key]}`}
      className="size-6"
    />
  );
}

/**
 * The Tuned-column cell for an artifice piece: the picked stat's icon + "+3".
 * Renders nothing for non-artifice pieces (tuning and artifice are mutually
 * exclusive on a piece, so the column is shared).
 */
function ArtificeCell({
  pick,
  statIcons,
}: {
  pick: number | null;
  statIcons: StatIconMap;
}) {
  if (pick === null) return null;
  const key = STAT_ORDER[pick];
  return (
    <span className="flex items-center gap-0.5 text-[10px] text-brand/80 tabular-nums">
      <StatGlyph
        src={statIcons[key]}
        label={`Artifice +3 ${STAT_LABELS[key]}`}
      />
      +3
    </span>
  );
}

/**
 * Figma 18:6865 breakdown grid: name column takes the slack, six stat columns and a
 * Tuning column are fixed so the Armor table and the totals block line up. Compact
 * below 2xl (icon headers, text-sm); Figma-sized at 2xl (text headers, text-base).
 */
const BREAKDOWN_GRID =
  "grid grid-cols-[minmax(0,1fr)_repeat(6,2.25rem)_1.5rem] items-center gap-x-2 2xl:grid-cols-[minmax(0,1fr)_repeat(6,3.75rem)_2.75rem] 2xl:gap-x-4";

/** Figma 18:6865 delta colours: +n green, -n destructive, 0 secondary. */
const POSITIVE_CLASS = "text-[#1be364]";

function Delta({ value }: { value: number }) {
  if (!value) return <span className="text-text-secondary">0</span>;
  return (
    <span className={value > 0 ? POSITIVE_CLASS : "text-destructive"}>
      {value > 0 ? `+${value}` : value}
    </span>
  );
}

/** One totals row: a label and six values (font-medium 14px), trailing empty Tuning cell. */
function TotalsRow({
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
      <div className={cn("truncate text-sm font-medium", labelClass)}>
        {label}
      </div>
      {STAT_COLS.map(({ key, i }) => (
        <div key={key} className="text-sm font-medium tabular-nums">
          {render(i)}
        </div>
      ))}
      <div />
    </>
  );
}


/**
 * One stat chip value in a build's collapsed header, lit once it meets the slider
 * target. It subscribes to the live targets itself with a boolean selector, so a slider
 * drag re-renders only the chips whose met state flips — never the memoized rows.
 */
function StatValue({ index, value }: { index: number; value: number }) {
  const met = useSyncExternalStore(
    liveTargets.subscribe,
    () => {
      const target = liveTargets.get()[index];
      return target > 0 && value >= target;
    },
    () => false,
  );
  return (
    <span className={met ? "text-brand" : "text-foreground"}>{value}</span>
  );
}

/**
 * A single build: a collapsed stat header that expands to a per-piece breakdown.
 * Memoized: background-refinement progress ticks re-render the results column ~10×/s
 * while the list itself is frozen — every prop here is identity-stable across those
 * ticks, so rows bail out and only the status line pays for the tick.
 */
const BuildRow = memo(function BuildRow({
  loadout,
  pieceMap,
  setMap,
  statIcons,
  balancedTuningIcon,
  characters,
  statModHashes,
  tuningPlugHashes,
  artificeModHashes,
  subclass,
  getBuilderState,
  manifest,
  insertablePlugs,
  onEquipped,
}: {
  loadout: OptimizerLoadout;
  pieceMap: Map<string, ArmorPiece>;
  setMap: Map<number, ArmorSetInfo>;
  statIcons: StatIconMap;
  balancedTuningIcon?: string;
} & BuildActionProps) {
  const [open, setOpen] = useState(false);
  const pieces = loadout.pieceIds.map((id) => pieceMap.get(id));
  const exotic = pieces.find((p) => p?.isExotic);

  const setCounts = new Map<number, number>();
  for (const p of pieces) {
    if (p?.setHash)
      setCounts.set(p.setHash, (setCounts.get(p.setHash) ?? 0) + 1);
  }
  const setBadges: { name: string; count: number }[] = [];
  for (const [hash, cnt] of setCounts) {
    if (cnt < 2) continue;
    const info = setMap.get(hash);
    if (info) setBadges.push({ name: info.name, count: cnt });
  }

  return (
    <div className={BUILD_CARD_LIFT_CLASS}>
      <div className="overflow-hidden rounded-[8px]">
      {/* Figma 17:6044 — exotic tile, six stat chips spread over ~456px, total + set badge, caret */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(
          "bg-white/6 flex w-full items-center gap-3 p-2 text-left transition-colors 2xl:gap-4",
          !open && "hover:bg-white/10",
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3 2xl:gap-6">
          {exotic?.icon ? (
            // eslint-disable-next-line @next/next/no-img-element -- collapsed header: no tooltip/optimizer
            <img
              src={`${BUNGIE_IMAGE_BASE}${exotic.icon}`}
              alt={exotic.name}
              title={exotic.name}
              width={40}
              height={40}
              loading="lazy"
              decoding="async"
              className="size-10 shrink-0 rounded-[2px]"
            />
          ) : (
            <span className="bg-white/12 size-10 shrink-0 rounded-[2px]" aria-hidden />
          )}
          {/* Six evenly spaced stat chips; type and glyphs step up at 2xl where the column is Figma-wide */}
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5 text-sm xl:grid xl:grid-cols-6 xl:gap-x-0.5 lg:max-w-[28.5rem] 2xl:gap-x-2 2xl:text-base">
            {STAT_COLS.map(({ key, i }) => (
              <span
                key={key}
                className="flex min-w-0 items-center gap-1 tabular-nums"
              >
                <StatGlyph
                  src={statIcons[key]}
                  label={STAT_LABELS[key]}
                  className="size-4 opacity-65 2xl:size-5"
                  plain
                />
                <StatValue index={i} value={loadout.stats[i]} />
              </span>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 2xl:gap-5">
          <span className="text-sm tabular-nums 2xl:text-base">{loadout.total}</span>
          {setBadges.map((b) => (
            <Badge
              key={b.name}
              title={b.name}
              className="px-1.5 text-[10px] max-lg:hidden 2xl:px-2 2xl:text-xs"
            >
              {b.count}pc
            </Badge>
          ))}
        </div>
        <span
          className="text-foreground flex size-8 shrink-0 items-center justify-center rounded-[10px]"
          aria-hidden
        >
          <CaretDown
            className={cn(
              "size-4 transition-transform",
              open && "rotate-180",
            )}
          />
        </span>
      </button>

      {open && (
        <div className="border-border bg-white/6 border-t">
          {/* Armor table — Figma 18:6899 */}
          <div className={cn(BREAKDOWN_GRID, "border-border gap-y-4 border-b p-4")}>
            <div className="text-text-secondary text-sm font-medium">Armor</div>
            {STAT_COLS.map(({ key }) => (
              <div
                key={key}
                className="text-text-secondary text-sm font-medium"
              >
                <span className="2xl:hidden">
                  <StatGlyph src={statIcons[key]} label={STAT_LABELS[key]} />
                </span>
                <span className="hidden 2xl:inline">{STAT_LABELS[key]}</span>
              </div>
            ))}
            <div className="text-text-secondary text-sm font-medium">
              <span className="2xl:hidden" aria-hidden />
              <span className="hidden 2xl:inline">Tuning</span>
            </div>

            {loadout.pieceIds.map((id, pi) => {
              const piece = pieceMap.get(id);
              if (!piece) return null;
              return (
                <Fragment key={id}>
                  <div className="flex min-w-0 items-center gap-2">
                    {piece.icon ? (
                      <Image
                        src={`${BUNGIE_IMAGE_BASE}${piece.icon}`}
                        alt=""
                        width={32}
                        height={32}
                        className="size-8 shrink-0 rounded-[2px]"
                        unoptimized
                      />
                    ) : (
                      <span
                        className="bg-muted size-8 shrink-0 rounded-[2px]"
                        aria-hidden
                      />
                    )}
                    <span className="truncate text-sm 2xl:text-base">
                      {piece.name}
                    </span>
                  </div>
                  {STAT_COLS.map(({ key, i }) => (
                    <div
                      key={key}
                      className="text-sm tabular-nums 2xl:text-base"
                    >
                      {piece.stats[i] || ""}
                    </div>
                  ))}
                  <div className="flex h-8 items-center">
                    {loadout.tuning[pi] ? (
                      <TunedCell
                        tune={loadout.tuning[pi]}
                        statIcons={statIcons}
                        balancedTuningIcon={balancedTuningIcon}
                      />
                    ) : (
                      <ArtificeCell
                        pick={loadout.artifice[pi]}
                        statIcons={statIcons}
                      />
                    )}
                  </div>
                </Fragment>
              );
            })}
          </div>

          {/* Totals — Figma 18:6970 */}
          <div className={cn(BREAKDOWN_GRID, "border-border gap-y-6 border-b p-4")}>
            <TotalsRow
              label="Armor totals"
              render={(i) => loadout.baseStats[i]}
            />
            <TotalsRow
              label="Mods"
              labelClass="text-text-secondary"
              render={(i) => <Delta value={loadout.modBonus[i]} />}
            />
            {loadout.artificeBonus.some((v) => v > 0) && (
              <TotalsRow
                label="Artifice"
                labelClass="text-text-secondary"
                render={(i) => <Delta value={loadout.artificeBonus[i]} />}
              />
            )}
            <TotalsRow
              label="Tuning"
              labelClass="text-text-secondary"
              render={(i) => <Delta value={loadout.tuningBonus[i]} />}
            />
            <TotalsRow label="Total" render={(i) => loadout.stats[i]} />
          </div>

          <BuildActions
            loadout={loadout}
            pieces={pieces}
            exoticName={exotic?.name}
            setBadges={setBadges}
            characters={characters}
            statModHashes={statModHashes}
            tuningPlugHashes={tuningPlugHashes}
            artificeModHashes={artificeModHashes}
            subclass={subclass}
            getBuilderState={getBuilderState}
            manifest={manifest}
            insertablePlugs={insertablePlugs}
            onEquipped={onEquipped}
            pieceMap={pieceMap}
          />
        </div>
      )}
      </div>
    </div>
  );
});

/** Dismissible "higher maxima" card — keeps dismiss state out of the phase switch.
 * Remount (via parent key / unmount when outcome leaves "improved") resets dismiss. */
function ImprovedMaximaAlert() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  // Same alert footprint as the running card — green with a check instead of a spinner.
  return (
    <div
      className="flex items-center gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5"
      aria-live="polite"
    >
      <CheckCircle
        weight="fill"
        className="size-4 shrink-0 text-emerald-600 dark:text-emerald-500"
        aria-hidden
      />
      <p className="text-foreground/90 min-w-0 flex-1 text-sm">
        <span className="font-medium">Higher stat maximums found</span> — raise
        a stat target to explore them.
      </p>
      <TooltipLabel label="Dismiss">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Dismiss"
          onClick={() => setDismissed(true)}
          className="text-muted-foreground hover:text-foreground shrink-0"
        >
          <X weight="bold" className="size-3.5" aria-hidden />
        </Button>
      </TooltipLabel>
    </div>
  );
}

function RefinementPercent({ store }: { store: ValueStore<number> }) {
  const progress = useStoreValue(store);
  return <>{Math.round(progress * 100)}%</>;
}

function SearchStatus({
  capped,
  refinement,
  refinementProgress,
  onShowPending,
  onCancel,
}: {
  capped: boolean;
  refinement: RefinementState;
  refinementProgress: ValueStore<number>;
  onShowPending: () => void;
  onCancel: () => void;
}) {
  const cappedBanner = capped ? (
    <p className="text-xs text-amber-600/90 dark:text-amber-500/90">
      Hit the time limit — showing the best found so far. Narrow your targets
      for an exhaustive search.
    </p>
  ) : null;
  switch (refinement.phase) {
    case "idle":
      return cappedBanner;
    case "running":
      // Alert-style card sized like a build row (same rounded border footprint) — the
      // background search materially changes what the sliders offer, so it earns more
      // visual weight than a status line.
      return (
        <div
          className="flex items-center gap-2.5 rounded-lg border border-brand/30 bg-brand/10 px-3 py-2.5"
          aria-live="polite"
        >
          <CircleNotch
            className="size-4 shrink-0 animate-spin text-primary"
            aria-hidden
          />
          <p className="text-foreground/90 min-w-0 flex-1 text-sm">
            {refinement.interim.capped ? (
              <>
                <span className="font-medium">First pass done</span> — searching
                deeper for higher maximums and stronger builds (
              </>
            ) : (
              // Uncapped walk, unproven ceilings: the list is final and only the stat
              // maximums are still being proven — don't promise a build search.
              <>
                <span className="font-medium">Builds are final</span> — proving
                higher stat maximums (
              </>
            )}
            <RefinementPercent store={refinementProgress} />)
          </p>
          <Button
            variant="link"
            onClick={onCancel}
            className="text-muted-foreground hover:text-foreground h-auto shrink-0 p-0 text-xs font-normal"
          >
            Cancel
          </Button>
        </div>
      );
    case "done": {
      const { outcome, pending, verified } = refinement;
      const lines: ReactNode[] = [];
      if (pending) {
        lines.push(
          <p
            key="pending"
            className="flex items-center gap-2 text-xs text-emerald-600/90 dark:text-emerald-500/90"
            aria-live="polite"
          >
            Stronger builds found
            <Button
              variant="link"
              onClick={onShowPending}
              className="h-auto p-0 text-xs font-medium text-emerald-600 dark:text-emerald-500"
            >
              Show them
            </Button>
          </p>,
        );
      }
      if (outcome === "improved") {
        lines.push(<ImprovedMaximaAlert key="improved" />);
      } else if (outcome === "confirmed" && !pending) {
        // Only rendered when both halves are PROVEN (walk exhausted + ceilings exact).
        lines.push(
          <p
            key="confirmed"
            className="text-muted-foreground text-xs"
            aria-live="polite"
          >
            Verified — no better builds or higher maximums exist for these
            targets.
          </p>,
        );
      } else if (outcome === null && verified && !pending) {
        // Build walk proven exhaustive, but some ceiling probes ran out of budget —
        // claim only what was proven.
        lines.push(
          <p
            key="verified-list"
            className="text-muted-foreground text-xs"
            aria-live="polite"
          >
            Search complete — no better builds exist for these targets (stat
            maximums shown are best-effort).
          </p>,
        );
      }
      // An unverified list stays flagged: the time-limit warning is never suppressed
      // by an improved-maximums note or a pending offer.
      if (!verified && cappedBanner) {
        lines.push(<Fragment key="capped">{cappedBanner}</Fragment>);
      }
      return lines.length > 0 ? <>{lines}</> : null;
    }
    default: {
      const _exhaustive: never = refinement;
      return _exhaustive;
    }
  }
}

export function BuildResults({
  result,
  refinement,
  refinementProgress,
  onShowPending,
  onCancel,
  pieceMap,
  setMap,
  statIcons,
  balancedTuningIcon,
  characters,
  statModHashes,
  tuningPlugHashes,
  artificeModHashes,
  subclass,
  getBuilderState,
  manifest,
  insertablePlugs,
  onEquipped,
  sort,
}: {
  result: OptimizerOutput;
  refinement: RefinementState;
  refinementProgress: ValueStore<number>;
  onShowPending: () => void;
  onCancel: () => void;
  pieceMap: Map<string, ArmorPiece>;
  setMap: Map<number, ArmorSetInfo>;
  statIcons: StatIconMap;
  balancedTuningIcon?: string;
  sort: LoadoutSortState;
} & BuildActionProps) {
  const sortedLoadouts = useMemo(
    () => sortLoadouts(result.loadouts, sort),
    [result.loadouts, sort],
  );
  const status = (
    <SearchStatus
      capped={result.capped}
      refinement={refinement}
      refinementProgress={refinementProgress}
      onShowPending={onShowPending}
      onCancel={onCancel}
    />
  );
  if (result.loadouts.length === 0) {
    // The definitive "nothing meets those constraints" is only honest once no deeper
    // search is running and no better list is waiting behind the CTA above.
    const emptyCopy =
      refinement.phase === "running"
        ? "No builds found in the first pass yet — the deeper search is still running."
        : refinement.phase === "done" && refinement.pending
          ? "The first pass found none — use “Show them” above to load what the full search found."
          : "No loadouts from your gear meet those constraints — even with mods. Try easing a target, a set bonus, or raising your mod budget.";
    return (
      <div className="space-y-3">
        {status}
        <p className="text-muted-foreground text-sm">{emptyCopy}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {status}
      <div className="space-y-2">
        {sortedLoadouts.slice(0, MAX_SHOWN).map((loadout) => (
          <BuildRow
            key={loadout.pieceIds.join("|")}
            loadout={loadout}
            pieceMap={pieceMap}
            setMap={setMap}
            statIcons={statIcons}
            balancedTuningIcon={balancedTuningIcon}
            characters={characters}
            statModHashes={statModHashes}
            tuningPlugHashes={tuningPlugHashes}
            artificeModHashes={artificeModHashes}
            subclass={subclass}
            getBuilderState={getBuilderState}
            manifest={manifest}
            insertablePlugs={insertablePlugs}
            onEquipped={onEquipped}
          />
        ))}
      </div>
    </div>
  );
}
