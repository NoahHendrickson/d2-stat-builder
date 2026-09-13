// "Load in builder": turn a saved loadout's BuilderSnapshot back into the builder's
// persisted selections. The builder restores from localStorage on mount, so writing the
// blob and navigating to "/" is the whole handoff. Runtime imports are relative so the
// module runs under vitest.
import { SUBCLASSES, type Subclass } from "../armory/fragments";
import { DEFAULT_SET_FILTERS } from "../armory/set-filters";
import { SCHEMA_VERSION, type PersistedSelections } from "../builder/selection-storage";
import type { SavedLoadout } from "./types";

const emptyFragSel = (): Record<Subclass, number[]> =>
  Object.fromEntries(SUBCLASSES.map((s) => [s, [] as number[]])) as unknown as Record<
    Subclass,
    number[]
  >;

/**
 * Selections to persist for `saved`. List-display state (pins, set filters) is kept from
 * `existing`; everything the loadout defines replaces it. Loadouts without a builder
 * snapshot (imports, snapshots) fall back to what `parameters` can express: stat
 * constraints → targets, set bonuses → set requirements, exotic → by name.
 * Pass `major` to set the builder's major-mod budget from the loadout's mods.
 */
export function selectionsForLoadout(
  saved: SavedLoadout,
  existing: PersistedSelections | null,
  opts: {
    exoticName?: string | null;
    statHashToIndex: Record<number, number>;
    subclass?: { subclass?: Subclass; fragmentHashes: number[] };
    /** Major-mod budget from the loadout's mods. Overrides the builder snapshot. */
    major?: number;
  },
): PersistedSelections {
  const { loadout, builder } = saved;
  const classType = loadout.classType === 3 ? (existing?.classType ?? null) : loadout.classType;
  const major = opts.major ?? builder?.major ?? 0;
  const base: PersistedSelections = {
    version: SCHEMA_VERSION,
    classType,
    targets: [0, 0, 0, 0, 0, 0],
    major,
    setReqs: {},
    pinnedSets: existing?.pinnedSets ?? [],
    setFilters: existing?.setFilters ?? DEFAULT_SET_FILTERS,
    exoticName: null,
    exoticPerks: [null, null],
    allowTuning: true,
    balancedTuning: true,
    legacyExotics: true,
    dreamersBond: false,
    festivalMasks: false,
    activeSubclass: opts.subclass?.subclass ?? existing?.activeSubclass ?? "Prismatic",
    fragSel: opts.subclass?.subclass
      ? { ...(existing?.fragSel ?? emptyFragSel()), [opts.subclass.subclass]: opts.subclass.fragmentHashes }
      : existing?.fragSel ?? emptyFragSel(),
  };

  if (builder) {
    const { fragmentHashes, ...snapshot } = builder;
    return {
      ...base,
      ...snapshot,
      major,
      activeSubclass: opts.subclass?.subclass ?? builder.activeSubclass,
      fragSel: opts.subclass?.subclass ? base.fragSel : { ...base.fragSel, [builder.activeSubclass]: fragmentHashes },
    };
  }

  const targets = [0, 0, 0, 0, 0, 0];
  for (const c of loadout.parameters.statConstraints ?? []) {
    const i = opts.statHashToIndex[c.statHash];
    if (i !== undefined) targets[i] = c.minStat;
  }
  const setReqs: Record<number, 2 | 4> = {};
  for (const [hash, count] of Object.entries(loadout.parameters.setBonuses ?? {})) {
    if (count === 2 || count === 4) setReqs[Number(hash)] = count;
  }
  return {
    ...base,
    targets,
    setReqs,
    exoticName: opts.exoticName ?? null,
  };
}
