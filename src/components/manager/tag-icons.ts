import type { IconSvgElement } from "@hugeicons/react";
import {
  Archive02Icon,
  Delete02Icon,
  FavouriteIcon,
  FlashIcon,
  Tag01Icon,
} from "@hugeicons/core-free-icons";
import type { ItemTag } from "@/lib/inventory/annotations";

/** DIM's tag glyphs: heart, tag, bin, bolt, archive box. */
export const TAG_ICONS: Record<ItemTag, IconSvgElement> = {
  favorite: FavouriteIcon,
  keep: Tag01Icon,
  junk: Delete02Icon,
  infuse: FlashIcon,
  archive: Archive02Icon,
};
