"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { useSession } from "@/lib/auth/use-session";
import { useArmory } from "@/lib/armory/use-armory";
import { useManifest } from "@/lib/manifest/use-manifest";
import { useOptimizer } from "@/lib/optimizer/use-optimizer";
import { useSmoothedProgress } from "@/lib/use-smoothed-progress";
import { createValueStore } from "@/lib/value-store";
import { liveTargets } from "@/lib/builder/live-targets";
import { availableSets } from "@/lib/armory/sets";
import {
  DEFAULT_SET_FILTERS,
  hasCustomSetFilters,
  passesSetFilters,
  type SetFilters,
} from "@/lib/armory/set-filters";
import {
  DEFAULT_SET_SORT,
  sortSets,
  type SetSortKey,
} from "@/lib/armory/set-sort";
import {
  availableFragments,
  SUBCLASSES,
  type Subclass,
} from "@/lib/armory/fragments";
import {
  applySpiritSelectionToClassItems,
  availableExoticClassItems,
  availableSpiritPerks,
  isExoticClassItemHash,
} from "@/lib/armory/exotic-class-perks";
import {
  dreamersBondPiece,
  dreamersClassItemName,
} from "@/lib/armory/dreamers-bond";
import {
  hashesIncludeHelmet,
  isFestivalMask,
} from "@/lib/armory/festival-masks";
import {
  ARMOR_SLOTS,
  BALANCED_TUNING_PLUG_HASH,
  CLASS_NAMES,
  STAT_DISPLAY_ORDER,
  STAT_HASHES,
  STAT_ORDER,
  offArchetypeIndices,
  type StatIconMap,
} from "@/lib/armory/stats";
import type { ArmorPiece } from "@/lib/armory/normalize";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatTargetRow } from "@/components/builder/stat-target-row";
import { SetRow } from "@/components/builder/set-row";
import { SignInCard } from "@/components/auth/sign-in-card";
import { ArmoryStatus } from "@/components/armory/armory-status";
import { ManifestStatus } from "@/components/manifest/manifest-status";
import { ExoticPicker } from "@/components/builder/exotic-picker";
import { ExoticClassPerkPicker } from "@/components/builder/exotic-class-perk-picker";
import { FragmentPicker } from "@/components/builder/fragment-picker";
import { SetListControls } from "@/components/builder/set-list-controls";
import { ClassEmblemTabs } from "@/components/builder/class-emblem-tabs";
import { TuningControls } from "@/components/builder/tuning-controls";
import { BuildsSurface } from "@/components/builder/builds-surface";
import type { BuildsColumnContentProps } from "@/components/builder/builds-column-content";
import type { ExoticConstraint, OptimizerPiece } from "@/lib/optimizer/types";
import {
  loadSelections,
  saveSelections,
  fragSelToArrays,
  fragSelFromArrays,
  resolveExoticIndex,
  SCHEMA_VERSION,
  SELECTIONS_REPLACED_EVENT,
  selectionsGeneration,
} from "@/lib/builder/selection-storage";
import {
  getArtificeModHashes,
  getStatModHashes,
  getTuningPlugHashes,
} from "@/lib/dim/mod-hashes";
import {
  FRAGMENT_SOCKET_START,
  SUBCLASS_ITEM_HASHES,
} from "@/lib/dim/subclasses";
import { useApplyCurrentFragments } from "@/lib/armory/use-apply-current-fragments";
import type { BuilderSnapshot } from "@/lib/loadouts/types";

const MAX_MODS = 5;

