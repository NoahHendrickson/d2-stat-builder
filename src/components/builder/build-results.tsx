"use client";

import { TooltipLabel } from "@/components/ui/tooltip";
import {
  Fragment,
  memo,
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { CaretDown, CheckCircle, CircleNotch, X } from "@phosphor-icons/react";
import type { ArmorPiece } from "@/lib/armory/normalize";
import { materialScore, summarizeMasterwork } from "@/lib/armory/masterwork";
import type { ArmorSetInfo } from "@/lib/armory/sets";
import {
  STAT_DISPLAY_ORDER,
  STAT_LABELS,
  STAT_ORDER,
  type StatIconMap,
} from "@/lib/armory/stats";
import {
  sortLoadouts,
  type LoadoutCostFn,
  type LoadoutSortState,
} from "@/lib/builder/sort-loadouts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatGlyph } from "@/components/stat-glyph";
import { PowerValue } from "@/components/power-value";
import {
  BuildActions,
  type BuildActionProps,
} from "@/components/builder/build-actions";
import { cn } from "@/lib/utils";
import { useStoreValue, type ValueStore } from "@/lib/value-store";
import { liveTargets } from "@/lib/builder/live-targets";
import { ArmorThumb } from "@/components/armor-thumb";
import { MaterialCost, materialSummary } from "@/components/material-cost";
import type {
  AppliedTuning,
  OptimizerLoadout,
  OptimizerOutput,
  RefinementState,
} from "@/lib/optimizer/types";

export type { DimSubclassInput, GetBuilderState } from "@/components/builder/build-actions";

const MAX_SHOWN = 50;
export { MAX_SHOWN };

/** A build card: lifted face with the EQUIP centre-bright stroke. */
export const BUILD_CARD_LIFT_CLASS =
  "build-card-edge d2-card-frame relative rounded-[8px] shadow-[0px_1px_2px_0px_rgba(0,0,0,0.24)] after:pointer-events-none after:absolute after:inset-0 after:rounded-[8px] after:shadow-[inset_0px_1px_2px_0px_color-mix(in_srgb,var(--foreground)_6%,transparent)] after:content-[''] [--card-line-width:1.5px] d2:rounded-none d2:shadow-none d2:after:hidden";

/** Stack of build cards — no well; they sit on the main column. */
export const BUILD_LIST_WELL_CLASS =
  "flex flex-col gap-2 rounded-[12px] bg-foreground/5 p-2 dark:bg-background d2:gap-3 d2:rounded-none d2:bg-transparent d2:p-0";

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
    <span className="flex items-center gap-0.5 text-[10px] text-brand/80 d2:text-positive/90 tabular-nums">
      <StatGlyph
        src={statIcons[key]}
        label={`Artifice +3 ${STAT_LABELS[key]}`}
      />
      +3
    </span>
  );
}

/**
 * Figma 18:6865 breakdown grid: name column hugs the longest piece name, six stat
 * columns share the leftover so they don't sit in a cluster on the right. Compact
 * (icon headers) by default; text headers only when *this card* is wide enough
 * (viewport 2xl still leaves a narrow builds column beside the sidebar + config).
 */
const BREAKDOWN_GRID =
  "grid grid-cols-[minmax(7rem,max-content)_repeat(6,minmax(2.25rem,1fr))_auto] items-center gap-x-2 @[44rem]/build:grid-cols-[minmax(8rem,max-content)_repeat(6,minmax(2.5rem,1fr))_auto] @[44rem]/build:gap-x-4";

