"use client";

import { useCallback, useMemo, useState, type SetStateAction } from "react";
import type { BuildsMode } from "@/components/builder/builds-column-content";
import type { FragmentInfo, Subclass } from "@/lib/armory/fragments";
import {
  availableSpiritPerks,
  isExoticClassItemHash,
} from "@/lib/armory/exotic-class-perks";
import type { RaidReqs } from "@/lib/armory/legacy-raids";
import type { Manifest } from "@/lib/manifest/load";
import {
  DEFAULT_POWER_RANGE,
  fragSelFromArrays,
  resolveExoticIndex,
  type PersistedSelections,
} from "@/lib/builder/selection-storage";
import type { BuilderSnapshot } from "@/lib/loadouts/types";

/**
 * What Builds and Theoretical Builds each keep for themselves. Class, the set list
 * filters and the Builds-only settings (tuning, pools, Power matters) are shared and
 * live outside this record. Legacy raid requirements are Builds-only too, but they're
 * selections bound to the class like set bonuses, so they live here.
 */
export interface TabSelections {
  targets: number[];
  major: number;
  setReqs: Record<number, 2 | 4>;
  /**
   * Legacy raids every build must wear pieces of. Only Builds shows the control (raid
   * armor can't drop at Tier 5), so Theoretical's stays empty.
   */
  raidReqs: RaidReqs;
  /** Held by name: the exotics list is re-indexed whenever a pool toggle changes. */
  exoticName: string | null;
  /** Exotic class item Spirit pair; null = Any. */
  exoticPerks: [number | null, number | null];
  activeSubclass: Subclass;
  fragSel: Record<Subclass, Set<number>>;
}

export const DEFAULT_TAB: TabSelections = {
  targets: [0, 0, 0, 0, 0, 0],
  major: 0,
  setReqs: {},
  raidReqs: {},
  exoticName: null,
  exoticPerks: [null, null],
  activeSubclass: "Prismatic",
  fragSel: fragSelFromArrays({}),
};

/**
 * Stored selections as a tab. The exotic is left out: it resolves against the live
 * exotics list, which may not exist yet (see the panel's pendingExoticName).
 */
export function tabFromSaved(saved: PersistedSelections): TabSelections {
  return {
    targets: saved.targets,
    major: saved.major,
    setReqs: saved.setReqs,
    raidReqs: saved.raidReqs,
    exoticName: null,
    exoticPerks: saved.exoticPerks,
    activeSubclass: saved.activeSubclass,
    fragSel: fragSelFromArrays(saved.fragSel),
  };
}

/**
 * A Theoretical tab as a loadout snapshot (theory-storage.ts): its subclass and that
 * subclass's fragments, with the Builds-only settings at their defaults. Pass
 * `exoticName` to store the resolved exotic instead of the raw name; with none, the
 * Spirit perks are dropped too.
 */
export function theorySnapshot(
  tab: TabSelections,
  exoticName: string | null = tab.exoticName,
): BuilderSnapshot {
  return {
    targets: tab.targets,
    major: tab.major,
    setReqs: tab.setReqs,
    raidReqs: DEFAULT_TAB.raidReqs,
    exoticName,
    exoticPerks: exoticName === null ? DEFAULT_TAB.exoticPerks : tab.exoticPerks,
    allowTuning: true,
    balancedTuning: true,
    legacyExotics: true,
    lowerTierArmor: false,
    legacyArmor: false,
    powerRange: DEFAULT_POWER_RANGE,
    activeSubclass: tab.activeSubclass,
    fragmentHashes: [...tab.fragSel[tab.activeSubclass]],
  };
}

/** A stored Theoretical snapshot as a tab; other subclasses start with no fragments. */
export function tabFromSnapshot(s: BuilderSnapshot): TabSelections {
  return {
    targets: s.targets,
    major: s.major,
    setReqs: s.setReqs,
    raidReqs: DEFAULT_TAB.raidReqs,
    exoticName: s.exoticName,
    exoticPerks: s.exoticPerks,
    activeSubclass: s.activeSubclass,
    fragSel: fragSelFromArrays({ [s.activeSubclass]: s.fragmentHashes }),
  };
}

/** Drops what a class switch voids: sets, raids and exotics are per class. Already clear → same object. */
export function clearClassBound(tab: TabSelections): TabSelections {
  const clear =
    Object.keys(tab.setReqs).length === 0 &&
    Object.keys(tab.raidReqs).length === 0 &&
    tab.exoticName === null &&
    tab.exoticPerks[0] === null &&
    tab.exoticPerks[1] === null;
  return clear
    ? tab
    : {
        ...tab,
        setReqs: DEFAULT_TAB.setReqs,
        raidReqs: DEFAULT_TAB.raidReqs,
        exoticName: null,
        exoticPerks: DEFAULT_TAB.exoticPerks,
      };
}

