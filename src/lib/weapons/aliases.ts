/**
 * Community shorthands → canonical search terms.
 *
 * Players type abbreviations ("hc", "smg") and nicknames far more than full
 * weapon-type names. Expanding these before ranking lets the existing
 * type/perk matchers light up without each surface re-implementing the slang.
 * Keep values lowercase and aligned with manifest `itemTypeDisplayName` words so
 * fuzzy/substring matching resolves them.
 */
export const WEAPON_NAME_ALIASES: Readonly<Record<string, string>> = {
  hc: "hand cannon",
  ar: "auto rifle",
  smg: "submachine gun",
  pr: "pulse rifle",
  pulse: "pulse rifle",
  scout: "scout rifle",
  sniper: "sniper rifle",
  snipe: "sniper rifle",
  shotty: "shotgun",
  fr: "fusion rifle",
  fusion: "fusion rifle",
  lfr: "linear fusion rifle",
  linear: "linear fusion rifle",
  gl: "grenade launcher",
  rl: "rocket launcher",
  rocket: "rocket launcher",
  lmg: "machine gun",
  mg: "machine gun",
  trace: "trace rifle",
  sidearm: "sidearm",
  glaive: "glaive",
  sword: "sword",
  bow: "bow",
};

/**
 * Expand a single token (case-insensitive) to its canonical term, or return it
 * unchanged. Only whole-token aliases are expanded so weapon names that merely
 * contain an abbreviation are never corrupted.
 */
export function expandWeaponQueryAliases(token: string): string {
  const key = token.trim().toLowerCase();
  if (!key) return token;
  return WEAPON_NAME_ALIASES[key] ?? token;
}
