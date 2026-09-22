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
import { ownedFestivalMasks } from "@/lib/armory/festival-masks";
import {
  buildOptimizerSlots,
  inDefaultOptimizerPool,
} from "@/lib/armory/optimizer-pool";
import {
  BALANCED_TUNING_PLUG_HASH,
  CLASS_NAMES,
  STAT_DISPLAY_ORDER,
  STAT_HASHES,
  STAT_ORDER,
  offArchetypeIndices,
  type StatIconMap,
} from "@/lib/armory/stats";
import { itemWatermark, type ArmorPiece } from "@/lib/armory/normalize";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
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
import { SettingRow } from "@/components/builder/setting-row";
import { PowerRangeControls } from "@/components/builder/power-range-controls";
import { BuildsSurface } from "@/components/builder/builds-surface";
import type { BuildsColumnContentProps } from "@/components/builder/builds-column-content";
import type { BuilderActionState } from "@/components/builder/build-actions";
import type { ExoticConstraint, OptimizerPiece } from "@/lib/optimizer/types";
import {
  DEFAULT_POWER_RANGE,
  forcesDreamersBond,
  includesLegacyArmor,
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
import { MAX_SET_BONUSES, type BuilderSnapshot } from "@/lib/loadouts/types";

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
    getSnapshot,
  } = useOptimizer<BuilderActionState>();
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
  // Held by name, not index: the exotics list is rebuilt (and re-indexed) whenever a
  // pool toggle changes, and an index would slide onto whichever exotic took its place.
  const [selectedExoticName, setSelectedExoticName] = useState<string | null>(
    null,
  );
  /** Exotic class item Spirit pair; null = Any. Cleared when exotic/class changes. */
  const [exoticPerks, setExoticPerks] = useState<
    [number | null, number | null]
  >(() => initialSaved?.exoticPerks ?? [null, null]);
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
  // Legacy EXOTICS: the solver spends their artifice +3.
  const [useLegacyExotics, setUseLegacyExotics] = useState(
    initialSaved?.legacyExotics ?? true,
  );
  // Tier 1–4 Armor 3.0 legendaries: no tuning socket, otherwise ordinary pieces.
  const [useLowerTierArmor, setUseLowerTierArmor] = useState(
    initialSaved?.lowerTierArmor ?? false,
  );
  const [powerRange, setPowerRange] = useState<PowerRangeSelection>(
    () => initialSaved?.powerRange ?? DEFAULT_POWER_RANGE,
  );
  // Dreamer's Bond and legacy armor are "Power matters" options: checked but with the
  // toggle off, they're inert.
  const useDreamersBond = forcesDreamersBond(powerRange);
  const useLegacyArmor = includesLegacyArmor(powerRange);

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
  // solver spends, Tier 1–4 Armor 3.0 legendaries, and (only while "Power matters" is
  // on) legacy Armor 2.0 legendaries. FotL masks are never in this pool; they join the
  // helmet slot as optional power-0 candidates while "Power matters" is on.
  const pool = useMemo(
    () =>
      classPieces.filter((p) =>
        inDefaultOptimizerPool(p, {
          legacyExotics: useLegacyExotics,
          lowerTierArmor: useLowerTierArmor,
          legacyArmor: useLegacyArmor,
        }),
      ),
    [classPieces, useLegacyExotics, useLowerTierArmor, useLegacyArmor],
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
  // infeasible. The optimizer and DIM/export read this pruned view; persistence and
  // "Load in builder" keep the raw `setReqs` so turning a pool toggle off can't
  // permanently drop a requirement for a set that only exists on the wider pool.
  const ownedSetReqs = useMemo(() => {
    if (!setMap.size) return setReqs;
    const kept = Object.entries(setReqs).filter(([h]) => setMap.has(Number(h)));
    return kept.length === Object.keys(setReqs).length
      ? setReqs
      : (Object.fromEntries(kept) as Record<number, 2 | 4>);
  }, [setReqs, setMap]);

  // What persistence and "Load in builder" store: the raw map, capped at what
  // parseBuilderSnapshot accepts. Requirements for sets that left the pool are
  // invisible in the UI, so without the cap they accumulate silently and every
  // later save is rejected with a bare "Invalid loadout". Owned ones take the
  // slots first; orphans fill what's left.
  const persistedSetReqs = useMemo(() => {
    const entries = Object.entries(setReqs);
    if (entries.length <= MAX_SET_BONUSES) return setReqs;
    const owned = entries.filter(([h]) => setMap.has(Number(h)));
    const orphans = entries.filter(([h]) => !setMap.has(Number(h)));
    return Object.fromEntries(
      [...owned, ...orphans].slice(0, MAX_SET_BONUSES),
    ) as Record<number, 2 | 4>;
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
    const map = new Map<
      string,
      { hashes: number[]; icon?: string; watermark?: string; isTier5?: boolean }
    >();
    for (const p of pool) {
      if (!p.isExotic) continue;
      const entry = map.get(p.name) ?? {
        hashes: [],
        icon: p.icon,
        watermark: p.watermark,
        isTier5: p.tunedStat !== undefined,
      };
      if (!entry.hashes.includes(p.itemHash)) entry.hashes.push(p.itemHash);
      if (!entry.icon) entry.icon = p.icon;
      if (!entry.watermark && p.watermark) entry.watermark = p.watermark;
      if (p.tunedStat !== undefined) entry.isTier5 = true;
      map.set(p.name, entry);
    }
    if (manifest && classType !== null) {
      for (const item of availableExoticClassItems(manifest, classType)) {
        const entry = map.get(item.name) ?? {
          hashes: [],
          icon: item.icon,
          watermark: itemWatermark(
            manifest.def("DestinyInventoryItemDefinition", item.hash),
          ),
          isTier5: true,
        };
        if (!entry.hashes.includes(item.hash)) entry.hashes.push(item.hash);
        if (!entry.icon) entry.icon = item.icon;
        if (!entry.watermark) {
          entry.watermark = itemWatermark(
            manifest.def("DestinyInventoryItemDefinition", item.hash),
          );
        }
        map.set(item.name, entry);
      }
    }
    return [...map]
      .map(([name, rest]) => ({ name, ...rest }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [pool, manifest, classType]);

  // An exotic that a pool toggle removed resolves to null (any exotic) and comes back
  // with the toggle.
  const selectedExotic = useMemo(
    () => resolveExoticIndex(selectedExoticName, exotics),
    [selectedExoticName, exotics],
  );
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

  // The optimizer's candidates per slot: the class-item pool (Spirit-filtered /
  // Dreamer's-pinned), the helmet pool per helmetCandidates (masks optional under a
  // power range), the T5 pool otherwise. runOptimizer maps these to OptimizerPieces;
  // the power range controls read their power.
  const slotPieces = useMemo(
    () =>
      buildOptimizerSlots(pool, {
        classItemPieces,
        masks: festivalMaskHelmets,
        powerConstrained,
      }),
    [pool, classItemPieces, festivalMaskHelmets, powerConstrained],
  );

  // The pool as it stands once Power matters is ON — identical while it is; with the
  // toggle off, the same builder runs again with Dreamer's pinned (if checked) and
  // legacy legendaries admitted (if checked), including class items. Spirit selection
  // is applied too, so a theoretical exotic class item seeds the first-enable range.
  const powerSlotPieces = useMemo(() => {
    if (powerRange.enabled) return slotPieces;
    const previewPool = classPieces.filter((p) =>
      inDefaultOptimizerPool(p, {
        legacyExotics: useLegacyExotics,
        lowerTierArmor: useLowerTierArmor,
        legacyArmor: powerRange.legacyArmor,
      }),
    );
    let previewClassItems;
    if (powerRange.dreamersBond) {
      previewClassItems = dreamersPiece ? [dreamersPiece] : [];
    } else {
      previewClassItems = previewPool.filter((p) => p.slot === "classItem");
      if (
        manifest &&
        classType !== null &&
        selectedClassItemHash !== undefined
      ) {
        previewClassItems = applySpiritSelectionToClassItems(
          previewClassItems,
          manifest,
          {
            selectedClassItemHash,
            exoticPerks,
            name: selectedExoticOption?.name ?? "Exotic class item",
            icon: selectedExoticOption?.icon,
            classType,
          },
        );
      }
    }
    return buildOptimizerSlots(previewPool, {
      classItemPieces: previewClassItems,
      masks: festivalMaskHelmets,
      powerConstrained: true,
    });
  }, [
    slotPieces,
    classPieces,
    useLegacyExotics,
    useLowerTierArmor,
    powerRange.enabled,
    powerRange.dreamersBond,
    powerRange.legacyArmor,
    dreamersPiece,
    festivalMaskHelmets,
    manifest,
    classType,
    selectedClassItemHash,
    selectedExoticOption,
    exoticPerks,
  ]);

  // A stored exotic class item loses to a forced Dreamer's Bond on restore. From then on
  // the exotic picker and the power-range handler keep the two exclusive, so no effect
  // has to referee them.
  const resolveRestoredExotic = useCallback(
    (name: string | null, dreamersBond: boolean): string | null => {
      const index = resolveExoticIndex(name, exotics);
      if (index === null) return null;
      if (dreamersBond && exotics[index].hashes.some(isExoticClassItemHash)) return null;
      return name;
    },
    [exotics],
  );

  // Resolve the restored exotic (persisted by name) once the live list exists.
  // Consumed once so a later class switch can't re-apply it; not-owned-now → cleared.
  useEffect(() => {
    if (pendingExoticName.current === undefined || !exotics.length) return;
    const name = pendingExoticName.current;
    pendingExoticName.current = undefined;
    setSelectedExoticName(resolveRestoredExotic(name, useDreamersBond));
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
      setUseBalancedTuning(saved.balancedTuning);
      setUseLegacyExotics(saved.legacyExotics);
      setUseLowerTierArmor(saved.lowerTierArmor);
      setPowerRange(saved.powerRange);
      setActiveSubclass(saved.activeSubclass);
      setFragSel(fragSelFromArrays(saved.fragSel));
      setExoticPerks(saved.exoticPerks);
      if (saved.classType === classType && exotics.length) {
        setSelectedExoticName(
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
        setReqs: persistedSetReqs,
        pinnedSets,
        setFilters,
        exoticName:
          selectedExotic === null
            ? null
            : (exotics[selectedExotic]?.name ?? null),
        exoticPerks,
        allowTuning: true,
        balancedTuning: useBalancedTuning,
        legacyExotics: useLegacyExotics,
        lowerTierArmor: useLowerTierArmor,
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
    persistedSetReqs,
    pinnedSets,
    setFilters,
    selectedExotic,
    exotics,
    exoticPerks,
    useBalancedTuning,
    useLegacyExotics,
    useLowerTierArmor,
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

  // What a saved loadout remembers about this session, so "Load in builder" restores it.
  const builderSnapshot = useMemo<BuilderSnapshot>(
    () => ({
      targets,
      major,
      setReqs: persistedSetReqs,
      exoticName:
        selectedExotic === null
          ? null
          : (exotics[selectedExotic]?.name ?? null),
      exoticPerks,
      allowTuning: true,
      balancedTuning: useBalancedTuning,
      legacyExotics: useLegacyExotics,
      lowerTierArmor: useLowerTierArmor,
      powerRange,
      activeSubclass,
      fragmentHashes: [...fragSel[activeSubclass]],
    }),
    [
      targets,
      major,
      persistedSetReqs,
      selectedExotic,
      exotics,
      exoticPerks,
      useBalancedTuning,
      useLegacyExotics,
      useLowerTierArmor,
      powerRange,
      activeSubclass,
      fragSel,
    ],
  );

  // The state a shown build's actions (save, DIM export) act on: targets, the builder
  // snapshot, set bonuses and the subclass/fragments. Every search hands the store the
  // state it was dispatched from (`origin` below), and the store echoes it back bound to
  // that query's result (`resultOrigin`) — so the rows always act on the configuration
  // that PRODUCED the list they show. The list deliberately stays on screen while a newer
  // query runs, sits in the debounce, or was cancelled; reading the live state then
  // would combine a new subclass/targets with an old list's stats into one loadout.
  // The live holder is only the typed fallback for "no result yet" (nothing to act on):
  // written from a layout effect, not during render, so a discarded concurrent render
  // can never leave it stale.
  const [liveActionState] = useState(() =>
    createValueStore<BuilderActionState>({
      targets,
      builderSnapshot,
      setBonuses: ownedSetReqs,
      subclass: dimSubclass,
    }),
  );
  useLayoutEffect(() => {
    liveActionState.set({
      targets,
      builderSnapshot,
      setBonuses: ownedSetReqs,
      subclass: dimSubclass,
    });
  });
  // Stable getter (rows memoize on it): a slider drag re-renders one StatTargetRow, not
  // fifty BuildRows; rows read it only at click time.
  const getBuilderState = useCallback(
    (): BuilderActionState => getSnapshot().resultOrigin ?? liveActionState.get(),
    [getSnapshot, liveActionState],
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
    run(
      {
        slots,
        minimums: targets,
        mods: { major, minor: MAX_MODS - major },
        setRequirements,
        exotic,
        allowTuning: true,
        allowBalancedTuning: useBalancedTuning,
        fragmentBonus,
        powerRange: toOptimizerPowerRange(powerRange),
        maxResults: 200,
      },
      // The state this query is dispatched from, bound to its results (see
      // getBuilderState). Snapshot/subclass are deps too: an edit that changes them
      // without changing the optimizer input (a fragment swap with the same stat
      // effect) still re-dispatches, and the store refreshes the bound state in place.
      { targets, builderSnapshot, setBonuses: ownedSetReqs, subclass: dimSubclass },
    );
  }, [
    slotPieces,
    classType,
    targets,
    major,
    setRequirements,
    selectedExotic,
    exotics,
    useBalancedTuning,
    fragmentBonus,
    powerRange,
    builderSnapshot,
    ownedSetReqs,
    dimSubclass,
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
    setSelectedExoticName(null);
    setExoticPerks([null, null]);
  }, []);

  const onExoticSelect = useCallback((index: number | null) => {
    setSelectedExoticName(index === null ? null : (exotics[index]?.name ?? null));
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
        setSelectedExoticName(null);
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

  const toggleSet = useCallback(
    (setHash: number, count: 2 | 4) => {
      setSetReqs((prev) => {
        const next = { ...prev };
        if (next[setHash] === count) {
          delete next[setHash];
          return next;
        }
        next[setHash] = count;
        // Requirements for sets no longer in the pool are kept (a pool toggle
        // shouldn't drop one for good) but they're invisible here, so they must
        // never crowd out a pick the player can actually see.
        const keys = Object.keys(next);
        if (keys.length > MAX_SET_BONUSES) {
          const evict =
            keys.find((h) => Number(h) !== setHash && !setMap.has(Number(h))) ??
            keys.find((h) => Number(h) !== setHash);
          if (evict !== undefined) delete next[Number(evict)];
        }
        return next;
      });
    },
    [setMap],
  );

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
      getBuilderState,
      manifest,
      armory?.insertablePlugs,
      onEquipped,
    ],
  );

  return (
    <div className="grid h-full min-h-0 w-full flex-1 grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,39.74rem)_5rem_minmax(0,calc((80rem-39.74rem-5rem)*1.15))_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:gap-x-0">
      {/* Settings scroller spans the left leftover + the card column, so
          wheel-scrolling anywhere to the left of the cards still moves this
          pane. Inner max-width keeps the cards on the 39.74rem track. Mins are
          0 so the two columns share a narrow main pane instead of overflowing
          past `lg:overflow-hidden`. */}
      <div className="d2-scroll flex min-h-0 min-w-0 flex-col lg:col-start-1 lg:col-end-3 lg:overflow-y-auto lg:overscroll-contain lg:pl-6 lg:pr-2">
        <div className="flex flex-col gap-4 lg:ml-auto lg:w-full lg:max-w-[39.74rem]">
          {ready && (
          <>
            {classes.length > 1 && classType !== null && (
              <ClassEmblemTabs
                characters={armory?.characters ?? []}
                value={classType}
                onChange={onClassChange}
              />
            )}

            <Section title="Stats">
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

            <Section title="Major mods">
              <Tabs
                value={String(major)}
                onValueChange={(v) => setMajor(Number(v))}
              >
                <TabsList variant="icon" aria-label="Major stat mods">
                  {[0, 1, 2, 3, 4, 5].map((n) => (
                    <TabsTrigger key={n} value={String(n)}>
                      {n}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </Section>

            <Section title="Exotic">
              <ExoticPicker
                options={exotics}
                selected={selectedExotic}
                onSelect={onExoticSelect}
              />
              {spiritPerks && !useDreamersBond && (
                <ExoticClassPerkPicker
                  left={spiritPerks.left}
                  right={spiritPerks.right}
                  selected={exoticPerks}
                  onChange={setExoticPerks}
                  statIcons={statIcons}
                />
              )}
            </Section>

            <Section title="Set bonuses">
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
                <p className="text-muted-foreground text-xs">
                  No set-bonus armor found for this class.
                </p>
              ) : pinnedList.length === 0 && unpinnedList.length === 0 ? (
                <p className="text-muted-foreground text-xs">
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
                <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,0.75fr)_minmax(0,1fr)] items-center gap-x-4 gap-y-4">
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

            <Section title="Fragments">
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

            <Section title="Advanced settings">
              <div className="flex flex-col gap-4">
                <SettingRow
                  checkbox
                  checked={useBalancedTuning}
                  onCheckedChange={setUseBalancedTuning}
                  title="Use balanced tuning mods"
                  description="When off, builds are searched without the Balanced (+1 to off-stats) tune. Directional tuning stays available."
                />
                <SettingRow
                  checkbox
                  checked={useLegacyExotics}
                  onCheckedChange={setUseLegacyExotics}
                  title="Legacy exotics"
                  description="Include Armor 2.0 exotics"
                />
                <SettingRow
                  checkbox
                  checked={useLowerTierArmor}
                  onCheckedChange={setUseLowerTierArmor}
                  title="Lower tier armor"
                  description="Include Tier 1–4 Armor 3.0 legendaries. They can't be tuned, but they still count toward set bonuses."
                />
              </div>
            </Section>
            <Section title="Underlight settings">
              <PowerRangeControls
                value={powerRange}
                onChange={onPowerRangeChange}
                slotPieces={powerSlotPieces}
                dreamersItemName={dreamersClassItemName(classType ?? 2)}
              />
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
      </div>

      {/* Builds scroller spans the results column + the right leftover. */}
      <div className="d2-scroll min-h-0 min-w-0 lg:col-start-4 lg:col-end-6 lg:overflow-y-auto lg:overscroll-contain lg:pr-6 lg:pl-2">
        <div className="lg:max-w-[calc((80rem-39.74rem-5rem)*1.15)]">
          <BuildsSurface {...buildsProps} />
        </div>
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
    <section
      className={cn(
        "d2-card-frame relative flex flex-col gap-3 rounded-none p-3 [--card-line-width:1.5px] hover:[--line-alpha:1.6]",
        className,
      )}
    >
      {title ? <SectionHeading>{title}</SectionHeading> : null}
      {children}
    </section>
  );
}
