import { HugeiconsIcon } from "@hugeicons/react";
import { TAG_ICONS } from "@/components/manager/tag-icons";
import { cn } from "@/lib/utils";

/**
 * The Favorite tag's heart: a pink outline over a lighter pink fill (the free icon set is
 * stroke-only, so the duotone fill is CSS on the outline's path). `filled={false}` is
 * the plain outline a toggle shows while off.
 */
export function FavoriteHeart({
  filled = true,
  className,
}: {
  filled?: boolean;
  className?: string;
}) {
  return (
    <HugeiconsIcon
      icon={TAG_ICONS.favorite}
      strokeWidth={2}
      className={cn("size-3 shrink-0", filled && "text-pink-400 fill-pink-400/35", className)}
      aria-hidden
    />
  );
}
