// Which layout the Items page opens in for a browser that has never saved Items settings.
// No imports: app-shell runs settleItemsLayout as it loads, on every page.

/** Where the Items page's view settings are saved (see view-settings.ts). */
export const VIEW_SETTINGS_KEY = "stat-builder:manager-view:v1";
/** The Items settings' "New: character rows" note, opened by itself once per browser. */
export const ITEMS_LAYOUT_INTRO_KEY = "stat-builder:items-layout-intro-seen";
/**
 * The default layout before legacy columns took over (2026-11-03): what a saved view with
 * no layout of its own (saved before the setting existed, or unreadable) has been showing.
 */
export const LAYOUT_BEFORE_LEGACY_DEFAULT = "rows";

/**
 * Legacy columns are the default layout for new browsers only. A browser that's been here
 * before (any of the app's keys saved) but never saved Items settings has been on
 * character rows, so save that for it. A new browser saves legacy columns, and the note on
 * character rows as seen (it's for people moved off the old layout), so this decides once.
 * The rest of the view reads as the defaults. Run it before the app saves anything else.
 */
export function settleItemsLayout(storage: Storage) {
  if (storage.getItem(VIEW_SETTINGS_KEY) !== null) return;
  let returning = false;
  for (let i = 0; i < storage.length; i++) {
    if (storage.key(i)?.startsWith("stat-builder:")) {
      returning = true;
      break;
    }
  }
  const layout = returning ? LAYOUT_BEFORE_LEGACY_DEFAULT : "legacy";
  storage.setItem(VIEW_SETTINGS_KEY, JSON.stringify({ layout }));
  if (!returning) storage.setItem(ITEMS_LAYOUT_INTRO_KEY, "1");
}
