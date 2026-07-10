"use client";

import {
  Fragment,
  memo,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Image from "next/image";
import {
  ArrowDown,
  ArrowSquareOut,
  ArrowUp,
  CaretDown,
  CheckCircle,
  CircleNotch,
  Copy,
  X,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import type { ArmorPiece } from "@/lib/armory/normalize";
import type { ArmorSetInfo } from "@/lib/armory/sets";
import type { ArmoryCharacter } from "@/lib/armory/fetch";
import { isSyntheticClassItemId } from "@/lib/armory/exotic-class-perks";
import {
  CLASS_NAMES,
  STAT_DISPLAY_ORDER,
  STAT_LABELS,
  STAT_ORDER,
  type StatIconMap,
} from "@/lib/armory/stats";
import {
  LOADOUT_SORT_OPTIONS,
  loadoutSortLabel,
  sortLoadouts,
  type LoadoutSortState,
} from "@/lib/builder/sort-loadouts";
import type { StatModHashes } from "@/lib/dim/mod-hashes";
import {
  buildDimLoadout,
  buildDimLoadoutUrl,
  defaultLoadoutName,
} from "@/lib/dim/loadout-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Menu } from "@/components/ui/menu";
import {
  field3dFocusVisibleClasses,
  field3dInteractiveClasses,
  field3dSurfaceClasses,
} from "@/lib/field-surface";
import { cn } from "@/lib/utils";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import {
  equipItemRef,
  lastPlayedCharacter,
  postEquipRequest,
} from "@/lib/bungie/equip-client";
import type {
  AppliedTuning,
  OptimizerLoadout,
  OptimizerOutput,
  RefinementState,
} from "@/lib/optimizer/types";

const MAX_SHOWN = 50;
export { MAX_SHOWN };
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
      <StatGlyph src={statIcons[key]} label={`Artifice +3 ${STAT_LABELS[key]}`} />
      +3
    </span>
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

/** The active subclass's DIM handoff data (undefined hash = unknown subclass/class combo). */
export interface DimSubclassInput {
  name: string;
  itemHash?: number;
  fragmentHashes: number[];
  socketStart: number;
}

interface BuildActionProps {
  characters: ArmoryCharacter[];
  statModHashes: StatModHashes[] | null;
  tuningPlugHashes: Map<string, number> | null;
  artificeModHashes: (number | undefined)[] | null;
  subclass?: DimSubclassInput;
  onEquipped?: () => void;
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
  targets,
  characters,
  statModHashes,
  tuningPlugHashes,
  artificeModHashes,
  subclass,
  onEquipped,
}: {
  loadout: OptimizerLoadout;
  pieceMap: Map<string, ArmorPiece>;
  setMap: Map<number, ArmorSetInfo>;
  statIcons: StatIconMap;
  balancedTuningIcon?: string;
  targets: number[];
} & BuildActionProps) {
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
        className="hover:bg-muted/40 flex w-full items-center gap-3 p-2.5 text-left transition-colors max-lg:gap-2"
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
        <div className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-sm max-lg:gap-x-2">
          {STAT_COLS.map(({ key, i }) => {
            const met = targets[i] > 0 && loadout.stats[i] >= targets[i];
            return (
              <span key={key} className="flex items-center gap-1 tabular-nums">
                <StatGlyph src={statIcons[key]} label={STAT_LABELS[key]} />
                <span className={met ? "text-brand" : "text-foreground"}>
                  {loadout.stats[i]}
                </span>
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
            className="max-lg:hidden shrink-0 px-1.5 py-0 text-[10px]"
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

          <div className="border-border/60 col-span-full my-0.5 border-t" />

          <BreakdownRow label="Armor" render={(i) => loadout.baseStats[i] || ""} />
          <BreakdownRow
            label="Mods"
            render={(i) =>
              loadout.modBonus[i] ? (
                <span className="text-brand/80">+{loadout.modBonus[i]}</span>
              ) : (
                ""
              )
            }
          />
          {loadout.artificeBonus.some((v) => v > 0) && (
            <BreakdownRow
              label="Artifice"
              render={(i) =>
                loadout.artificeBonus[i] ? (
                  <span className="text-brand/80">
                    +{loadout.artificeBonus[i]}
                  </span>
                ) : (
                  ""
                )
              }
            />
          )}
          <BreakdownRow
            label="Tuning"
            render={(i) => {
              const v = loadout.tuningBonus[i];
              if (!v) return "";
              return (
                <span className={v < 0 ? "text-red-400/80" : "text-brand/80"}>
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

          <BuildActions
            loadout={loadout}
            pieces={pieces}
            exoticName={exotic?.name}
            setBadges={setBadges}
            targets={targets}
            characters={characters}
            statModHashes={statModHashes}
            tuningPlugHashes={tuningPlugHashes}
            artificeModHashes={artificeModHashes}
            subclass={subclass}
            onEquipped={onEquipped}
          />
        </div>
      )}
    </div>
  );
});

/**
 * Footer of an expanded build: copy the piece IDs as a DIM search, hand the
 * build to DIM's loadout editor, or pull the pieces to a character and equip
 * them. All need every piece still present in the armory (a refetch can drop
 * instances from stale results).
 */
function BuildActions({
  loadout,
  pieces,
  exoticName,
  setBadges,
  targets,
  characters,
  statModHashes,
  tuningPlugHashes,
  artificeModHashes,
  subclass,
  onEquipped,
}: {
  loadout: OptimizerLoadout;
  pieces: (ArmorPiece | undefined)[];
  exoticName?: string;
  setBadges: { name: string; count: number }[];
  targets: number[];
} & BuildActionProps) {
  const queryClient = useQueryClient();
  const [equipping, setEquipping] = useState(false);

  const resolved = pieces.filter((p): p is ArmorPiece => p !== undefined);
  const complete = resolved.length === loadout.pieceIds.length;
  const hasSynthetic = resolved.some((p) => isSyntheticClassItemId(p.instanceId));
  const buildClass = resolved[0]?.classType;
  const targetCharacter = lastPlayedCharacter(characters, buildClass);

  const missingTitle = !complete
    ? "Refresh your gear — a piece in this build is missing"
    : hasSynthetic
      ? "Theoretical exotic class item roll — equip / DIM need a real instance"
      : undefined;

  const canActOnItems = complete && !hasSynthetic;

  const openInDim = () => {
    if (!canActOnItems || !statModHashes || !tuningPlugHashes || !artificeModHashes)
      return;
    const url = buildDimLoadoutUrl(
      buildDimLoadout({
        loadout,
        pieces: resolved,
        classType: buildClass ?? 3,
        targets,
        statModHashes,
        tuningPlugHashes,
        artificeModHashes,
        subclass:
          subclass?.itemHash !== undefined
            ? {
                itemHash: subclass.itemHash,
                fragmentHashes: subclass.fragmentHashes,
                socketStart: subclass.socketStart,
              }
            : undefined,
        name: defaultLoadoutName({
          exoticName,
          subclassName: subclass?.name,
          sets: setBadges,
          total: loadout.total,
        }),
      }),
    );
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const copyItemIds = async () => {
    if (!canActOnItems) return;
    const query = resolved.map((p) => `id:'${p.instanceId}'`).join(" OR ");
    try {
      await navigator.clipboard.writeText(query);
      toast.success("Item IDs copied — paste into DIM search");
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  };

  const equip = async () => {
    if (!canActOnItems || !targetCharacter || equipping) return;
    setEquipping(true);
    try {
      const results = await postEquipRequest(
        {
          characterId: targetCharacter.id,
          items: resolved.map(equipItemRef),
        },
        { queryClient, failureMessage: "Equip failed" },
      );
      if (!results) return;

      const failed = results.filter((r) => !r.ok);
      if (failed.length === 0) {
        toast.success(
          `Equipped on your ${CLASS_NAMES[buildClass ?? -1] ?? "character"}`,
        );
        onEquipped?.();
      } else {
        const names = failed.map((f) => {
          const piece = resolved.find((p) => p.instanceId === f.itemInstanceId);
          return `${piece?.name ?? "Unknown piece"}: ${f.message ?? "failed"}`;
        });
        toast.warning(
          `Some items didn't equip — ${names.join("; ")}`,
        );
        onEquipped?.();
      }
    } catch {
      toast.error("Equip failed — check your connection and try again");
    } finally {
      setEquipping(false);
    }
  };

  return (
    <div className="border-border/60 col-span-full mt-1 flex items-center justify-end gap-2 border-t py-2.5">
      <Button
        size="sm"
        variant="outline"
        onClick={copyItemIds}
        disabled={!canActOnItems}
        title={missingTitle}
      >
        <Copy weight="duotone" aria-hidden />
        Copy item IDs
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={equip}
        disabled={!canActOnItems || !targetCharacter || equipping}
        title={
          missingTitle ??
          (targetCharacter
            ? undefined
            : `No ${CLASS_NAMES[buildClass ?? -1] ?? "matching"} character`)
        }
      >
        {equipping ? (
          <CircleNotch className="animate-spin" aria-hidden />
        ) : null}
        Equip items
      </Button>
      <Button
        size="sm"
        onClick={openInDim}
        disabled={
          !canActOnItems ||
          !statModHashes ||
          !tuningPlugHashes ||
          !artificeModHashes
        }
        title={missingTitle}
      >
        <ArrowSquareOut weight="duotone" aria-hidden />
        Open in DIM
      </Button>
    </div>
  );
}

/**
 * Search-exactness status above the results. The build list below never changes on its
 * own once shown; post-cap discovery surfaces as the stat sliders' max overlays rising
 * and, when the background search strictly beats the frozen list, as a "Show them"
 * action (the explicit user input that swaps the list). Rendered off the refinement
 * lifecycle: running (live progress), done with a waiting better list (+ optionally
 * higher maxima), higher maxima only, a verified all-clear, or the plain time-limit
 * banner (refinement never resolved, e.g. a worker error or an unverified quiet pass).
 */
function SearchStatus({
  capped,
  refinement,
  onShowPending,
  onCancel,
}: {
  capped: boolean;
  refinement: RefinementState;
  onShowPending: () => void;
  onCancel: () => void;
}) {
  const [improvedDismissed, setImprovedDismissed] = useState(false);
  const showImproved =
    refinement.phase === "done" && refinement.outcome === "improved";
  // Reset dismiss when a new refinement cycle starts (or the improved card goes away).
  useEffect(() => {
    if (!showImproved) setImprovedDismissed(false);
  }, [showImproved]);

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
            {Math.round(refinement.progress * 100)}%)
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
      if (outcome === "improved" && !improvedDismissed) {
        // The running card resolves into this — same alert footprint, green with a
        // check instead of the spinner, so completion reads as the card finishing
        // rather than the status vanishing.
        lines.push(
          <div
            key="improved"
            className="flex items-center gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5"
            aria-live="polite"
          >
            <CheckCircle
              weight="fill"
              className="size-4 shrink-0 text-emerald-600 dark:text-emerald-500"
              aria-hidden
            />
            <p className="text-foreground/90 min-w-0 flex-1 text-sm">
              <span className="font-medium">Higher stat maximums found</span> —
              raise a stat target to explore them.
            </p>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Dismiss"
              onClick={() => setImprovedDismissed(true)}
              className="text-muted-foreground hover:text-foreground shrink-0"
            >
              <X weight="bold" className="size-3.5" aria-hidden />
            </Button>
          </div>,
        );
      } else if (outcome === "confirmed" && !pending) {
        // Only rendered when both halves are PROVEN (walk exhausted + ceilings exact).
        lines.push(
          <p key="confirmed" className="text-muted-foreground text-xs" aria-live="polite">
            Verified — no better builds or higher maximums exist for these targets.
          </p>,
        );
      } else if (outcome === null && verified && !pending) {
        // Build walk proven exhaustive, but some ceiling probes ran out of budget —
        // claim only what was proven.
        lines.push(
          <p key="verified-list" className="text-muted-foreground text-xs" aria-live="polite">
            Search complete — no better builds exist for these targets (stat maximums
            shown are best-effort).
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

/** Compact sort control: each option has up/down arrows to set key + direction. */
export function LoadoutSortControls({
  sort,
  onChange,
}: {
  sort: LoadoutSortState;
  onChange: (next: LoadoutSortState) => void;
}) {
  const DirectionIcon = sort.asc ? ArrowUp : ArrowDown;
  const directionLabel = sort.asc ? "Low to high" : "High to low";
  const triggerLabel = loadoutSortLabel(sort.key);

  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={`Sort by ${triggerLabel}, ${directionLabel}`}
        className={cn(
          "flex h-7 w-fit min-w-28 cursor-pointer items-center justify-between gap-1.5 rounded-[6px] border border-transparent bg-clip-padding py-2 pr-2 pl-2.5 text-[0.8rem] whitespace-nowrap outline-none select-none",
          field3dSurfaceClasses,
          field3dInteractiveClasses,
          field3dFocusVisibleClasses,
        )}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate">{triggerLabel}</span>
          <DirectionIcon
            weight="bold"
            className="size-4 shrink-0"
            aria-hidden
          />
        </span>
        <CaretDown
          weight="duotone"
          className="text-muted-foreground pointer-events-none size-3.5 shrink-0"
          aria-hidden
        />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end">
          <Menu.Popup className="min-w-40 p-1">
            {LOADOUT_SORT_OPTIONS.map((opt) => {
              const active = sort.key === opt.key;
              return (
                <div
                  key={opt.key}
                  className="flex items-center gap-0.5 rounded-md px-1 py-0.5"
                >
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate px-1.5 text-sm",
                      active && "font-medium",
                    )}
                  >
                    {opt.label}
                  </span>
                  <Menu.Item
                    label={`${opt.label} low to high`}
                    aria-label={`Sort by ${opt.label}, low to high`}
                    aria-checked={active && sort.asc}
                    className="size-7 justify-center gap-0 p-0"
                    onClick={() => onChange({ key: opt.key, asc: true })}
                  >
                    <ArrowUp
                      weight="bold"
                      className={cn(
                        "size-4",
                        active && sort.asc
                          ? "text-brand"
                          : "text-muted-foreground",
                      )}
                      aria-hidden
                    />
                  </Menu.Item>
                  <Menu.Item
                    label={`${opt.label} high to low`}
                    aria-label={`Sort by ${opt.label}, high to low`}
                    aria-checked={active && !sort.asc}
                    className="size-7 justify-center gap-0 p-0"
                    onClick={() => onChange({ key: opt.key, asc: false })}
                  >
                    <ArrowDown
                      weight="bold"
                      className={cn(
                        "size-4",
                        active && !sort.asc
                          ? "text-brand"
                          : "text-muted-foreground",
                      )}
                      aria-hidden
                    />
                  </Menu.Item>
                </div>
              );
            })}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

export function BuildResults({
  result,
  refinement,
  onShowPending,
  onCancel,
  pieceMap,
  targets,
  setMap,
  statIcons,
  balancedTuningIcon,
  characters,
  statModHashes,
  tuningPlugHashes,
  artificeModHashes,
  subclass,
  onEquipped,
  sort,
}: {
  result: OptimizerOutput;
  refinement: RefinementState;
  onShowPending: () => void;
  onCancel: () => void;
  pieceMap: Map<string, ArmorPiece>;
  targets: number[];
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
      <div className="space-y-1.5">
        {sortedLoadouts.slice(0, MAX_SHOWN).map((loadout) => (
          <BuildRow
            key={loadout.pieceIds.join("|")}
            loadout={loadout}
            pieceMap={pieceMap}
            setMap={setMap}
            statIcons={statIcons}
            balancedTuningIcon={balancedTuningIcon}
            targets={targets}
            characters={characters}
            statModHashes={statModHashes}
            tuningPlugHashes={tuningPlugHashes}
            artificeModHashes={artificeModHashes}
            subclass={subclass}
            onEquipped={onEquipped}
          />
        ))}
      </div>
    </div>
  );
}
