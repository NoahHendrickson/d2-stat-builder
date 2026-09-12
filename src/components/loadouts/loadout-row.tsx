"use client";

import { TooltipLabel } from "@/components/ui/tooltip";
import { memo, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLineDown,
  ArrowSquareOut,
  CircleNotch,
  Copy,
  DotsThreeVertical,
  PencilSimple,
  ShareFat,
  SlidersHorizontal,
  Trash,
  Warning,
} from "@phosphor-icons/react";
import { toast } from "@/lib/toast";
import type { ArmorPiece } from "@/lib/armory/normalize";
import type { ArmoryCharacter } from "@/lib/armory/fetch";
import type { Manifest } from "@/lib/manifest/load";
import {
  CLASS_NAMES,
  STAT_DISPLAY_ORDER,
  STAT_LABELS,
  STAT_ORDER,
  type StatIconMap,
} from "@/lib/armory/stats";
import { lastPlayedCharacter } from "@/lib/bungie/equip-client";
import { buildDimLoadoutUrl } from "@/lib/dim/loadout-link";
import { applySavedLoadout } from "@/lib/loadouts/apply-client";
import { formatRelativeTime } from "@/lib/armor-table/relative-time";
import { resolveLoadout } from "@/lib/loadouts/resolve";
import type { SavedLoadout } from "@/lib/loadouts/types";
import { StatGlyph } from "@/components/stat-glyph";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { LoadoutRowDetails } from "@/components/loadouts/loadout-row-details";

const STAT_COLS = STAT_DISPLAY_ORDER.map((key) => ({
  key,
  i: STAT_ORDER.indexOf(key),
}));

/**
 * One saved loadout as a sidebar card (Figma "Attachment", 1:1209): name with Equip and
 * the actions menu, a row of chips, and the stat line. Clicking the name expands the
 * piece-by-piece breakdown (see LoadoutRowDetails).
 *
 * Memoized: the list renders (virtualized) rows with stable, loadout-taking callbacks,
 * so a keystroke in the search box or one row's expansion doesn't re-render every other
 * row. Expansion lives in the list so it survives the row scrolling out of the window.
 */