/** Delta colours: +n the game's stat-gain green, -n red, 0 secondary. */
const POSITIVE_CLASS = "text-[#1be364] d2:text-positive";

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
    <span className={met ? "text-brand d2:text-positive" : "text-foreground"}>{value}</span>
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
  // What finishing the pieces' masterworks would cost — the stats above already
  // assume it's done; this only tells the player what they'd have to spend.
  const masterwork = summarizeMasterwork(pieces);

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
    <div className={cn(BUILD_CARD_LIFT_CLASS, "@container/build")}>
      <div className="overflow-hidden rounded-[8px] d2:rounded-none">
      {/* Figma 17:6044 — exotic tile, six stat chips spread over ~456px, total + set badge, caret */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-3 p-2 text-left transition-colors 2xl:gap-4",
          open
            ? "bg-foreground/6"
            : "classic:bg-foreground/6 classic:hover:bg-foreground/10 d2:hover:bg-foreground/8",
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3 2xl:gap-6">
          {exotic?.icon ? (
            <ArmorThumb
              icon={exotic.icon}
              watermark={exotic.watermark}
              alt={exotic.name}
              size={40}
              exoticFrame
              isTier5={exotic.tunedStat !== undefined}
            />
          ) : (
            <span
              className="d2-brackets size-10 shrink-0 rounded-[2px] border border-dashed border-foreground/35 bg-foreground/12 d2:rounded-none d2:border-0 d2:bg-black/25"
              aria-hidden
            />
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
                  className="size-4 opacity-65 d2:opacity-70 2xl:size-5"
                  plain
                />
                <StatValue index={i} value={loadout.stats[i]} />
              </span>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 2xl:gap-5">
          <span className="text-sm tabular-nums d2:font-medium 2xl:text-base">{loadout.total}</span>
          {loadout.power !== null && (
            <PowerValue
              value={loadout.power}
              size="xs"
              className="max-lg:hidden 2xl:text-sm"
              title="Gear power — the game's average over these pieces (and your weapons, if entered)"
            />
          )}
          {/* Header real estate is tight (the stat chips share it), so only the two
              scarcest materials show here; the expanded card lists everything. Hidden
              on narrow cards rather than squeezing the stat chips into each other. */}
          {!masterwork.complete && (
            <span
              className="hidden items-center gap-1.5 text-[11px] text-muted-foreground @[36rem]/build:inline-flex"
              title={
                masterwork.cost.length > 0
                  ? `To fully masterwork: ${materialSummary(masterwork.cost, manifest)}`
                  : "Some pieces are not fully masterworked"
              }
            >
              <MaterialCost stacks={masterwork.cost.slice(-2)} manifest={manifest} compact />
              {masterwork.unknownCostPieces > 0 && (
                <span title="Some pieces have an unknown upgrade cost">?</span>
              )}
            </span>
          )}
          {setBadges.map((b) => (
            <Badge
              key={b.name}
              title={b.name}
              variant="outline"
              className="max-lg:hidden classic:border-primary-border classic:bg-primary classic:px-1.5 classic:text-[10px] classic:text-primary-foreground classic:2xl:px-2 classic:2xl:text-xs"
            >
              {b.count}pc
            </Badge>
          ))}
        </div>
        <span
          className="text-foreground flex size-8 shrink-0 items-center justify-center rounded-[10px] d2:rounded-none"
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
        <div className="border-border bg-foreground/6 border-t d2:border-foreground/8 d2:bg-black/15">
          {/* Shared column tracks so totals line up with per-piece stats
              (name column is max-content of the longest piece name). */}
          <div className={cn(BREAKDOWN_GRID, "border-border border-b px-4 d2:border-foreground/8")}>
            {/* Armor table — Figma 18:6899 */}
            <div className="col-span-full grid grid-cols-subgrid items-center gap-y-4 py-4">
              <div className="d2-label classic:text-sm classic:text-text-secondary">Armor</div>
              {STAT_COLS.map(({ key }) => (
                <div
                  key={key}
                  className="d2-label classic:text-sm classic:text-text-secondary"
                >
                  <span className="@[44rem]/build:hidden">
                    <StatGlyph src={statIcons[key]} label={STAT_LABELS[key]} />
                  </span>
                  <span className="hidden @[44rem]/build:inline">{STAT_LABELS[key]}</span>
                </div>
              ))}
              <div className="d2-label classic:text-sm classic:text-text-secondary">
                <span className="@[44rem]/build:hidden" aria-hidden />
                <span className="hidden @[44rem]/build:inline">Tuning</span>
              </div>

              {loadout.pieceIds.map((id, pi) => {
                const piece = pieceMap.get(id);
                if (!piece) return null;
                return (
                  <Fragment key={id}>
                    <div className="flex min-w-0 items-center gap-2">
                      {piece.icon ? (
                        <ArmorThumb
                          icon={piece.icon}
                          watermark={piece.isExotic ? piece.watermark : undefined}
                          size={32}
                          exoticFrame={piece.isExotic}
                          isTier5={piece.isExotic && piece.tunedStat !== undefined}
                        />
                      ) : (
                        <span
                          className="d2-brackets bg-muted size-8 shrink-0 rounded-[2px] d2:rounded-none d2:bg-black/25"
                          aria-hidden
                        />
                      )}
                      <span className="truncate text-sm @[44rem]/build:text-base">
                        {piece.name}
                      </span>
                      {piece.power !== undefined && (
                        <PowerValue
                          value={piece.power}
                          size="xs"
                          muted
                          className="shrink-0"
                          title="Power"
                        />
                      )}
                      {piece.masterwork &&
                        piece.masterwork.level < piece.masterwork.max && (
                          <span
                            className="shrink-0 text-[10px] font-medium text-warning tabular-nums"
                            title={`Masterwork level ${piece.masterwork.level} of ${piece.masterwork.max} — stats shown assume it's finished`}
                          >
                            MW {piece.masterwork.level}/{piece.masterwork.max}
                          </span>
                        )}
                    </div>
                    {STAT_COLS.map(({ key, i }) => (
                      <div
                        key={key}
                        className="text-sm tabular-nums @[44rem]/build:text-base"
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

            <div className="border-border col-span-full -mx-4 border-t d2:border-foreground/8" />

            {/* Totals — Figma 18:6970 */}
            <div className="col-span-full grid grid-cols-subgrid items-center gap-y-6 py-4">
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

            <div className="border-border col-span-full -mx-4 border-t d2:border-foreground/8" />

            {/* Masterwork — what it costs to make the assumed-full masterwork real */}
            <div className="col-span-full py-4">
              <div className="d2-label mb-2">Masterwork</div>
              {masterwork.complete ? (
                <p className="text-sm text-text-secondary">
                  Every piece is fully masterworked.
                </p>
              ) : (
                <div className="flex flex-col gap-1.5 text-sm">
                  {pieces.map((piece, pi) => {
                    const mw = piece?.masterwork;
                    if (!piece || !mw || mw.level >= mw.max) return null;
                    return (
                      <div
                        key={loadout.pieceIds[pi]}
                        className="flex flex-wrap items-center gap-x-3 gap-y-0.5"
                      >
                        <span className="min-w-0 truncate">{piece.name}</span>
                        <span className="text-text-secondary tabular-nums">
                          {mw.level}/{mw.max}
                        </span>
                        {mw.cost ? (
                          <MaterialCost stacks={mw.cost} manifest={manifest} />
                        ) : (
                          <span className="text-text-secondary">cost unknown</span>
                        )}
                      </div>
                    );
                  })}
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-medium">
                    <span>To finish</span>
                    <MaterialCost stacks={masterwork.cost} manifest={manifest} />
                    {masterwork.unknownCostPieces > 0 && (
                      <span className="font-normal text-text-secondary">
                        + {masterwork.unknownCostPieces}{" "}
                        {masterwork.unknownCostPieces === 1 ? "piece" : "pieces"} with
                        an unknown cost
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-text-secondary">
                    Stats above already assume every piece is fully masterworked.
                  </p>
                </div>
              )}
            </div>
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
      className="flex items-center gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 d2:rounded-md d2:border-positive/30 d2:bg-positive/10"
      aria-live="polite"
    >
      <CheckCircle
        weight="fill"
        className="size-4 shrink-0 text-emerald-600 dark:text-emerald-500 d2:text-positive"
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
    <p className="text-xs text-amber-600/90 dark:text-amber-500/90 d2:text-warning">
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
          className="flex items-center gap-2.5 rounded-lg border border-brand/30 bg-brand/10 px-3 py-2.5 d2:rounded-md d2:border-foreground/15 d2:bg-lifted"
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
            className="flex items-center gap-2 text-xs text-emerald-600/90 dark:text-emerald-500/90 d2:text-positive"
            aria-live="polite"
          >
            Stronger builds found
            <Button
              variant="link"
              onClick={onShowPending}
              className="h-auto p-0 text-xs font-medium text-emerald-600 dark:text-emerald-500 d2:text-positive"
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
  // "Upgrade cost" sorts by a scarcity-weighted total of each build's remaining
  // masterwork materials (see materialScore) — pieces with an unknown cost count as 0.
  const costOf = useCallback<LoadoutCostFn>(
    (loadout) => {
      let score = 0;
      for (const id of loadout.pieceIds) {
        score += materialScore(pieceMap.get(id)?.masterwork?.cost);
      }
      return score;
    },
    [pieceMap],
  );
  const sortedLoadouts = useMemo(
    () => sortLoadouts(result.loadouts, sort, costOf),
    [result.loadouts, sort, costOf],
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
      <div className={BUILD_LIST_WELL_CLASS}>
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
