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
  helmetCandidates,
  inDefaultOptimizerPool,
  ownedFestivalMasks,
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
import { SectionHeading } from "@/components/section-heading";
import { SetRow } from "@/components/builder/set-row";
import { ArmoryStatus } from "@/components/armory/armory-status";
import { ManifestStatus } from "@/components/manifest/manifest-status";
import { ExoticPicker } from "@/components/builder/exotic-picker";
import { ExoticClassPerkPicker } from "@/components/builder/exotic-class-perk-picker";
import { FragmentPicker } from "@/components/builder/fragment-picker";
import { SetListControls } from "@/components/builder/set-list-controls";
import { ClassEmblemTabs } from "@/components/builder/class-emblem-tabs";
import { TuningControls } from "@/components/builder/tuning-controls";
import { PowerRangeControls } from "@/components/builder/power-range-controls";
import { BuildsSurface } from "@/components/builder/builds-surface";
import type { BuildsColumnContentProps } from "@/components/builder/builds-column-content";
import type { ExoticConstraint, OptimizerPiece } from "@/lib/optimizer/types";
import {
  DEFAULT_POWER_RANGE,
  forcesDreamersBond,
  loadSelections,
  saveSelections,
  fragSelToArrays,
  fragSelFromArrays,
  resolveExoticIndex,
  SCHEMA_VERSION,
  SELECTIONS_REPLACED_EVENT,
  selectionsGeneration,
  toOptimizerPowerRange,
  type PowerRangeSelection,
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
  const [powerRange, setPowerRange] = useState<PowerRangeSelection>(
    () => initialSaved?.powerRange ?? DEFAULT_POWER_RANGE,
  );
  // Dreamer's Bond is a "Power matters" option: checked but with the toggle off, it's inert.
  const useDreamersBond = forcesDreamersBond(powerRange);

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
  // solver spends. Legacy legendaries stay excluded until supported. FotL masks
  // are never in this pool; they replace the helmet slot when that toggle is on, and
  // join it as optional power-0 candidates while "Power matters" is on.
  const pool = useMemo(
    () =>
      classPieces.filter((p) => inDefaultOptimizerPool(p, useLegacyExotics)),
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

  // The Dreamer's Bond piece whenever its box is checked — even while Power matters is
  // off and it's inert, so the power controls can seed from the pool the toggle will use.
  const dreamersPiece = useMemo(
    () =>
      powerRange.dreamersBond && classType !== null
        ? dreamersBondPiece(classType, manifest)
        : null,
    [powerRange.dreamersBond, classType, manifest],
  );

  // Class-item pool with Spirit filter + optional synthetic T5 roll (owned matches win).
  // Dreamer's Bond replaces the whole slot with a hardcoded 0-stat collections item.
  const classItemPieces = useMemo(() => {
    if (useDreamersBond) return dreamersPiece ? [dreamersPiece] : [];
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
    dreamersPiece,
  ]);

  // Owned FotL masks wearable by this class (vault / inventory / equipped). Cheap, so
  // always collected; helmetCandidates decides whether they enter the helmet slot.
  const festivalMaskHelmets = useMemo(
    () =>
      classType === null || !armory ? [] : ownedFestivalMasks(armory.pieces, classType),
    [armory, classType],
  );

  const pieceMap = useMemo(() => {
    const map = new Map(classPieces.map((p) => [p.instanceId, p]));
    // Theoretical rolls live only in classItemPieces, and any-class (classType 3) masks
    // aren't in classPieces — results resolve through this map, so merge both.
    for (const p of classItemPieces) {
      if (!map.has(p.instanceId)) map.set(p.instanceId, p);
    }
    for (const p of festivalMaskHelmets) {
      if (!map.has(p.instanceId)) map.set(p.instanceId, p);
    }
    return map;
  }, [classPieces, classItemPieces, festivalMaskHelmets]);

  // Masks join the helmet pool only while the solver will actually enforce a range —
  // the same contract runOptimizer uses (enabled with no bounds constrains nothing).
  const powerConstrained = toOptimizerPowerRange(powerRange) !== undefined;

  // The optimizer's candidates per slot, in ARMOR_SLOTS order: the class-item pool
  // (Spirit-filtered / Dreamer's-pinned), the helmet pool per helmetCandidates (masks
  // optional under a power range / absent), the T5 pool otherwise. runOptimizer maps
  // these to OptimizerPieces; the power range controls read their power.
  const slotPieces = useMemo(
    () =>
      ARMOR_SLOTS.map((slot) =>
        slot === "classItem"
          ? classItemPieces
          : slot === "helmet"
            ? helmetCandidates(
                pool.filter((p) => p.slot === "helmet"),
                festivalMaskHelmets,
                powerConstrained,
              )
            : pool.filter((p) => p.slot === slot),
      ),
    [pool, classItemPieces, festivalMaskHelmets, powerConstrained],
  );

  // The pool as it stands once Power matters is ON — identical while it is; with the
  // toggle off and Dreamer's Bond checked, the class-item slot the toggle will pin. The
  // power controls seed the first-enable range from this, so the seed can't be read off
  // a slot the same click replaces with a 21-power piece.
  const powerSlotPieces = useMemo(() => {
    if (useDreamersBond || !powerRange.dreamersBond) return slotPieces;
    const pinned = dreamersPiece ? [dreamersPiece] : [];
    return slotPieces.map((pieces, i) =>
      ARMOR_SLOTS[i] === "classItem" ? pinned : pieces,
    );
  }, [slotPieces, useDreamersBond, powerRange.dreamersBond, dreamersPiece]);

  // A stored exotic class item loses to a forced Dreamer's Bond on restore. From then on
  // the exotic picker and the power-range handler keep the two exclusive, so no effect
  // has to referee them.
  const resolveRestoredExotic = useCallback(
    (name: string | null, dreamersBond: boolean): number | null => {
      const index = resolveExoticIndex(name, exotics);
      if (index === null) return null;
      if (dreamersBond && exotics[index].hashes.some(isExoticClassItemHash)) return null;
      return index;
    },
    [exotics],
  );

  // Resolve the restored exotic (persisted by name) to an index once the live list exists.
  // Consumed once so a later class switch can't re-apply it; not-owned-now → cleared.
  useEffect(() => {
    if (pendingExoticName.current === undefined || !exotics.length) return;
    const name = pendingExoticName.current;
    pendingExoticName.current = undefined;
    setSelectedExotic(resolveRestoredExotic(name, useDreamersBond));
  }, [exotics, resolveRestoredExotic, useDreamersBond]);

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
      setPowerRange(saved.powerRange);
      setActiveSubclass(saved.activeSubclass);
      setFragSel(fragSelFromArrays(saved.fragSel));
      setExoticPerks(saved.exoticPerks);
      if (saved.classType === classType && exotics.length) {
        setSelectedExotic(
          resolveRestoredExotic(saved.exoticName, forcesDreamersBond(saved.powerRange)),
        );
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
        powerRange,
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
    powerRange,
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
      power: p.power,
      // Artifice is legacy-only, tuning Tier-5-only; enforce the exclusivity here
      // (the solver stays general, the results UI shares one column for both).
      artifice: p.isArtifice && p.tunedStat === undefined,
      tuning:
        p.tunedStat !== undefined
          ? { tuned: p.tunedStat, offStats: offArchetypeIndices(p.baseStats) }
          : undefined,
    });

    const slots = slotPieces.map((pieces) => pieces.map(toOpt));

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
      powerRange: toOptimizerPowerRange(powerRange),
      maxResults: 200,
    });
  }, [
    slotPieces,
    classType,
    targets,
    major,
    setRequirements,
    selectedExotic,
    exotics,
    allowTuning,
    useBalancedTuning,
    fragmentBonus,
    powerRange,
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
    if (hashes.some(isExoticClassItemHash)) {
      setPowerRange((r) => (r.dreamersBond ? { ...r, dreamersBond: false } : r));
    }
  }, [exotics]);

  // Forcing Dreamer's Bond — by its checkbox, or by turning Power matters on with it
  // already checked — evicts a selected exotic class item from the pinned slot.
  const onPowerRangeChange = useCallback(
    (next: PowerRangeSelection) => {
      setPowerRange(next);
      if (
        forcesDreamersBond(next) &&
        !forcesDreamersBond(powerRange) &&
        selectedClassItemHash !== undefined
      ) {
        setSelectedExotic(null);
        setExoticPerks([null, null]);
      }
    },
    [powerRange, selectedClassItemHash],
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
      powerRange,
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
      powerRange,
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
    <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-10 lg:grid-cols-[minmax(18rem,33.12rem)_minmax(29rem,1fr)] lg:items-start lg:gap-x-20">
      {/* Left — configure the build. 33.12rem cap so the builds column is 15%
          wider at max-w-7xl. Sections: 1px dividers, 32px above and below. */}
      <div className="divide-y divide-foreground/10">
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

            <Section title="Stat targets" detail={CLASS_NAMES[classType ?? -1]}>
              <div className="space-y-7">
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

            <Section title="Major mods" detail={`${major} of ${MAX_MODS}`} className="space-y-3">
              <Tabs
                value={String(major)}
                onValueChange={(v) => setMajor(Number(v))}
              >
                <TabsList variant="default" aria-label="Major stat mods">
                  {[0, 1, 2, 3, 4, 5].map((n) => (
                    <TabsTrigger key={n} value={String(n)}>
                      {n}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </Section>

            <Section title="Exotic" detail={selectedExoticOption?.name ?? "Any"}>
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

            <Section title="Set bonuses" className="space-y-0">
              <div className="space-y-2 pt-1">
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
                // Figma 17:5731: name · 2pc perk · 4pc perk columns, 16px row gap
                <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,0.75fr)_minmax(0,1fr)] items-center gap-x-4 gap-y-4 pt-4">
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

            <Section title="Fragments" detail={activeSubclass}>
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

            <Section title="Tier-5 tuning" detail={allowTuning ? "On" : "Off"}>
              <TuningControls
                allowTuning={allowTuning}
                onAllowTuningChange={setAllowTuning}
                useBalancedTuning={useBalancedTuning}
                onUseBalancedTuningChange={setUseBalancedTuning}
              />
            </Section>

            <Section title="Power" detail={powerRange.enabled ? "Ranged" : "Any"}>
              <PowerRangeControls
                value={powerRange}
                onChange={onPowerRangeChange}
                slotPieces={powerSlotPieces}
                dreamersItemName={dreamersClassItemName(classType ?? 2)}
              />
            </Section>

            <Section title="Armor pool">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <span className="text-sm font-medium">Legacy exotics</span>
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
                    <span className="text-sm font-medium">Legacy legendaries</span>
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

        {!ready && !showInlineStatusCards && (
          <div className="space-y-4 py-8 opacity-80">
            <ManifestStatus />
          </div>
        )}

        {showInlineStatusCards && (
          <div className="py-8 opacity-80">
            <ArmoryStatus />
          </div>
        )}
      </div>

      {/* Right — builds. */}
      <div className="min-w-0">
        <BuildsSurface {...buildsProps} />
      </div>
    </div>
  );
}


function Section({
  title,
  detail,
  className,
  children,
}: {
  title?: string;
  /** Secondary text after the "//" separator in the heading. */
  detail?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("space-y-4 py-8 first:pt-0", className)}>
      {title ? (
        <SectionHeading detail={detail}>{title}</SectionHeading>
      ) : null}
      {children}
    </section>
  );
}
