/**
 * The app wears one of two skins, independent of light/dark:
 *
 *  - `classic`: the original rounded, opaque chrome (the default).
 *  - `d2`: the Destiny 2 in-game look — a blurred scene behind translucent
 *    panels, square fields with a centre-bright hairline, uppercase labels.
 *
 * The choice lives on `<html data-skin>` so CSS can key off it: `globals.css`
 * swaps the design tokens per skin and the `classic:` / `d2:` Tailwind
 * variants gate any class that only belongs to one look. The `d2-*` utilities
 * are self-gated and turn into their classic counterparts (or nothing) outside
 * the D2 skin.
 *
 * Persistence is a localStorage key read by an inline script before hydration
 * (see `SKIN_BOOTSTRAP_SCRIPT`), so the first paint already wears the saved skin.
 */
export const SKINS = ["classic", "d2"] as const;
export type Skin = (typeof SKINS)[number];

export const DEFAULT_SKIN: Skin = "classic";
export const SKIN_STORAGE_KEY = "d2sb-skin";
export const SKIN_ATTRIBUTE = "data-skin";

export function isSkin(value: unknown): value is Skin {
  return typeof value === "string" && (SKINS as readonly string[]).includes(value);
}

/** Human-facing names for the toggle and its tooltip. */
export const SKIN_LABELS: Record<Skin, string> = {
  classic: "Classic",
  d2: "Destiny",
};

/**
 * Runs inline as the first thing in `<body>`, before any React code, so the
 * saved skin is on `<html>` before the page paints. Mirrors what next-themes
 * does for `.dark`. Swallows storage errors (private mode, blocked storage).
 */
export const SKIN_BOOTSTRAP_SCRIPT = `(function(){try{var s=localStorage.getItem(${JSON.stringify(
  SKIN_STORAGE_KEY,
)});if(${JSON.stringify([...SKINS])}.indexOf(s)!==-1){document.documentElement.setAttribute(${JSON.stringify(
  SKIN_ATTRIBUTE,
)},s)}}catch(e){}})()`;
