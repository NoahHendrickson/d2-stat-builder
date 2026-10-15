"use client";

import { FavoriteHeart } from "@/components/favorite-heart";
import { Button } from "@/components/ui/button";
import { TooltipLabel } from "@/components/ui/tooltip";
import { isSyntheticClassItemId } from "@/lib/armory/exotic-class-perks";
import type { ArmorPiece } from "@/lib/armory/normalize";
import {
  annotationsStore,
  setTag,
  useTagMask,
  type ItemTag,
} from "@/lib/inventory/annotations";
import { toast } from "@/lib/toast";

/** Which of a build's pieces are tagged Favorite, and the toggle that tags them all. */
export interface BuildFavorites {
  /** Whether `pieceIds[i]` is a favorite. */
  has(i: number): boolean;
  /** Favorites among the pieces that can be tagged. */
  count: number;
  /** Pieces that can be tagged: real instances still in the armory (a theoretical class
   *  item or Dreamer's Bond has no instance, and a refetch can drop one). */
  total: number;
  all: boolean;
  /** Favorite every taggable piece, or with all of them favorites already, unfavorite them. */
  toggle(): void;
}

/**
 * Tags that "Favorite these pieces" replaced (an item holds one tag), by instance id, so
 * "Unfavorite these pieces" can put them back. Kept for the session only.
 */
const replacedTags = new Map<string, ItemTag>();

export function useBuildFavorites(
  pieceIds: readonly string[],
  pieces: readonly (ArmorPiece | undefined)[],
): BuildFavorites {
  const mask = useTagMask(pieceIds, "favorite");
  const has = (i: number) => (mask & (1 << i)) !== 0;
  const taggable = pieceIds.flatMap((id, i) =>
    pieces[i] && !isSyntheticClassItemId(id) ? [i] : [],
  );
  const count = taggable.filter(has).length;
  const total = taggable.length;
  const all = total > 0 && count === total;

  const toggle = () => {
    if (total === 0) return;
    const ids = taggable.map((i) => pieceIds[i]);
    const pieceWord = ids.length === 1 ? "piece" : "pieces";
    if (all) {
      const byTag = new Map<ItemTag | undefined, string[]>();
      for (const id of ids) {
        const tag = replacedTags.get(id);
        replacedTags.delete(id);
        byTag.set(tag, [...(byTag.get(tag) ?? []), id]);
      }
      for (const [tag, group] of byTag) setTag(group, tag);
      toast.success(`Removed ${ids.length} ${pieceWord} from favorites`);
      return;
    }
    const tags = annotationsStore.get();
    let replaced = 0;
    for (const id of ids) {
      const tag = tags[id]?.tag;
      if (tag && tag !== "favorite") {
        replacedTags.set(id, tag);
        replaced++;
      }
    }
    setTag(ids, "favorite");
    toast.success(
      `Favorited ${ids.length} ${pieceWord}`,
      replaced === 1
        ? "1 had another tag. Unfavorite these pieces puts it back."
        : replaced > 1
          ? `${replaced} had other tags. Unfavorite these pieces puts them back.`
          : undefined,
    );
  };

  return { has, count, total, all, toggle };
}

/** The header's heart beside the gear power: a count until every piece is a favorite. */
export function FavoritesBadge({ favorites }: { favorites: BuildFavorites }) {
  if (favorites.count === 0) return null;
  return (
    <span
      className="inline-flex items-center gap-0.5 text-xs font-medium tabular-nums"
      title={
        favorites.all
          ? "Every piece is a favorite"
          : `${favorites.count} of ${favorites.total} pieces are favorites`
      }
    >
      <FavoriteHeart />
      {!favorites.all && favorites.count}
    </span>
  );
}

/** The expanded build's "Favorite these pieces" toggle, under its pieces. */
export function FavoriteBuildButton({ favorites }: { favorites: BuildFavorites }) {
  const disabled = favorites.total === 0;
  return (
    <TooltipLabel
      label={disabled ? "Refresh your gear — a piece in this build is missing" : undefined}
      disabled={disabled}
    >
      <Button
        variant="outline"
        size="sm"
        onClick={favorites.toggle}
        disabled={disabled}
        aria-pressed={favorites.all}
        className="w-fit"
      >
        <FavoriteHeart filled={favorites.all} className="size-3.5" />
        {favorites.all ? "Unfavorite these pieces" : "Favorite these pieces"}
      </Button>
    </TooltipLabel>
  );
}
