"use client";

import { TooltipLabel } from "@/components/ui/tooltip";
import { memo, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLineDown,
  ArrowSquareOut,
  CaretDown,
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
import { loadoutHashtags, type SavedLoadout } from "@/lib/loadouts/types";
import { LoadoutTagAssignSubmenu } from "@/components/loadouts/loadout-tag-menu";
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
import {
  LoadoutRowDetails,
  loadoutSetBonuses,
  SetBonusChip,
} from "@/components/loadouts/loadout-row-details";
import { LoadoutCardBody } from "@/components/loadouts/loadout-card-body";

const STAT_COLS = STAT_DISPLAY_ORDER.map((key) => ({
  key,
  i: STAT_ORDER.indexOf(key),
}));

/**
 * One saved loadout as a large card on the loadouts page: name, set bonuses, the stat
 * line (which toggles the stat breakdown), Equip and the actions menu across the top,
 * then the body laid out like the editor drawer (see LoadoutCardBody).
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
  provisional = false,
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
  allTags,
  onSetTag,
}: {
  saved: SavedLoadout;
  open: boolean;
  onToggle: (id: string) => void;
  pieceMap: ReadonlyMap<string, ArmorPiece>;
  /** The pieces are last visit's copy; Equip waits for the live profile. */
  provisional?: boolean;
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
  /** Every hashtag across the library, for the Tag submenu. */
  allTags: readonly string[];
  onSetTag: (saved: SavedLoadout, tag: string, present: boolean) => void;
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
  const canApply = resolved.actionable && !!targetCharacter && !applying && !provisional;

  const applyLoadout = async () => {
    if (!canApply || !targetCharacter) return;
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

  const setBonuses = useMemo(
    () => loadoutSetBonuses(saved, manifest),
    [saved, manifest],
  );
  const meta = `${className}${resolved.subclass?.subclass ? ` · ${resolved.subclass.subclass}` : ""} · edited ${formatRelativeTime(saved.updatedAt, now)}`;

  return (
    <article
      aria-label={loadout.name}
      className="@container d2-card-frame flex flex-col gap-4 p-4 [--card-line-width:1.5px] hover:[--line-alpha:1.6]"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-48 flex-col">
          <h3 className="flex min-w-0 items-center gap-1.5 text-base leading-6 font-medium">
            <span className="truncate">{loadout.name}</span>
            {resolved.missing && (
              <TooltipLabel label="Some pieces aren't in your inventory">
                <Warning
                  weight="fill"
                  tabIndex={0}
                  className="size-4 shrink-0 text-warning"
                  aria-label="Missing items"
                />
              </TooltipLabel>
            )}
          </h3>
          <p className="text-muted-foreground truncate text-xs leading-4">{meta}</p>
        </div>

        <SetBonusChip bonuses={setBonuses} />

        <button
          type="button"
          onClick={() => onToggle(saved.id)}
          aria-expanded={open}
          aria-label={open ? "Hide stat breakdown" : "Show stat breakdown"}
          className="text-foreground hover:bg-foreground/6 flex h-8 items-center gap-3 rounded-none px-2 text-xs leading-4 tabular-nums outline-none transition-colors focus-visible:ring-1 focus-visible:ring-outline-strong"
        >
          {optimizer ? (
            <>
              <span className="font-medium">{optimizer.total}</span>
              {STAT_COLS.map(({ key, i }) => {
                const value = optimizer.stats[i];
                return (
                  <span key={key} className="flex items-center gap-0.5">
                    <StatGlyph
                      src={statIcons[key]}
                      label={STAT_LABELS[key]}
                      className="size-3 opacity-65"
                    />
                    <span className={cn(value === 0 && "text-muted-foreground")}>
                      {value}
                    </span>
                  </span>
                );
              })}
            </>
          ) : (
            <span className="text-muted-foreground">Details</span>
          )}
          <CaretDown
            weight="bold"
            className={cn(
              "text-muted-foreground size-3 transition-transform",
              open && "rotate-180",
            )}
            aria-hidden
          />
        </button>

        <div className="flex shrink-0 items-center gap-2">
          <TooltipLabel
            label={provisional ? "Refreshing your gear from Bungie…" : undefined}
            disabled={!provisional}
          >
            <Button
              variant="emphatic"
              size="xs"
              className="h-8 gap-1.5 px-4"
              onClick={applyLoadout}
              disabled={!canApply}
            >
              {applying && <CircleNotch className="animate-spin" aria-hidden />}
              Equip
            </Button>
          </TooltipLabel>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button size="icon" variant="dashed" />}
              aria-label={`Actions for ${loadout.name}`}
            >
              <DotsThreeVertical weight="bold" className="size-4" aria-hidden />
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
              <LoadoutTagAssignSubmenu
                assigned={loadoutHashtags(loadout)}
                tags={allTags}
                onToggle={(tag, checked) => onSetTag(saved, tag, checked)}
                onCreate={(tag) => onSetTag(saved, tag, true)}
              />
              <DropdownMenuItem onClick={() => onShare(saved)}>
                <ShareFat weight="duotone" aria-hidden />
                Share
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onDuplicate(saved)}>
                <Copy weight="duotone" aria-hidden />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem onClick={copyItemIds} disabled={!resolved.actionable}>
                <Copy weight="duotone" aria-hidden />
                Copy item IDs
              </DropdownMenuItem>
              <DropdownMenuItem onClick={openInDim}>
                <ArrowSquareOut weight="duotone" aria-hidden />
                Open in DIM
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => onDelete(saved)}>
                <Trash weight="duotone" aria-hidden />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {loadout.notes && (
        <p className="text-muted-foreground -mt-2 line-clamp-2 text-sm whitespace-pre-wrap">
          {loadout.notes}
        </p>
      )}

      <LoadoutCardBody
        saved={saved}
        resolved={resolved}
        manifest={manifest}
        statIcons={statIcons}
        balancedTuningIcon={balancedTuningIcon}
      />

      {open && (
        <LoadoutRowDetails
          saved={saved}
          resolved={resolved}
          manifest={manifest}
          characters={characters}
          statIcons={statIcons}
          balancedTuningIcon={balancedTuningIcon}
        />
      )}
    </article>
  );
});
