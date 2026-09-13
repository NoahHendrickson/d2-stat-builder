import type { Manifest } from "@/lib/manifest/load";
import { memoByManifest } from "@/lib/manifest/memo";
import { STAT_HASH_TO_INDEX, STAT_LABELS, STAT_ORDER, type StatArray } from "./stats";

export type Subclass = "Arc" | "Solar" | "Void" | "Stasis" | "Strand" | "Prismatic";

/** Tab order for the fragment picker. */
export const SUBCLASSES: Subclass[] = [
  "Arc",
  "Solar",
  "Void",
  "Stasis",
  "Strand",
  "Prismatic",
];

// Fragment plug category -> subclass. NOTE: Stasis fragments live under
// `shared.stasis.trinkets`, NOT `.fragments` — verified against the live manifest,
// and a naive "fragments" filter silently drops all of Stasis.
const CATEGORY_SUBCLASS: Record<string, Subclass> = {
  "shared.arc.fragments": "Arc",
  "shared.solar.fragments": "Solar",
  "shared.void.fragments": "Void",
  "shared.stasis.trinkets": "Stasis",
  "shared.strand.fragments": "Strand",
  "shared.prism.fragments": "Prismatic",
};

/** STAT_ORDER indices for the old Mobility / Resilience / Recovery trio. */
const CLASS_ABILITY_TRIO = [0, 1, 2] as const;

/**
 * Which Armor 3.0 stat receives a class-ability penalty/bonus for each classType
 * (0 Titan, 1 Hunter, 2 Warlock). Pre-3.0: Resilience / Mobility / Recovery.
 */
export const CLASS_ABILITY_STAT_INDEX: Record<number, number> = {
  0: 1, // Titan → Health
  1: 0, // Hunter → Weapons
  2: 2, // Warlock → Class
};

type InvestmentStat = {
  statTypeHash: number;
  value: number;
  isConditionallyActive?: boolean;
};

/** Sum armor investment stats, resolving class-specific Mobility/Resilience/Recovery penalties. */
export function buildFragmentStats(
  investmentStats: InvestmentStat[] | undefined,
  classType: number,
): { stats: StatArray; touches: boolean } {
  const stats: StatArray = [0, 0, 0, 0, 0, 0];
  const trio: { idx: number; value: number }[] = [];
  let touches = false;

  for (const inv of investmentStats ?? []) {
    const idx = STAT_HASH_TO_INDEX[inv.statTypeHash];
    if (idx === undefined) continue;
    touches = true;
    if (
      inv.isConditionallyActive &&
      (CLASS_ABILITY_TRIO as readonly number[]).includes(idx)
    ) {
      trio.push({ idx, value: inv.value });
      continue;
    }
    stats[idx] += inv.value;
  }

  if (trio.length >= 2) {
    const pick = trio.find((t) => t.idx === CLASS_ABILITY_STAT_INDEX[classType]);
    if (pick) stats[pick.idx] += pick.value;
  } else {
    for (const t of trio) stats[t.idx] += t.value;
  }

  return { stats, touches };
}

/** Human-readable fragment bonuses, e.g. "+10 Health · −10 Class". Empty when none. */
export function formatFragmentStats(stats: StatArray): string {
  return stats
    .flatMap((v, i) =>
      v ? [`${v > 0 ? "+" : "−"}${Math.abs(v)} ${STAT_LABELS[STAT_ORDER[i]]}`] : [],
    )
    .join(" · ");
}

export interface FragmentInfo {
  hash: number;
  name: string;
  icon?: string;
  subclass: Subclass;
  /** Summed investment stats on the six armor stats (STAT_ORDER); may be negative. */
  stats: StatArray;
}

/**
 * Stat-affecting subclass fragments from the manifest, grouped by subclass and sorted by
 * name. Fragments are plug items; this keeps only those in a known fragment category that
 * carry armor-stat investment. Not owned-gated — any fragment is selectable (theoretical
 * builds), matching D2ArmorPicker.
 */
export function availableFragments(
  manifest: Manifest,
  classType: number,
): Record<Subclass, FragmentInfo[]> {
  const byClass = fragmentsByClass(manifest);
  let out = byClass.get(classType);
  if (!out) {
    out = scanFragments(manifest, classType);
    byClass.set(classType, out);
  }
  return out;
}

// One scan per (manifest, class) for the session — the table is immutable.
const fragmentsByClass = memoByManifest(
  () => new Map<number, Record<Subclass, FragmentInfo[]>>(),
);

function scanFragments(
  manifest: Manifest,
  classType: number,
): Record<Subclass, FragmentInfo[]> {
  const out: Record<Subclass, FragmentInfo[]> = {
    Arc: [],
    Solar: [],
    Void: [],
    Stasis: [],
    Strand: [],
    Prismatic: [],
  };

  const table = manifest.all("DestinyInventoryItemDefinition");
  for (const key in table) {
    const def = table[key];
    const cat = def.plug?.plugCategoryIdentifier;
    const subclass = cat ? CATEGORY_SUBCLASS[cat] : undefined;
    if (!subclass) continue;

    const { stats, touches } = buildFragmentStats(def.investmentStats, classType);
    if (!touches) continue;

    out[subclass].push({
      hash: Number(key),
      name: def.displayProperties?.name ?? "Unknown",
      icon: def.displayProperties?.icon,
      subclass,
      stats,
    });
  }

  for (const s of SUBCLASSES) out[s].sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
