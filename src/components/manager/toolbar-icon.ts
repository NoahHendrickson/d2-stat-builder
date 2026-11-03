/**
 * The Items toolbar's icon buttons (search help, bulk actions, sort and group, settings):
 * square, muted until hovered, then the page's hover ring and light fill, which stay on
 * while the button's menu is open. Normal theme rounds them and drops the ring.
 */
export const TOOLBAR_ICON_BUTTON =
  "d2-hover-ring text-muted-foreground flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-none normal:rounded-[10px] outline-none transition-[color,background-color,outline-offset] hover:bg-foreground/6 hover:text-foreground data-popup-open:bg-foreground/6 data-popup-open:text-foreground focus-visible:ring-1 focus-visible:ring-outline-strong [&_svg]:size-4";
