"use client";

import { TooltipLabel } from "@/components/ui/tooltip";
import {
  Fragment,
  memo,
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { CaretDown, CheckCircle, CircleNotch, X } from "@phosphor-icons/react";
import { armorPipTier, type ArmorPiece } from "@/lib/armory/normalize";
import {
  isFullyMasterworked,
  materialScore,
  summarizeMasterwork,
  type LoadoutMasterworkSummary,
} from "@/lib/armory/masterwork";
import type { Manifest } from "@/lib/manifest/load";
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
  "d2-card-frame relative rounded-none [--card-line-width:1.5px]";

/** Stack of build cards — no well; they sit on the main column. */
export const BUILD_LIST_WELL_CLASS = "flex flex-col gap-3";

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
    <span className="flex items-center gap-0.5 text-[10px] text-positive/90 tabular-nums">
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
const POSITIVE_CLASS = "text-positive";

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


const SET_BADGE_CLASS =
  "h-5 rounded-full border-transparent bg-[#41a6ff] px-2 font-sans text-xs font-medium tracking-normal text-foreground normal-case";

/** Vertical rule between collapsed-header clusters (Figma 86:862). */
function HeaderRule() {
  return <span className="h-[15px] w-px shrink-0 bg-foreground/16" aria-hidden />;
}

/**
 * Second line of a collapsed build card: 2pc set pills, gold light level, and
 * remaining masterwork materials (rarest first).
 */
function BuildHeaderMeta({
  setBadges,
  power,
  masterwork,
  manifest,
}: {
  setBadges: { name: string; count: number }[];
  power: number | null;
  masterwork: LoadoutMasterworkSummary;
  manifest?: Manifest;
}) {
  const clusters: ReactNode[] = [];
  if (setBadges.length > 0) {
    clusters.push(
      <span key="sets" className="flex items-center gap-2">
        {setBadges.map((b) => (
          <Badge
            key={b.name}
            title={b.name}
            variant="default"
            className={SET_BADGE_CLASS}
          >
            {b.count}pc
          </Badge>
        ))}
      </span>,
    );
  }
  if (power !== null) {
    clusters.push(
      <PowerValue
        key="power"
        value={power}
        size="xs"
        tone="gold"
        className="gap-0.5 text-xs items-center"
        title="Gear power — the game's average over these pieces (and your weapons, if entered)"
      />,
    );
  }
  if (
    !masterwork.complete &&
    (masterwork.cost.length > 0 ||
      masterwork.unknownCostPieces + masterwork.unknownPieces > 0)
  ) {
    clusters.push(
      <span
        key="mw"
        className="inline-flex items-center gap-1.5"
        title={
          masterwork.cost.length > 0
            ? `To fully masterwork: ${materialSummary(masterwork.cost, manifest)}`
            : "Some pieces are not fully masterworked"
        }
      >
        <MaterialCost stacks={masterwork.cost} manifest={manifest} header />
        {masterwork.unknownCostPieces + masterwork.unknownPieces > 0 && (
          <span title="Some pieces have an unknown upgrade cost">?</span>
        )}
      </span>,
    );
  }
  if (clusters.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {clusters.map((cluster, i) => (
        <Fragment key={i}>
          {i > 0 && <HeaderRule />}
          {cluster}
        </Fragment>
      ))}
    </div>
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
  getBuilderState,
  manifest,
  insertablePlugs,
  onEquipped,
  onDream,
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
    <div className={cn(BUILD_CARD_LIFT_CLASS, "d2-hover-ring", "@container/build")}>
      <div className="overflow-hidden rounded-none">
      {/* Figma 86:862 — 56px exotic, total + six stats, then set pills / light / materials */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(
          "flex w-full items-center justify-between gap-4 p-2 text-left transition-colors",
          !open && "hover:bg-foreground/4",
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-4">
          {exotic?.icon ? (
            <ArmorThumb
              icon={exotic.icon}
              watermark={exotic.watermark}
              alt={exotic.name}
              size={56}
              masterworked={isFullyMasterworked(exotic)}
              gearTier={armorPipTier(exotic)}
            />
          ) : (
            <span
              className="d2-brackets size-14 shrink-0 rounded-none bg-black/25"
              aria-hidden
            />
          )}
          <div className="flex min-w-0 flex-col justify-center gap-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="text-base font-medium tabular-nums">
                {loadout.total}
              </span>
              <div className="flex flex-wrap items-center gap-x-8 gap-y-1 text-base font-medium tabular-nums">
                {STAT_COLS.map(({ key, i }) => (
                  <span key={key} className="flex items-center gap-1">
                    <StatGlyph
                      src={statIcons[key]}
                      label={STAT_LABELS[key]}
                      className="size-5"
                      plain
                    />
                    {loadout.stats[i]}
                  </span>
                ))}
              </div>
            </div>
            <BuildHeaderMeta
              setBadges={setBadges}
              power={loadout.power}
              masterwork={masterwork}
              manifest={manifest}
            />
          </div>
        </div>
        <span
          className="text-foreground flex size-8 shrink-0 items-center justify-center rounded-none"
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
        <div className="border-t border-foreground/8">
          {/* Shared column tracks so totals line up with per-piece stats
              (name column is max-content of the longest piece name). */}
          <div className={cn(BREAKDOWN_GRID, "border-b border-foreground/8 px-4")}>
            {/* Armor table — Figma 18:6899 */}
            <div className="col-span-full grid grid-cols-subgrid items-center gap-y-4 py-4">
              <div className="d2-label">Armor</div>
              {STAT_COLS.map(({ key }) => (
                <div
                  key={key}
                  className="d2-label"
                >
                  <span className="@[44rem]/build:hidden">
                    <StatGlyph src={statIcons[key]} label={STAT_LABELS[key]} />
                  </span>
                  <span className="hidden @[44rem]/build:inline">{STAT_LABELS[key]}</span>
                </div>
              ))}
              <div className="d2-label">
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
                          watermark={piece.watermark}
                          size={32}
                          masterworked={isFullyMasterworked(piece)}
                          gearTier={armorPipTier(piece)}
                        />
                      ) : (
                        <span
                          className="d2-brackets size-8 shrink-0 rounded-none bg-black/25"
                          aria-hidden
                        />
                      )}
                      <div className="flex min-w-0 flex-col justify-center">
                        <span className="truncate text-sm">{piece.name}</span>
                        {(piece.power !== undefined ||
                          (piece.masterwork &&
                            piece.masterwork.level < piece.masterwork.max)) && (
                          <div className="flex items-center gap-2">
                            {piece.power !== undefined && (
                              <PowerValue
                                value={piece.power}
                                size="xs"
                                tone="gold"
                                className="shrink-0 items-center gap-0.5 text-xs"
                                title="Power"
                              />
                            )}
                            {piece.masterwork &&
                              piece.masterwork.level < piece.masterwork.max && (
                                <span
                                  className="text-muted-foreground shrink-0 text-xs font-medium tabular-nums"
                                  title={`Masterwork level ${piece.masterwork.level} of ${piece.masterwork.max} — stats shown assume it's finished`}
                                >
                                  MW {piece.masterwork.level}/{piece.masterwork.max}
                                </span>
                              )}
                          </div>
                        )}
                      </div>
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

            <div className="col-span-full -mx-4 border-t border-foreground/8" />

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

            <div className="col-span-full -mx-4 border-t border-foreground/8" />

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
                    if (!piece) return null;
                    if (!mw) {
                      return (
                        <div
                          key={loadout.pieceIds[pi]}
                          className="flex flex-wrap items-center gap-x-3 gap-y-0.5"
                        >
                          <span className="min-w-0 truncate">{piece.name}</span>
                          <span className="text-text-secondary">masterwork unknown</span>
                        </div>
                      );
                    }
                    if (mw.level >= mw.max) return null;
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
                    {masterwork.unknownCostPieces + masterwork.unknownPieces > 0 && (
                      <span className="font-normal text-text-secondary">
                        + {masterwork.unknownCostPieces + masterwork.unknownPieces}{" "}
                        {masterwork.unknownCostPieces + masterwork.unknownPieces === 1
                          ? "piece"
                          : "pieces"}{" "}
                        with an unknown cost
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
            getBuilderState={getBuilderState}
            manifest={manifest}
            insertablePlugs={insertablePlugs}
            onEquipped={onEquipped}
            pieceMap={pieceMap}
            onDream={onDream}
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
      className="flex items-center gap-2.5 rounded-md border border-positive/30 bg-positive/10 px-3 py-2.5"
      aria-live="polite"
    >
      <CheckCircle
        weight="fill"
        className="size-4 shrink-0 text-positive"
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
    <p className="text-xs text-warning">
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
          className="flex items-center gap-2.5 rounded-md border border-foreground/15 bg-lifted px-3 py-2.5"
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
            className="flex items-center gap-2 text-xs text-positive"
            aria-live="polite"
          >
            Stronger builds found
            <Button
              variant="link"
              onClick={onShowPending}
              className="h-auto p-0 text-xs font-medium text-positive"
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
  getBuilderState,
  manifest,
  insertablePlugs,
  onEquipped,
  onDream,
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
  // masterwork materials (see materialScore). Builds with an unknown cost sort last.
  // Synthetic pins (Dreamer's Bond, theoretical exotic class items) report no
  // masterwork at all; they're in every build, so counting them as unknown would
  // make the sort a no-op — skip them, the way summarizeMasterwork does.
  const costOf = useCallback<LoadoutCostFn>(
    (loadout) => {
      let score = 0;
      let known = 0;
      for (const id of loadout.pieceIds) {
        const mw = pieceMap.get(id)?.masterwork;
        if (!mw) continue;
        if (mw.level < mw.max && mw.cost === undefined) return null;
        known++;
        score += materialScore(mw.cost);
      }
      return known > 0 ? score : null;
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
    // search is running, no better list is waiting behind the CTA above, AND the walk
    // that produced this empty list ran to exhaustion. A capped walk (time limit, or a
    // background pass that also timed out / was cancelled) has NOT proven anything —
    // say "none found in time", never "none exist".
    const exhaustive =
      !result.capped || (refinement.phase === "done" && refinement.verified);
    const emptyCopy =
      refinement.phase === "running"
        ? "No builds found in the first pass yet — the deeper search is still running."
        : refinement.phase === "done" && refinement.pending
          ? "The first pass found none — use “Show them” above to load what the full search found."
          : exhaustive
            ? "No loadouts from your gear meet those constraints — even with mods. Try easing a target, a set bonus, or raising your mod budget."
            : "No builds found within the search time limit — some may still exist. Narrow your targets (or ease one) and search again.";
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
            getBuilderState={getBuilderState}
            manifest={manifest}
            insertablePlugs={insertablePlugs}
            onEquipped={onEquipped}
            onDream={onDream}
          />
        ))}
      </div>
    </div>
  );
}