export function BuilderPanel({
  showInlineStatusCards = true,
}: {
  showInlineStatusCards?: boolean;
}) {
  const session = useSession();
  const armoryQuery = useArmory();
  const manifestStatus = useManifest();
  const {
    run,
    cancel,
    result,
    ceilingsView,
    running,
    progress,
    refinementProgress,
    runId,
    refinement,
    applyPending,
  } = useOptimizer();
  // `progress` is a value store: the smoother reads it per frame and writes the eased
  // value to another store; neither touches this component's render.
  const { displayedProgress, showLoading } = useSmoothedProgress(
    progress,
    running,
    runId,
  );

  const armory = armoryQuery.data;
  const manifest =
    manifestStatus.state === "ready" ? manifestStatus.manifest : undefined;

  // Last session's selections, read once per mount (absent/stale/corrupt → null). Every
  // inventory-independent field initializes from it directly, so the first render is
  // already the restored builder — no restore effect, no second render of the panel.
  // Nothing rendered before `ready` depends on these, so the SSR/hydration output
  // (where storage is unavailable) can't mismatch.
  const [initialSaved] = useState(loadSelections);

  const [classType, setClassType] = useState<number | null>(
    initialSaved?.classType ?? null,
  );
  const [targets, setTargets] = useState<number[]>(
    () => initialSaved?.targets ?? [0, 0, 0, 0, 0, 0],
  );
  const [major, setMajor] = useState(initialSaved?.major ?? 0);
  const [setReqs, setSetReqs] = useState<Record<number, 2 | 4>>(
    () => initialSaved?.setReqs ?? {},
  );
  const [pinnedSets, setPinnedSets] = useState<number[]>(
    () => initialSaved?.pinnedSets ?? [],
  );
  const [setQuery, setSetQuery] = useState("");
  const [setFilters, setSetFilters] = useState<SetFilters>(
    () => initialSaved?.setFilters ?? DEFAULT_SET_FILTERS,
  );
  /** Set-list ordering — a view preference, so it's per-session rather than persisted. */
  const [setSort, setSetSort] = useState<SetSortKey>(DEFAULT_SET_SORT);
  const [selectedExotic, setSelectedExotic] = useState<number | null>(null);
  /** Exotic class item Spirit pair; null = Any. Cleared when exotic/class changes. */
  const [exoticPerks, setExoticPerks] = useState<
    [number | null, number | null]
  >(() => initialSaved?.exoticPerks ?? [null, null]);
  const [allowTuning, setAllowTuning] = useState(
    initialSaved?.allowTuning ?? true,
  );
  const [useBalancedTuning, setUseBalancedTuning] = useState(
    initialSaved?.balancedTuning ?? true,
  );
  const [activeSubclass, setActiveSubclass] = useState<Subclass>(
    initialSaved?.activeSubclass ?? "Prismatic",
  );
  const [fragSel, setFragSel] = useState<Record<Subclass, Set<number>>>(() =>
    initialSaved
      ? fragSelFromArrays(initialSaved.fragSel)
      : (Object.fromEntries(
          SUBCLASSES.map((s) => [s, new Set<number>()]),
        ) as Record<Subclass, Set<number>>),
  );
  // Legacy EXOTICS are supported (the solver spends their artifice +3); legacy
  // legendaries are not yet — that toggle stays disabled.
  const [useLegacyExotics, setUseLegacyExotics] = useState(
    initialSaved?.legacyExotics ?? true,
  );
  const [useDreamersBond, setUseDreamersBond] = useState(
    initialSaved?.dreamersBond ?? false,
  );
  const [useFestivalMasks, setUseFestivalMasks] = useState(
    initialSaved?.festivalMasks ?? false,
  );

  // The exotic is persisted by name and resolved to an index once the live exotics list
  // exists; while it's pending (not `undefined`), the save effect holds off so a
  // still-unresolved exotic can't be written back as "none".
  const pendingExoticName = useRef<string | null | undefined>(
    initialSaved?.exoticName,
  );
  // Which `replaceSelections` this panel has adopted — see the adopt effect below.
  const adoptedGeneration = useRef(selectionsGeneration());

  const classes = useMemo(() => {
    if (!armory) return [];
    return [...new Set(armory.characters.map((c) => c.classType))].filter(
      (c) => CLASS_NAMES[c] !== undefined,
    );
  }, [armory]);

  // Default the class to the player's first — and correct a restored class they no longer have.
  useEffect(() => {
    if (!classes.length) return;
    if (classType === null || !classes.includes(classType))
      setClassType(classes[0]);
  }, [classes, classType]);

  const classPieces = useMemo(
    () =>
      armory && classType !== null
        ? armory.pieces.filter((p) => p.classType === classType)
        : [],
    [armory, classType],
  );

  // Candidate pool for the optimizer: Tier-5 pieces (exactly those with a tuning
  // socket) plus — when enabled — legacy/non-tunable exotics, whose artifice +3 the
  // solver spends. Legacy legendaries stay excluded until supported.
  const pool = useMemo(
    () =>
      classPieces.filter(
        (p) => p.tunedStat !== undefined || (useLegacyExotics && p.isExotic),
      ),
    [classPieces, useLegacyExotics],
  );

  const sets = useMemo(
    () => (manifest ? availableSets(pool, manifest) : []),
    [pool, manifest],
  );
  const setMap = useMemo(
    () => new Map(sets.map((s) => [s.setHash, s])),
    [sets],
  );

  // Pinned sets float to the top; within each group the chosen sort order is kept.
  // Pins for sets outside the current list (e.g. another class) simply don't show.
  // Both groups are narrowed by the search query (case-insensitive substring).
  const { pinnedList, unpinnedList } = useMemo(() => {
    const q = setQuery.trim().toLowerCase();
    const shown = sortSets(
      sets.filter((s) => {
        if (q && !s.name.toLowerCase().includes(q)) return false;
        return passesSetFilters(s.ownedCount, setFilters);
      }),
      setSort,
    );
    const pinned = new Set(pinnedSets);
    return {
      pinnedList: shown.filter((s) => pinned.has(s.setHash)),
      unpinnedList: shown.filter((s) => !pinned.has(s.setHash)),
    };
  }, [sets, pinnedSets, setQuery, setFilters, setSort]);

  const customSetFilters = hasCustomSetFilters(setFilters);

  // Set requirements narrowed to sets the player owns for this class: a restored (or
  // class-corrected) requirement for a set they no longer own would make every build
  // infeasible. Everything downstream — the optimizer, persistence, loadout snapshots —
  // reads this; the toggles only ever list owned sets, so the raw state needs no pruning.
  // Left untouched until the set list exists so stored requirements survive the load.
  const ownedSetReqs = useMemo(() => {
    if (!setMap.size) return setReqs;
    const kept = Object.entries(setReqs).filter(([h]) => setMap.has(Number(h)));
    return kept.length === Object.keys(setReqs).length
      ? setReqs
      : (Object.fromEntries(kept) as Record<number, 2 | 4>);
  }, [setReqs, setMap]);

  const fragments = useMemo(
    () =>
      manifest && classType !== null
        ? availableFragments(manifest, classType)
        : null,
    [manifest, classType],
  );

  // DIM handoff lookups: plug hashes for general stat mods and directional
  // tuning (one manifest scan each), plus the active subclass fragments carrier.
  const statModHashes = useMemo(
    () => (manifest ? getStatModHashes(manifest) : null),
    [manifest],
  );
  const tuningPlugHashes = useMemo(
    () => (manifest ? getTuningPlugHashes(manifest) : null),
    [manifest],
  );
  const artificeModHashes = useMemo(
    () => (manifest ? getArtificeModHashes(manifest) : null),
    [manifest],
  );
  const dimSubclass = useMemo(
    () => ({
      name: activeSubclass,
      itemHash:
        classType !== null
          ? SUBCLASS_ITEM_HASHES[activeSubclass]?.[classType]
          : undefined,
      fragmentHashes: [...fragSel[activeSubclass]],
      socketStart: FRAGMENT_SOCKET_START[activeSubclass],
    }),
    [activeSubclass, classType, fragSel],
  );

  const statIcons = useMemo(() => {
    const out = {} as StatIconMap;
    if (manifest) {
      for (const key of STAT_ORDER) {
        out[key] = manifest.def("DestinyStatDefinition", STAT_HASHES[key])
          ?.displayProperties?.icon;
      }
    }
    return out;
  }, [manifest]);

  const balancedTuningIcon = useMemo(
    () =>
      manifest?.def("DestinyInventoryItemDefinition", BALANCED_TUNING_PLUG_HASH)
        ?.displayProperties?.icon,
    [manifest],
  );

  const fragmentBonus = useMemo(() => {
    const v = [0, 0, 0, 0, 0, 0];
    if (!fragments) return v;
    const sel = fragSel[activeSubclass];
    for (const f of fragments[activeSubclass]) {
      if (sel.has(f.hash)) for (let i = 0; i < 6; i++) v[i] += f.stats[i];
    }
    return v;
  }, [fragments, fragSel, activeSubclass]);

  const toggleFragment = useCallback(
    (hash: number) =>
      setFragSel((prev) => {
        const next = new Set(prev[activeSubclass]);
        if (next.has(hash)) next.delete(hash);
        else next.add(hash);
        return { ...prev, [activeSubclass]: next };
      }),
    [activeSubclass],
  );

  const {
    applying: applyingFragments,
    apply: applyCurrentFragments,
    canApply: canApplyCurrentFragments,
  } = useApplyCurrentFragments({ armoryQuery, classType, fragments });

  const onApplyCurrentFragments = useCallback(async () => {
    const result = await applyCurrentFragments();
    if (!result) return;
    setActiveSubclass(result.subclass);
    setFragSel((prev) => ({
      ...prev,
      [result.subclass]: result.fragmentHashes,
    }));
  }, [applyCurrentFragments]);

  const setRequirements = useMemo(
    () =>
      Object.entries(ownedSetReqs).map(([setHash, count]) => ({
        setHash: Number(setHash),
        count,
      })),
    [ownedSetReqs],
  );

  // Dedupe by name — the same exotic can exist in multiple versions (Armor 2.0 vs 3.0)
  // with different hashes; the optimizer picks whichever version builds best.
  // Exotic class items are always listed (from the manifest) even when unowned.
  const exotics = useMemo(() => {
    const map = new Map<string, { hashes: number[]; icon?: string }>();
    for (const p of pool) {
      if (!p.isExotic) continue;
      const entry = map.get(p.name) ?? { hashes: [], icon: p.icon };
      if (!entry.hashes.includes(p.itemHash)) entry.hashes.push(p.itemHash);
      if (!entry.icon) entry.icon = p.icon;
      map.set(p.name, entry);
    }
    if (manifest && classType !== null) {
      for (const item of availableExoticClassItems(manifest, classType)) {
        const entry = map.get(item.name) ?? { hashes: [], icon: item.icon };
        if (!entry.hashes.includes(item.hash)) entry.hashes.push(item.hash);
        if (!entry.icon) entry.icon = item.icon;
        map.set(item.name, entry);
      }
    }
    return [...map]
      .map(([name, { hashes, icon }]) => ({ name, hashes, icon }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [pool, manifest, classType]);

  const selectedExoticOption =
    selectedExotic !== null ? exotics[selectedExotic] : undefined;
  const selectedClassItemHash = selectedExoticOption?.hashes.find(
    isExoticClassItemHash,
  );
  const spiritPerks = useMemo(
    () =>
      manifest && selectedClassItemHash !== undefined
        ? availableSpiritPerks(manifest, selectedClassItemHash)
        : null,
    [manifest, selectedClassItemHash],
  );

  // Class-item pool with Spirit filter + optional synthetic T5 roll (owned matches win).
  // Dreamer's Bond replaces the whole slot with a hardcoded 0-stat collections item.
  const classItemPieces = useMemo(() => {
    if (useDreamersBond && classType !== null) {
      const pinned = dreamersBondPiece(classType, manifest);
      return pinned ? [pinned] : [];
    }
    const pieces = pool.filter((p) => p.slot === "classItem");
    if (
      !manifest ||
      classType === null ||
      selectedClassItemHash === undefined
    ) {
      return pieces;
    }
    return applySpiritSelectionToClassItems(pieces, manifest, {
      selectedClassItemHash,
      exoticPerks,
      name: selectedExoticOption?.name ?? "Exotic class item",
      icon: selectedExoticOption?.icon,
      classType,
    });
  }, [
    pool,
    manifest,
    classType,
    selectedClassItemHash,
    selectedExoticOption,
    exoticPerks,
    useDreamersBond,
  ]);

  // Owned FotL masks for this class (vault / inventory / equipped), including
  // legacy rolls the normal T5 pool excludes. Scan the full armory so classType 3
  // (any-class) defs still appear for the selected character.
  const festivalMaskHelmets = useMemo(() => {
    if (!useFestivalMasks || classType === null || !armory) return null;
    return armory.pieces.filter(
      (p) =>
        p.slot === "helmet" &&
        (p.classType === classType || p.classType === 3) &&
        isFestivalMask(
          p.itemHash,
          manifest?.def("DestinyInventoryItemDefinition", p.itemHash),
        ),
    );
  }, [useFestivalMasks, armory, classType, manifest]);

  const pieceMap = useMemo(() => {
    const map = new Map(classPieces.map((p) => [p.instanceId, p]));
    // Theoretical rolls live only in classItemPieces — results resolve through this map.
    for (const p of classItemPieces) {
      if (!map.has(p.instanceId)) map.set(p.instanceId, p);
    }
    return map;
  }, [classPieces, classItemPieces]);

  // A stored exotic in a pinned slot (Dreamer's Bond → class item, Festival masks →
  // helmet) loses to the pin on restore. From then on the exotic picker and the toggle
  // handlers keep the two exclusive, so no effect has to referee them.
  const resolveRestoredExotic = useCallback(
    (
      name: string | null,
      pins: { dreamersBond: boolean; festivalMasks: boolean },
    ): number | null => {
      const index = resolveExoticIndex(name, exotics);
      if (index === null) return null;
      const hashes = exotics[index].hashes;
      if (pins.dreamersBond && hashes.some(isExoticClassItemHash)) return null;
      if (pins.festivalMasks && hashesIncludeHelmet(hashes, classPieces)) return null;
      return index;
    },
    [exotics, classPieces],
  );

  // Resolve the restored exotic (persisted by name) to an index once the live list exists.
  // Consumed once so a later class switch can't re-apply it; not-owned-now → cleared.
  useEffect(() => {
    if (pendingExoticName.current === undefined || !exotics.length) return;
    const name = pendingExoticName.current;
    pendingExoticName.current = undefined;
    setSelectedExotic(
      resolveRestoredExotic(name, {
        dreamersBond: useDreamersBond,
        festivalMasks: useFestivalMasks,
      }),
    );
  }, [exotics, resolveRestoredExotic, useDreamersBond, useFestivalMasks]);

  // "Optimize" in the sidebar replaces the stored selections while this panel may already
  // be mounted: adopt them the way the mount-time restore does. The exotic resolves right
  // away when the class is unchanged (its list is live); otherwise it waits for the new
  // class's list exactly like a fresh restore. The router keeps this view mounted but
  // hidden while the armor table is showing (effects torn down, so the event is missed);
  // the generation check catches up on such a replacement when the view comes back.
  useEffect(() => {
    const adopt = () => {
      adoptedGeneration.current = selectionsGeneration();
      const saved = loadSelections();
      if (!saved) return;
      setClassType(saved.classType);
      setTargets(saved.targets);
      setMajor(saved.major);
      setSetReqs(saved.setReqs);
      setPinnedSets(saved.pinnedSets);
      setSetFilters(saved.setFilters);
      setAllowTuning(saved.allowTuning);
      setUseBalancedTuning(saved.balancedTuning);
      setUseLegacyExotics(saved.legacyExotics);
      setUseDreamersBond(saved.dreamersBond);
      setUseFestivalMasks(saved.festivalMasks);
      setActiveSubclass(saved.activeSubclass);
      setFragSel(fragSelFromArrays(saved.fragSel));
      setExoticPerks(saved.exoticPerks);
      if (saved.classType === classType && exotics.length) {
        setSelectedExotic(resolveRestoredExotic(saved.exoticName, saved));
      } else {
        pendingExoticName.current = saved.exoticName;
      }
    };
    if (adoptedGeneration.current !== selectionsGeneration()) adopt();
    window.addEventListener(SELECTIONS_REPLACED_EVENT, adopt);
    return () => window.removeEventListener(SELECTIONS_REPLACED_EVENT, adopt);
  }, [classType, exotics, resolveRestoredExotic]);

  // Persist selections (debounced) on any change; the exotic is saved by name. Held off
  // while a restored exotic is still unresolved (see pendingExoticName).
  const pendingSave = useRef<{ timer: number; save: () => void } | null>(null);
  useEffect(() => {
    if (pendingExoticName.current !== undefined) return;
    const save = () => {
      pendingSave.current = null;
      saveSelections({
        version: SCHEMA_VERSION,
        classType,
        targets,
        major,
        setReqs: ownedSetReqs,
        pinnedSets,
        setFilters,
        exoticName:
          selectedExotic === null
            ? null
            : (exotics[selectedExotic]?.name ?? null),
        exoticPerks,
        allowTuning,
        balancedTuning: useBalancedTuning,
        legacyExotics: useLegacyExotics,
        dreamersBond: useDreamersBond,
        festivalMasks: useFestivalMasks,
        activeSubclass,
        fragSel: fragSelToArrays(fragSel),
      });
    };
    const timer = window.setTimeout(save, 300);
    pendingSave.current = { timer, save };
    return () => window.clearTimeout(timer);
  }, [
    classType,
    targets,
    major,
    ownedSetReqs,
    pinnedSets,
    setFilters,
    selectedExotic,
    exotics,
    exoticPerks,
    allowTuning,
    useBalancedTuning,
    useLegacyExotics,
    useDreamersBond,
    useFestivalMasks,
    activeSubclass,
    fragSel,
  ]);
  // Hidden (tab switch) or unmounted mid-debounce: write the pending selections now
  // instead of dropping them.
  useEffect(
    () => () => {
      const pending = pendingSave.current;
      if (!pending) return;
      window.clearTimeout(pending.timer);
      pending.save();
    },
    [],
  );

  const runOptimizer = useCallback(() => {
    if (classType === null) return;

    const toOpt = (p: ArmorPiece): OptimizerPiece => ({
      id: p.instanceId,
      stats: p.stats,
      exotic: p.isExotic,
      hash: p.itemHash,
      setHash: p.setHash,
      // Artifice is legacy-only, tuning Tier-5-only; enforce the exclusivity here
      // (the solver stays general, the results UI shares one column for both).
      artifice: p.isArtifice && p.tunedStat === undefined,
      tuning:
        p.tunedStat !== undefined
          ? { tuned: p.tunedStat, offStats: offArchetypeIndices(p.baseStats) }
          : undefined,
    });

    const slots = ARMOR_SLOTS.map((slot) => {
      const pieces =
        slot === "classItem"
          ? classItemPieces
          : slot === "helmet" && festivalMaskHelmets
            ? festivalMaskHelmets
            : pool.filter((p) => p.slot === slot);
      return pieces.map(toOpt);
    });

    const exotic: ExoticConstraint =
      selectedExotic === null
        ? { mode: "any" }
        : { mode: "specific", hashes: exotics[selectedExotic]?.hashes ?? [] };
    run({
      slots,
      minimums: targets,
      mods: { major, minor: MAX_MODS - major },
      setRequirements,
      exotic,
      allowTuning,
      allowBalancedTuning: useBalancedTuning,
      fragmentBonus,
      maxResults: 200,
    });
  }, [
    pool,
    classItemPieces,
    festivalMaskHelmets,
    classType,
    targets,
    major,
    setRequirements,
    selectedExotic,
    exotics,
    allowTuning,
    useBalancedTuning,
    fragmentBonus,
    run,
  ]);

  const authed = session.data?.authenticated ?? false;
  const ready = authed && Boolean(armory) && Boolean(manifest);

  // Auto-search: rerun the optimizer a beat after any selection changes. `runOptimizer` is
  // memoized on exactly the build inputs, so its identity changing is the "something
  // changed" signal; the cleanup cancels the pending run, giving a trailing-edge debounce.
  useEffect(() => {
    if (!ready || classType === null) return;
    const t = window.setTimeout(runOptimizer, 250);
    return () => window.clearTimeout(t);
  }, [ready, classType, runOptimizer]);

  const setTarget = useCallback(
    (i: number, value: number) =>
      setTargets((prev) => prev.map((v, idx) => (idx === i ? value : v))),
    [],
  );

  const onClassChange = useCallback((next: number) => {
    setClassType(next);
    setSetReqs({});
    setSelectedExotic(null);
    setExoticPerks([null, null]);
  }, []);

  const onExoticSelect = useCallback((index: number | null) => {
    setSelectedExotic(index);
    setExoticPerks([null, null]);
    if (index === null) return;
    const hashes = exotics[index]?.hashes ?? [];
    if (hashes.some(isExoticClassItemHash)) setUseDreamersBond(false);
    if (hashesIncludeHelmet(hashes, classPieces)) setUseFestivalMasks(false);
  }, [exotics, classPieces]);

  const onDreamersBondChange = useCallback(
    (checked: boolean) => {
      setUseDreamersBond(checked);
      if (checked && selectedClassItemHash !== undefined) {
        setSelectedExotic(null);
        setExoticPerks([null, null]);
      }
    },
    [selectedClassItemHash],
  );

  const onFestivalMasksChange = useCallback(
    (checked: boolean) => {
      setUseFestivalMasks(checked);
      if (
        checked &&
        selectedExoticOption &&
        hashesIncludeHelmet(selectedExoticOption.hashes, classPieces)
      ) {
        setSelectedExotic(null);
        setExoticPerks([null, null]);
      }
    },
    [selectedExoticOption, classPieces],
  );

  const setSetFilter = useCallback(
    (key: keyof SetFilters, value: boolean) =>
      setSetFilters((prev) => ({ ...prev, [key]: value })),
    [],
  );

  const toggleSet = useCallback((setHash: number, count: 2 | 4) => {
    setSetReqs((prev) => {
      const next = { ...prev };
      if (next[setHash] === count) delete next[setHash];
      else next[setHash] = count;
      return next;
    });
  }, []);

  const togglePin = useCallback((setHash: number) => {
    setPinnedSets((prev) =>
      prev.includes(setHash)
        ? prev.filter((h) => h !== setHash)
        : [...prev, setHash],
    );
  }, []);

  const refetchArmory = armoryQuery.refetch;
  const onEquipped = useCallback(() => {
    void refetchArmory();
  }, [refetchArmory]);

  // What a saved loadout remembers about this session, so "Load in builder" restores it.
  const builderSnapshot = useMemo<BuilderSnapshot>(
    () => ({
      targets,
      major,
      setReqs: ownedSetReqs,
      exoticName:
        selectedExotic === null
          ? null
          : (exotics[selectedExotic]?.name ?? null),
      exoticPerks,
      allowTuning,
      balancedTuning: useBalancedTuning,
      legacyExotics: useLegacyExotics,
      dreamersBond: useDreamersBond,
      festivalMasks: useFestivalMasks,
      activeSubclass,
      fragmentHashes: [...fragSel[activeSubclass]],
    }),
    [
      targets,
      major,
      ownedSetReqs,
      selectedExotic,
      exotics,
      exoticPerks,
      allowTuning,
      useBalancedTuning,
      useLegacyExotics,
      useDreamersBond,
      useFestivalMasks,
      activeSubclass,
      fragSel,
    ],
  );

  // Latest targets/snapshot without changing `buildsProps` identity on slider moves.
  // Rows only need targets/snapshot at click time (DIM export, save), so hand them a
  // stable getter instead of the values: a slider drag then re-renders one StatTargetRow,
  // not fifty BuildRows. The holder is written from a layout effect, not during render, so
  // a discarded concurrent render can never leave it stale. (A plain ref would do the same
  // job, but react-hooks/refs flags a ref-reading callback passed into useMemo.)
  const [builderState] = useState(() =>
    createValueStore({ targets, builderSnapshot }),
  );
  useLayoutEffect(() => {
    builderState.set({ targets, builderSnapshot });
  });
  const getBuilderState = builderState.get;
  // The rows' stat chips light up on met targets; they subscribe to this store per chip
  // (selector → boolean), so a drag re-renders only the chips whose state flips.
  useLayoutEffect(() => {
    liveTargets.set(targets);
  }, [targets]);

  const buildsProps: BuildsColumnContentProps = useMemo(
    () => ({
      ready,
      showLoading,
      running,
      result,
      displayedProgress,
      refinement,
      refinementProgress,
      onShowPending: applyPending,
      onCancel: cancel,
      pieceMap,
      setMap,
      statIcons,
      balancedTuningIcon,
      characters: armory?.characters ?? [],
      statModHashes,
      tuningPlugHashes,
      artificeModHashes,
      subclass: dimSubclass,
      getBuilderState,
      manifest,
      insertablePlugs: armory?.insertablePlugs,
      onEquipped,
    }),
    [
      ready,
      showLoading,
      running,
      result,
      displayedProgress,
      refinement,
      refinementProgress,
      applyPending,
      cancel,
      pieceMap,
      setMap,
      statIcons,
      balancedTuningIcon,
      armory?.characters,
      statModHashes,
      tuningPlugHashes,
      artificeModHashes,
      dimSubclass,
      getBuilderState,
      manifest,
      armory?.insertablePlugs,
      onEquipped,
    ],
  );

  return (
    // 24px between columns until 1920px — 2xl's 96px Figma gap squeezes the
    // build cards while the sidebar is still on screen.
    <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(18rem,30.5rem)_minmax(29rem,1fr)] lg:items-start lg:gap-x-6 min-[120rem]:gap-x-24">
      {/* Left — configure the build. Figma 17:5852: a 488px column of sections
          separated by 1px dividers with 32px above and below each. */}
      <div className="divide-border divide-y">
        {ready && (
          <>
            {classes.length > 1 && classType !== null && (
              <div className="pb-8">
                <ClassEmblemTabs
                  characters={armory?.characters ?? []}
                  value={classType}
                  onChange={onClassChange}
                />
              </div>
            )}

            <Section>
              <div className="space-y-8">
                {STAT_DISPLAY_ORDER.map((key) => {
                  const i = STAT_ORDER.indexOf(key);
                  return (
                    <StatTargetRow
                      key={key}
                      statKey={key}
                      index={i}
                      icon={statIcons[key]}
                      value={targets[i]}
                      ceilingsView={ceilingsView}
                      onChange={setTarget}
                    />
                  );
                })}
              </div>
            </Section>

            <Section title="Major mods" className="space-y-2">
              <Tabs
                value={String(major)}
                onValueChange={(v) => setMajor(Number(v))}
              >
                <TabsList>
                  {[0, 1, 2, 3, 4, 5].map((n) => (
                    <TabsTrigger key={n} value={String(n)}>
                      {n}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </Section>

            <Section>
              <ExoticPicker
                options={exotics}
                selected={selectedExotic}
                onSelect={onExoticSelect}
              />
              {spiritPerks && !useDreamersBond && (
                <div className="mt-4">
                  <ExoticClassPerkPicker
                    left={spiritPerks.left}
                    right={spiritPerks.right}
                    selected={exoticPerks}
                    onChange={setExoticPerks}
                    statIcons={statIcons}
                  />
                </div>
              )}
            </Section>

            <Section className="space-y-0">
              {/* Figma 17:5659: full-width search, then the count line with sort + settings */}
              <div className="space-y-2">
                <div className="relative">
                  <MagnifyingGlass
                    className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 z-10 size-4 -translate-y-1/2"
                    aria-hidden
                  />
                  <Input
                    type="search"
                    value={setQuery}
                    onChange={(e) => setSetQuery(e.target.value)}
                    placeholder="Search set bonuses"
                    aria-label="Search set bonuses"
                    className="pl-8"
                  />
                </div>
                <SetListControls
                  count={pinnedList.length + unpinnedList.length}
                  sort={setSort}
                  onSortChange={setSetSort}
                  filters={setFilters}
                  onFilterChange={setSetFilter}
                />
              </div>
              {sets.length === 0 ? (
                <p className="text-muted-foreground pt-4 text-xs">
                  No set-bonus armor found for this class.
                </p>
              ) : pinnedList.length === 0 && unpinnedList.length === 0 ? (
                <p className="text-muted-foreground pt-4 text-xs">
                  {setQuery.trim() && customSetFilters
                    ? `No sets match "${setQuery.trim()}" with the current settings.`
                    : setQuery.trim()
                      ? `No sets match "${setQuery.trim()}".`
                      : customSetFilters
                        ? "No sets match the current settings."
                        : "No sets to show."}
                </p>
              ) : (
                // Figma 17:5731: name · 2pc · 4pc columns (≈191 / 102 / 140 of 488), 16px row gap
                <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,0.75fr)_minmax(0,1fr)] items-center gap-x-4 gap-y-4 pt-8">
                  <span aria-hidden />
                  <span className="text-sm">2pc</span>
                  <span className="text-sm">4pc</span>
                  {pinnedList.map((s) => (
                    <SetRow
                      key={s.setHash}
                      set={s}
                      pinned
                      req={setReqs[s.setHash]}
                      onTogglePin={togglePin}
                      onToggleSet={toggleSet}
                    />
                  ))}
                  {pinnedList.length > 0 && unpinnedList.length > 0 && (
                    <div
                      className="border-border col-span-full border-t"
                      aria-hidden
                    />
                  )}
                  {unpinnedList.map((s) => (
                    <SetRow
                      key={s.setHash}
                      set={s}
                      pinned={false}
                      req={setReqs[s.setHash]}
                      onTogglePin={togglePin}
                      onToggleSet={toggleSet}
                    />
                  ))}
                </div>
              )}
            </Section>

            <Section>
              {fragments && (
                <FragmentPicker
                  fragments={fragments}
                  activeSubclass={activeSubclass}
                  onSubclassChange={setActiveSubclass}
                  selected={fragSel[activeSubclass]}
                  onToggle={toggleFragment}
                  statIcons={statIcons}
                  onApplyCurrent={onApplyCurrentFragments}
                  applyDisabled={!canApplyCurrentFragments}
                  applyLoading={applyingFragments}
                />
              )}
            </Section>

            <Section title="Tier-5 tuning">
              <TuningControls
                allowTuning={allowTuning}
                onAllowTuningChange={setAllowTuning}
                useBalancedTuning={useBalancedTuning}
                onUseBalancedTuningChange={setUseBalancedTuning}
                useDreamersBond={useDreamersBond}
                onUseDreamersBondChange={onDreamersBondChange}
                dreamersItemName={dreamersClassItemName(classType ?? 2)}
                useFestivalMasks={useFestivalMasks}
                onUseFestivalMasksChange={onFestivalMasksChange}
              />
            </Section>

            <Section title="Armor pool">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <span className="text-sm">Legacy exotics</span>
                    <p className="text-muted-foreground text-xs">
                      Include Armor 2.0 exotics — the optimizer spends their
                      artifice +3 automatically.
                    </p>
                  </div>
                  <Switch
                    checked={useLegacyExotics}
                    onCheckedChange={setUseLegacyExotics}
                    aria-label="Include legacy exotics"
                  />
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <span className="text-sm">Legacy legendaries</span>
                    <p className="text-muted-foreground text-xs">
                      Not possible yet.
                    </p>
                  </div>
                  <Switch
                    checked={false}
                    disabled
                    aria-label="Include legacy legendaries (not possible yet)"
                  />
                </div>
              </div>
            </Section>
          </>
        )}

        <div className="space-y-4 py-8 opacity-80">
          <SignInCard />
          {showInlineStatusCards && <ArmoryStatus />}
          <ManifestStatus />
        </div>
      </div>

      {/* Right — builds. Figma 17:6136: the header sits ~28px below the top of the config column. */}
      <div className="min-w-0 lg:pt-7">
        <BuildsSurface {...buildsProps} />
      </div>
    </div>
  );
}


function Section({
  title,
  className,
  children,
}: {
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("space-y-3 py-8 first:pt-0", className)}>
      {title ? <h3 className="text-sm font-medium">{title}</h3> : null}
      {children}
    </section>
  );
}