export const LoadoutRow = memo(function LoadoutRow({
  saved,
  open,
  onToggle,
  pieceMap,
  manifest,
  characters,
  statIcons,
  balancedTuningIcon,
  now,
  onEdit,
  onDuplicate,
  onDelete,
  onShare,
  onOptimize,
  onArmoryChanged,
}: {
  saved: SavedLoadout;
  open: boolean;
  onToggle: (id: string) => void;
  pieceMap: ReadonlyMap<string, ArmorPiece>;
  manifest: Manifest;
  characters: ArmoryCharacter[];
  statIcons: StatIconMap;
  balancedTuningIcon?: string;
  /** Reference time for "edited … ago" (captured once by the list). */
  now: number;
  onEdit: (saved: SavedLoadout) => void;
  onDuplicate: (saved: SavedLoadout) => void;
  onDelete: (saved: SavedLoadout) => void;
  onShare: (saved: SavedLoadout) => void;
  /** Load the loadout's targets into the optimizer to look for better builds. */
  onOptimize: (saved: SavedLoadout) => void;
  onArmoryChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const [applying, setApplying] = useState(false);
  const { loadout, optimizer } = saved;

  const resolved = useMemo(
    () => resolveLoadout(loadout, pieceMap, manifest),
    [loadout, pieceMap, manifest],
  );

  const className =
    loadout.classType === 3 ? "Any class" : CLASS_NAMES[loadout.classType];
  const targetCharacter = lastPlayedCharacter(
    characters,
    loadout.classType === 3
      ? resolved.armor[0]?.piece?.classType
      : loadout.classType,
  );
  const canApply = resolved.actionable && !!targetCharacter && !applying;

  const applyLoadout = async () => {
    if (!resolved.actionable || !targetCharacter || applying) return;
    setApplying(true);
    try {
      const outcome = await applySavedLoadout({
        saved,
        resolved,
        character: targetCharacter,
        armory: pieceMap.values(),
        manifest,
        queryClient,
      });
      if (outcome) onArmoryChanged();
    } catch {
      toast.error("Apply failed — check your connection and try again");
    } finally {
      setApplying(false);
    }
  };

  const copyItemIds = async () => {
    if (!resolved.actionable) return;
    const query = resolved.armor.map((a) => `id:'${a.ref.id}'`).join(" OR ");
    try {
      await navigator.clipboard.writeText(query);
      toast.success("Item IDs copied — paste into DIM search");
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  };

  const openInDim = () => {
    window.open(buildDimLoadoutUrl(loadout), "_blank", "noopener,noreferrer");
  };

  return (
    <div className="border-border flex flex-col gap-4 border-b px-4 py-2">
      <div className="flex flex-col gap-2">
        <div className="flex h-8 items-center justify-between gap-2">
          <TooltipLabel
            label={`${className}${resolved.subclass?.subclass ? ` · ${resolved.subclass.subclass}` : ""} · edited ${formatRelativeTime(saved.updatedAt, now)}`}
          >
            <button
              type="button"
              onClick={() => onToggle(saved.id)}
              aria-expanded={open}
              className="hover:text-foreground/80 flex min-w-0 flex-1 items-center gap-1.5 text-left text-base leading-6 transition-colors"
            >
              <span className="truncate">{loadout.name}</span>
              {resolved.missing && (
                <Warning
                  weight="fill"
                  className="size-4 shrink-0 text-amber-500"
                  aria-label="Missing items"
                />
              )}
            </button>
          </TooltipLabel>
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              variant="emphatic"
              className="equip-button"
              onClick={applyLoadout}
              disabled={!canApply}
            >
              {applying && (
                <CircleNotch className="animate-spin" aria-hidden />
              )}
              Equip
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button size="icon" variant="ghost" />}
                aria-label={`Actions for ${loadout.name}`}
              >
                <DotsThreeVertical
                  weight="bold"
                  className="size-4"
                  aria-hidden
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-50">
                <DropdownMenuItem onClick={() => onOptimize(saved)}>
                  <SlidersHorizontal weight="duotone" aria-hidden />
                  Optimize
                </DropdownMenuItem>
                <DropdownMenuItem onClick={applyLoadout} disabled={!canApply}>
                  <ArrowLineDown weight="duotone" aria-hidden />
                  Equip
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onEdit(saved)}>
                  <PencilSimple weight="duotone" aria-hidden />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onShare(saved)}>
                  <ShareFat weight="duotone" aria-hidden />
                  Share
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onDuplicate(saved)}>
                  <Copy weight="duotone" aria-hidden />
                  Duplicate
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={copyItemIds}
                  disabled={!resolved.actionable}
                >
                  <Copy weight="duotone" aria-hidden />
                  Copy item IDs
                </DropdownMenuItem>
                <DropdownMenuItem onClick={openInDim}>
                  <ArrowSquareOut weight="duotone" aria-hidden />
                  Open in DIM
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => onDelete(saved)}
                >
                  <Trash weight="duotone" aria-hidden />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <LoadoutRowDetails
          part="chips"
          saved={saved}
          resolved={resolved}
          manifest={manifest}
          characters={characters}
          statIcons={statIcons}
          balancedTuningIcon={balancedTuningIcon}
          now={now}
        />
      </div>

      {optimizer ? (
        <div className="flex items-start justify-between gap-1 text-xs leading-4 tabular-nums">
          <TooltipLabel label="Total stats">
            <span tabIndex={0}>{optimizer.total}</span>
          </TooltipLabel>
          {STAT_COLS.map(({ key, i }) => {
            const value = optimizer.stats[i];
            return (
              <span key={key} className="flex items-center gap-0.5">
                <StatGlyph
                  src={statIcons[key]}
                  label={STAT_LABELS[key]}
                  className="opacity-65"
                />
                <span className={cn(value === 0 && "text-muted-foreground")}>
                  {value}
                </span>
              </span>
            );
          })}
        </div>
      ) : (
        <p className="text-muted-foreground text-xs leading-4">
          {className}
          {resolved.subclass?.subclass ? ` · ${resolved.subclass.subclass}` : ""}{" "}
          · edited {formatRelativeTime(saved.updatedAt, now)}
        </p>
      )}

      <LoadoutRowDetails
        part="expanded"
        open={open}
        saved={saved}
        resolved={resolved}
        manifest={manifest}
        characters={characters}
        statIcons={statIcons}
        balancedTuningIcon={balancedTuningIcon}
        now={now}
      />
    </div>
  );
});