export interface BuilderTabs {
  /** The tab the controls show and edit. */
  mode: BuildsMode;
  actual: TabSelections;
  theoretical: TabSelections;
}

/** Which tab a write goes to; "both" for changes that void either one (class). */
export type TabTarget = BuildsMode | "both";

/**
 * Applies `fn` to the targeted tab(s). Tabs `fn` returns unchanged keep their objects,
 * and if none changed the state object is kept too: no re-render, no new search.
 */
export function updateTabs(
  state: BuilderTabs,
  target: TabTarget,
  fn: (tab: TabSelections) => TabSelections,
): BuilderTabs {
  const actual = target === "theoretical" ? state.actual : fn(state.actual);
  const theoretical = target === "actual" ? state.theoretical : fn(state.theoretical);
  return actual === state.actual && theoretical === state.theoretical
    ? state
    : { ...state, actual, theoretical };
}

/** One field of one tab; an unchanged value (Object.is) keeps the tab object. */
export function setTabField<K extends keyof TabSelections>(
  tab: TabSelections,
  key: K,
  next: SetStateAction<TabSelections[K]>,
): TabSelections {
  const value =
    typeof next === "function"
      ? (next as (cur: TabSelections[K]) => TabSelections[K])(tab[key])
      : next;
  return Object.is(value, tab[key]) ? tab : { ...tab, [key]: value };
}

/**
 * Builds and Theoretical Builds keep their own selections: each tab edits its own
 * record, and switching tabs swaps which one the controls show. `update` writes to the
 * tab open when the write lands (it reads the mode from state, so its identity never
 * changes); pass `target` to name the tab, e.g. one captured before an await.
 */
export function useBuilderTabs(
  initialActual: () => TabSelections,
  initialTheoretical: () => TabSelections,
) {
  const [state, setState] = useState<BuilderTabs>(() => ({
    mode: "actual",
    actual: initialActual(),
    theoretical: initialTheoretical(),
  }));

  const setMode = useCallback(
    (mode: BuildsMode) => setState((s) => (s.mode === mode ? s : { ...s, mode })),
    [],
  );
  const update = useCallback(
    <K extends keyof TabSelections>(
      key: K,
      next: SetStateAction<TabSelections[K]>,
      target?: TabTarget,
    ) =>
      setState((s) => updateTabs(s, target ?? s.mode, (tab) => setTabField(tab, key, next))),
    [],
  );

  return useMemo(
    () => ({
      mode: state.mode,
      /** The open tab's selections. */
      tab: state[state.mode],
      actual: state.actual,
      theoretical: state.theoretical,
      setMode,
      update,
      /** Whole-state transitions (class switch, adopting stored selections). */
      setTabs: setState,
    }),
    [state, setMode, update],
  );
}

/**
 * What one tab's selections resolve to against the live lists: its exotic (an index
 * into `exotics`, null when a pool toggle removed it, so it comes back with the toggle),
 * that exotic's class item and Spirit perks, and the fragments' stat bonus. The panel
 * derives each tab separately, so each pipeline reads its own tab.
 */
export function useTabDerived<E extends { name: string; hashes: number[] }>(
  tab: TabSelections,
  exotics: E[],
  fragments: Record<Subclass, FragmentInfo[]> | null,
  manifest: Manifest | undefined,
) {
  const exoticIndex = useMemo(
    () => resolveExoticIndex(tab.exoticName, exotics),
    [tab.exoticName, exotics],
  );
  const exoticOption = exoticIndex !== null ? exotics[exoticIndex] : undefined;
  const classItemHash = exoticOption?.hashes.find(isExoticClassItemHash);
  const spiritPerks = useMemo(
    () =>
      manifest && classItemHash !== undefined
        ? availableSpiritPerks(manifest, classItemHash)
        : null,
    [manifest, classItemHash],
  );
  const fragmentBonus = useMemo(() => {
    const v = [0, 0, 0, 0, 0, 0];
    if (!fragments) return v;
    const sel = tab.fragSel[tab.activeSubclass];
    for (const f of fragments[tab.activeSubclass]) {
      if (sel.has(f.hash)) for (let i = 0; i < 6; i++) v[i] += f.stats[i];
    }
    return v;
  }, [fragments, tab.fragSel, tab.activeSubclass]);
  return { exoticIndex, exoticOption, classItemHash, spiritPerks, fragmentBonus };
}
