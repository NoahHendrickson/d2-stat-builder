"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, CleanIcon } from "@hugeicons/core-free-icons";
import { USAGE_BUCKET_LABELS } from "@/lib/build-usage/buckets";
import { CLEANUP_TIERS, type CleanupTier } from "@/lib/armor-table/cleanup";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Both halves of the Cleanup split button turn rose while it's on, outline included
 * (the Duplicates button's amber treatment, in its own hue).
 */
const CLEANUP_ON =
  "bg-rose-500/20 text-rose-800 hover:bg-rose-500/28 aria-expanded:bg-rose-500/28 dark:text-rose-200 [border-image-source:none]! border-rose-500/55! hover:border-rose-500/75! aria-expanded:border-rose-500/75!";

export interface CleanupButtonProps {
  on: boolean;
  onToggle: () => void;
  tiers: readonly CleanupTier[];
  /** Changes which ratings show, and turns Cleanup on. */
  onTiersChange: (tiers: CleanupTier[]) => void;
  /** Pieces per rating, within the table's other filters. */
  counts: Record<CleanupTier, number>;
  /** Pieces Cleanup is showing that "Mark as junk" would tag. */
  junkable: number;
  onMarkJunk: () => void;
  /** Set right after a mark: how many pieces Undo would restore. */
  undoable: number;
  onUndoJunk: () => void;
}

/**
 * Cleanup as a split button: the left half shows only the pieces the optimizer rarely
 * or never uses, grouped by class and slot; the arrow explains the feature, picks the
 * ratings, and tags them all as junk.
 */
export function CleanupButton({
  on,
  onToggle,
  tiers,
  onTiersChange,
  counts,
  junkable,
  onMarkJunk,
  undoable,
  onUndoJunk,
}: CleanupButtonProps) {
  const toggleTier = (tier: CleanupTier, checked: boolean) =>
    onTiersChange(
      checked
        ? CLEANUP_TIERS.filter((t) => t === tier || tiers.includes(t))
        : tiers.filter((t) => t !== tier),
    );

  return (
    <div className="flex shrink-0">
      <Button
        type="button"
        variant="outline"
        aria-pressed={on}
        title="Show only the pieces your optimizer searches rarely or never use"
        className={cn("normal:rounded-r-none", on && CLEANUP_ON)}
        onClick={onToggle}
      >
        <HugeiconsIcon icon={CleanIcon} data-icon="inline-start" aria-hidden />
        Cleanup
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Cleanup options"
          render={
            <Button
              variant="outline"
              size="icon"
              className={cn("-ml-px w-7 normal:rounded-l-none", on && CLEANUP_ON)}
            />
          }
        >
          <HugeiconsIcon icon={ArrowDown01Icon} aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <p className="text-foreground px-1.5 py-2 text-sm">
            We track when a piece of armor is &lsquo;used&rsquo; in a build. So you can identify
            pieces that never make it into a build and possibly delete them.
          </p>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>Show pieces that are</DropdownMenuLabel>
            {CLEANUP_TIERS.map((tier) => (
              <DropdownMenuCheckboxItem
                key={tier}
                indicator="start"
                closeOnClick={false}
                checked={tiers.includes(tier)}
                onCheckedChange={(checked) => toggleTier(tier, checked === true)}
              >
                <span className="min-w-0 flex-1 truncate">{USAGE_BUCKET_LABELS[tier]}</span>
                <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                  {counts[tier]}
                </span>
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          {undoable > 0 ? (
            <DropdownMenuItem onClick={onUndoJunk}>
              Undo junk on {undoable} {undoable === 1 ? "piece" : "pieces"}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem disabled={!on || junkable === 0} onClick={onMarkJunk}>
              Mark {on && junkable > 0 ? `${junkable} ` : ""}
              {junkable === 1 ? "piece" : "pieces"} as junk
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
