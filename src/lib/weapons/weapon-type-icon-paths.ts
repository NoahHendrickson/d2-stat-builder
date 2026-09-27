/**
 * In-game HUD weapon-type silhouettes.
 *
 * Bundled from SVGs in the user's asset folder:
 * https://drive.google.com/drive/folders/1fFdeRNYYB4JFdT6VJgJMhkMmZyLeYx9k
 *
 * Served from `/weapon-types/` in the web app.
 */
const WEAPON_TYPE_ICON_SLUG: Readonly<Record<string, string>> = {
  "Auto Rifle": "auto_rifle",
  "Pulse Rifle": "pulse_rifle",
  "Scout Rifle": "scout_rifle",
  "Fusion Rifle": "fusion_rifle",
  "Hand Cannon": "hand_cannon",
  Shotgun: "shotgun",
  "Sniper Rifle": "sniper_rifle",
  "Rocket Launcher": "rocket_launcher",
  Sidearm: "sidearm",
  "Submachine Gun": "smg",
  "Machine Gun": "machinegun",
  "Combat Bow": "bow",
  Sword: "sword",
  Glaive: "glaive",
  "Trace Rifle": "trace_rifle",
  /** Special-slot breech GL silhouette (heavy variant: grenade_launcher_heavy.svg). */
  "Grenade Launcher": "grenade_launcher_special",
  "Linear Fusion Rifle": "linear_fusion_rifle",
};

export const GENERIC_WEAPON_TYPE_ICONS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(WEAPON_TYPE_ICON_SLUG).map(([name, slug]) => [name, `/weapon-types/${slug}.svg`]),
);
