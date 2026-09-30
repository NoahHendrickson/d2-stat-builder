/** Raw investment-stat delta from a plug (pre stat-group scaling). */
export interface StatMod {
  hash: number;
  value: number;
}

/** A single perk option that can appear in a weapon's column. */
export interface PerkRef {
  hash: number;
  name: string;
  /** Bungie icon path; prefix with https://www.bungie.net to render. */
  icon?: string;
  /** Whether this perk can currently drop (vs. sunset/retired). */
  currentlyCanRoll: boolean;
  /** Bungie tooltip text for the base-tier plug. */
  description?: string;
  /** Bungie tooltip text for the enhanced-tier plug (if one exists). */
  enhancedDescription?: string;
  /** Other plug hashes for the same perk (e.g. enhanced tier) — not shown separately in the UI. */
  alternateHashes?: number[];
  /** Non-conditional investment stat modifiers when this plug is selected. */
  statMods?: StatMod[];
  /** `statMods` keyed by stat name ("Handling": 10); what the browser ships. */
  stats?: Record<string, number>;
}

/** One perk column on a weapon (barrel, magazine, a trait slot, origin, …). */
export interface PerkColumn {
  /** Best-effort label: Intrinsic, Barrel, Magazine, Trait, Origin Trait, … */
  kind: string;
  perks: PerkRef[];
}

/** Interned column — perk indices reference WeaponIndex.perks. */
export interface InternedPerkColumn {
  kind: string;
  perkIndices: number[];
}

export interface WeaponStat {
  hash: number;
  name: string;
  value: number;
}

/** Lightweight weapon record for browse/search (no screenshot, flavor, stats, or inline perk text). */
export interface WeaponSummary {
  hash: number;
  name: string;
  icon?: string;
  watermark?: string;
  /** itemTypeDisplayName, e.g. "Hand Cannon", "Fusion Rifle". */
  type: string;
  /** Default damage type / element, e.g. "Solar", "Arc", "Kinetic". */
  element: string;
  /** "Primary" | "Special" | "Heavy". */
  ammo: string;
  /** Tier name, e.g. "Legendary", "Exotic". */
  rarity: string;
  /** Equipment slot bucket: "Kinetic" | "Energy" | "Power". */
  slot: string;
  /** Intrinsic archetype name, e.g. "Adaptive Frame". */
  frame?: string;
  /** Champions the weapon stuns on its own: "Barrier" | "Overload" | "Unstoppable". */
  champions?: string[];
  craftable: boolean;
  adept: boolean;
  /** Destiny season number when introduced (from manifest seasonHash). */
  seasonNumber?: number;
  /** Destiny season display name, e.g. "Season of the Wish". */
  seasonName?: string;
  /** Acquisition source from the collectible definition, e.g. "Root of Nightmares". */
  source?: string;
  /** All acquisition/activity sources for shared loot pools; includes `source` when present. */
  sources?: string[];
  /** Manifest investment-table index — proxy for add order when season is unknown. */
  releaseIndex: number;
  /** Legacy item hash superseded by a newer same-name def (still kept for direct URL / vault). */
  superseded?: boolean;
  /** Base Ammo Generation display value (0–100); omitted when the weapon has no such stat. */
  ammoGeneration?: number;
  /** Base investment stats by name, for the stats the game displays (nonzero); see `statCurves`. */
  statInvestment?: Record<string, number>;
  /** Keys `WeaponIndex.statCurves`, which turn investment values into displayed ones. */
  statGroupHash?: number;
  /** Full-tier masterwork choices as indices into `WeaponIndex.perks`. */
  masterworks?: number[];
  columns: InternedPerkColumn[];
  /** Every perk name across all columns (deduped) — powers reverse perk search. */
  perks: string[];
  /** Lowercase perk names (precomputed at build). */
  perksLower: string[];
  /** Every perk hash across all columns (deduped). Generation-time only; not shipped to the browser. */
  perkHashes?: number[];
}

/** Piecewise-linear segment for stat-group scaling (manifest displayInterpolation). */
export interface StatInterpolationPoint {
  value: number;
  weight: number;
}

/** Scaled-stat entry from DestinyStatGroupDefinition — used to transform investment → display. */
export interface StatGroupScaledStat {
  statHash: number;
  maximumValue: number;
  displayInterpolation: StatInterpolationPoint[];
}

/** One stat's investment → display curve from a stat group, as [investment, display] points. */
export interface StatCurve {
  /** Investment values are clamped to this before interpolating. */
  max: number;
  points: [number, number][];
}

/** Compact stat-group definition shipped alongside weapon details. */
export interface StatGroupRef {
  hash: number;
  maximumValue: number;
  scaledStats: StatGroupScaledStat[];
}

/** One selectable masterwork stat option (full tier / +10 investment). */
export interface MasterworkOption {
  /** The completed masterwork plug. */
  plugHash: number;
  statHash: number;
  statName: string;
  /** Bungie icon path from the completed masterwork plug. */
  icon?: string;
  statMods: StatMod[];
}

/** Detail fields stored separately and loaded on demand. */
export interface WeaponDetailFields {
  hash: number;
  screenshot?: string;
  flavor?: string;
  stats: WeaponStat[];
  /** Base investment stats (pre stat-group scaling). */
  investmentStats?: WeaponStat[];
  statGroupHash?: number;
  /** Selectable full-tier masterwork stats for this weapon. */
  masterworkOptions?: MasterworkOption[];
}

/** Full weapon with resolved columns — merged from summary + detail at runtime. */
export interface WeaponDoc extends Omit<WeaponSummary, "columns" | "perksLower" | "masterworks"> {
  screenshot?: string;
  flavor?: string;
  stats: WeaponStat[];
  investmentStats?: WeaponStat[];
  statGroupHash?: number;
  masterworkOptions?: MasterworkOption[];
  columns: PerkColumn[];
}

export interface DamageTypeRef {
  hash: number;
  name: string;
  /** Bungie icon path; prefix with https://www.bungie.net to render. */
  icon?: string;
}

export interface WeaponTypeRef {
  name: string;
  /** Bungie icon path; prefix with https://www.bungie.net to render. */
  icon?: string;
}

export interface AmmoTypeRef {
  name: string;
  /** Bungie icon path from DestinyIconDefinition; prefix with https://www.bungie.net to render. */
  icon?: string;
}

export interface WeaponIndex {
  /** Bungie manifest version this index was built from. */
  version: string;
  generatedAt: string;
  /** Global interned perk catalog. */
  perks: PerkRef[];
  weapons: WeaponSummary[];
  /** Lowercase perk name → weapon hashes (precomputed at build). */
  weaponsByPerkName: Record<string, number[]>;
  /** Damage type catalog from DestinyDamageTypeDefinition (element filter icons). */
  damageTypes: DamageTypeRef[];
  /** Weapon type catalog from DestinyItemCategoryDefinition (type filter icons). */
  weaponTypes?: WeaponTypeRef[];
  /** Ammo type catalog from DestinyIconDefinition HUD icons (Primary / Special / Heavy). */
  ammoTypes?: AmmoTypeRef[];
  /** Stat group hash → stat name → curve; stats without a curve display their investment value. */
  statCurves?: Record<string, Record<string, StatCurve>>;
}

export interface WeaponDetailIndex {
  version: string;
  /** Weapon hash (string key) → detail fields. */
  details: Record<string, WeaponDetailFields>;
  /** Stat groups referenced by weapon details (string key = statGroupHash). */
  statGroups?: Record<string, StatGroupRef>;
}
