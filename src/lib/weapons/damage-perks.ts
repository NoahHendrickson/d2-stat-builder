import type { PerkRef } from "./types";

/**
 * Damage-perk classification: a perk counts as a "damage perk" when it boosts the
 * damage dealt by the weapon itself (Frenzy, Bait and Switch, Elemental Honing, …).
 *
 * Classification is a description-text heuristic with curated name overrides for
 * the cases the heuristic gets wrong. Defensive perks (damage resist), ability
 * boosts (melee/grenade damage), and trigger clauses ("dealing sustained damage…")
 * are deliberately not damage perks.
 */

/** Perks that ARE damage perks even though the description heuristic misses them. */
const CURATED_INCLUDE: ReadonlySet<string> = new Set<string>([
  // "…increases the next projectile's blast radius and damage" — gap too wide for the heuristic.
  "explosive light",
]);

/** Perks that are NOT damage perks even though the description heuristic matches them. */
const CURATED_EXCLUDE: ReadonlySet<string> = new Set<string>([
  // Heuristic false positives:
  // "…builds more quickly as you deal more damage with other weapons" — charge-speed perk.
  "anticipation",
  // "…adapts its damage output…" — shield-matching utility, not a damage buff.
  "adaptive munitions",
  // User-curated exclusions (canvas review, 2026-06-11):
  "adagio",
  "adaptive ordnance",
  "adrenaline junkie",
  "assassin's blade",
  "binary orbit",
  "blessing of the sky",
  "blunt execution rounds",
  "box breathing",
  "broadside",
  "bullwhacker",
  "circle of life",
  "counterattack",
  "dark-forged trigger",
  "death at first glance",
  "deconstruct",
  "disease vector",
  "dual speed receiver",
  "dynamic charge",
  "en garde",
  "eyes up, guardian",
  "for the empire",
  "golden tricorn",
  "gutshot straight",
  "harmony",
  "headseeker",
  "heavy bolts",
  "impetus",
  "inverse relationship",
  "ionic return",
  "kickstart",
  "kill clip",
  "killing tally",
  "magnificent howl",
  "markov chain",
  "master of arms",
  "mega kill clip",
  "multikill clip",
  "nano-assault",
  "on black wings",
  "one for all",
  "one for all refit",
  "paracausal imbuement",
  "parasitism",
  "pick your poison",
  "power surge",
  "property: irreducible",
  "rampage",
  "release the wolves",
  "remote shield",
  "shatter shot",
  "shattering blade",
  "shot in the dark",
  "silkbound slayer",
  "spindle",
  "stopping power",
  "storm and stress",
  "swashbuckler",
  "swooping talons",
  "sword logic",
  "taken predator",
  "target acquired",
  "target lock refit",
  "temporal alignment refit",
  "the fundamentals",
  "the roadborn",
  "thin the herd",
  "transcendent duelist",
  "under-over",
  "unstoppable force",
  "vorpal weapon refit",
  "weighted edge",
  "whispered breathing",
]);

/**
 * Phrases that indicate a damage buff. Word gaps allow forms like
 * "increases this weapon's damage" or "increased body shot damage".
 */
const POSITIVE_PATTERNS: readonly RegExp[] = [
  /\b(?:increased|bonus|extra|additional|more|improved)\s+(?:[\w'’,]+\s+){0,4}?damage\b/,
  /\b(?:increases?|increasing|boosts?|boosting|enhances?|enhancing|improves?|improving)\s+(?:[\w'’]+\s+){0,3}?damage\b/,
  /\bdamage\s+(?:bonus|boost|buff)\b/,
  /\bdamage\s+(?:[\w'’,]+\s+){0,5}?(?:is|are)\s+increased\b/,
  /\bdamage\s+increases\b/,
  /\b(?:grants?|gains?)\s+(?:[\w'’]+\s+){0,2}?(?:precision|weapon)\s+damage\b/,
];

/** Sentence-level vetoes: ability-damage boosts, defensive text, range falloff, DoT. */
const NEGATIVE_PATTERNS: readonly RegExp[] = [
  /\b(?:melee|grenade|ability|super|sparrow|vehicle)\s+damage\b/,
  /\bdamage\s+(?:resist\w*|reduction|taken|falloff|over\s+time)\b/,
  /\bincoming\s+damage\b/,
  /\b(?:less|reduced)\s+damage\b/,
  /\breduc\w*\s+damage\b/,
  /\b(?:taking|receiving)\s+(?:[\w'’]+\s+)?damage\b/,
  // Explosion-on-kill perks (Dragonfly family) add an effect, not a weapon damage buff.
  /\bdamage\s+explosion\b/,
];

/** Split on sentence enders and bullet markers so a veto only suppresses its own clause. */
function sentences(text: string): string[] {
  return text
    .toLowerCase()
    .split(/(?<=[.!?])\s+|\n+|•/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function descriptionIndicatesDamage(text: string | undefined): boolean {
  if (!text) return false;
  return sentences(text).some(
    (sentence) =>
      POSITIVE_PATTERNS.some((pattern) => pattern.test(sentence)) &&
      !NEGATIVE_PATTERNS.some((pattern) => pattern.test(sentence)),
  );
}

/** True when `perk` boosts the weapon's own damage output. */
export function isDamagePerk(perk: PerkRef): boolean {
  const name = perk.name.toLowerCase();
  if (CURATED_INCLUDE.has(name)) return true;
  if (CURATED_EXCLUDE.has(name)) return false;
  return (
    descriptionIndicatesDamage(perk.description) ||
    descriptionIndicatesDamage(perk.enhancedDescription)
  );
}

const indexSetCache = new WeakMap<readonly PerkRef[], ReadonlySet<number>>();

/**
 * Indices into `perks` that classify as damage perks. Cached per catalog array so
 * `filterWeapons` doesn't re-run the regex heuristic on every keystroke.
 */
export function damagePerkIndexSet(perks: readonly PerkRef[]): ReadonlySet<number> {
  const cached = indexSetCache.get(perks);
  if (cached) return cached;
  const set = new Set<number>();
  for (let i = 0; i < perks.length; i++) {
    const perk = perks[i];
    if (perk && isDamagePerk(perk)) set.add(i);
  }
  indexSetCache.set(perks, set);
  return set;
}

/** Lowercased names of all damage perks in a catalog (for filter UI options). */
export function collectDamagePerkNames(perks: readonly PerkRef[]): ReadonlySet<string> {
  const names = new Set<string>();
  for (const index of damagePerkIndexSet(perks)) {
    const perk = perks[index];
    if (perk) names.add(perk.name.toLowerCase());
  }
  return names;
}
