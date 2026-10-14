"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import dynamic from "next/dynamic";
import { useSession } from "@/lib/auth/use-session";
import { useArmory } from "@/lib/armory/use-armory";
import { useManifest } from "@/lib/manifest/use-manifest";
import { useOptimizer } from "@/lib/optimizer/use-optimizer";
import { useSmoothedProgress } from "@/lib/use-smoothed-progress";
import { availableSets, makeableSetReqs } from "@/lib/armory/sets";
import {
  makeableRaidReqs,
  ownedLegacyRaids,
  raidSetRequirements,
  type LegacyRaidKey,
} from "@/lib/armory/legacy-raids";
import {
  DEFAULT_SET_FILTERS,
  type SetFilters,
  type SetMinOwned,
} from "@/lib/armory/set-filters";
import {
  availableFragments,
  type Subclass,
} from "@/lib/armory/fragments";
import {
  applySpiritSelectionToClassItems,
  availableExoticClassItems,
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
  type PoolOptions,
} from "@/lib/armory/optimizer-pool";
import {
  ARMOR_SLOTS,
  BALANCED_TUNING_PLUG_HASH,
  CLASS_NAMES,
  STAT_DISPLAY_ORDER,
  STAT_HASHES,
  STAT_ORDER,
  type ArmorSlot,
  type StatIconMap,
} from "@/lib/armory/stats";
import { itemWatermark } from "@/lib/armory/normalize";
import { getArchetypes } from "@/lib/armory/archetypes";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatTargetRow } from "@/components/builder/stat-target-row";
import { SectionHeading } from "@/components/section-heading";
import { ArmoryStatus } from "@/components/armory/armory-status";
import { ManifestStatus } from "@/components/manifest/manifest-status";
import { ExoticPicker } from "@/components/builder/exotic-picker";
import { ExoticClassPerkPicker } from "@/components/builder/exotic-class-perk-picker";
import { FragmentPicker } from "@/components/builder/fragment-picker";
import { ClassEmblemTabs } from "@/components/builder/class-emblem-tabs";
import { SettingRow } from "@/components/builder/setting-row";
import { PowerRangeControls } from "@/components/builder/power-range-controls";
import { useBuilderSearchInputs } from "@/components/builder/use-builder-search-inputs";
import { BuildsSurface } from "@/components/builder/builds-surface";
import type { BuildsColumnContentProps } from "@/components/builder/builds-column-content";
import { SetBonusesSection } from "@/components/builder/set-bonuses-section";
import {
  clearClassBound,
  DEFAULT_TAB,
  tabFromSaved,
  updateTabs,
  useBuilderTabs,
  useTabDerived,
} from "@/components/builder/use-builder-tabs";
import { dreamInputForBuild } from "@/lib/optimizer/dream-input";

import type { OptimizerLoadout } from "@/lib/optimizer/types";
import type { DreamInput } from "@/lib/optimizer/dream";
import { useTheoryBuilds } from "@/components/builder/use-theory-builds";
import {
  DEFAULT_POWER_RANGE,
  forcesDreamersBond,
  includesLegacyArmor,
  loadSelections,
  saveSelections,
  fragSelToArrays,
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
import { useAutoSearch } from "@/lib/optimizer/use-auto-search";
import { useOptimizerWarmup } from "@/lib/optimizer/use-optimizer-warmup";
import { MAX_SET_BONUSES, type BuilderSnapshot, type QueryOrigin } from "@/lib/loadouts/types";
import { togglePinnedSet, usePinnedSets } from "@/lib/settings/pinned-sets";

// The Dream build modal is opened by few sessions; keep it out of the initial bundle.
const DreamBuildDialog = dynamic(
  () => import("@/components/builder/dream-build-dialog").then((m) => m.DreamBuildDialog),
  { ssr: false },
);

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
  /**
   * Actual builds (owned armor) or theoretical ones (the Tier-5 rolls that would reach
   * the targets). Each tab keeps its own targets, major mods, exotic, set bonuses and
   * fragments (useBuilderTabs): Theoretical opens on the defaults, and Builds gets its
   * own back on the way out. Class, the set list filters and the settings Theoretical
   * hides are shared. The controls read and edit the open tab (`tab`); the Builds
   * search, persistence and saved loadouts read `tabs.actual`; useTheoryBuilds reads
   * `tabs.theoretical`.
   */
  const tabs = useBuilderTabs(() => (initialSaved ? tabFromSaved(initialSaved) : DEFAULT_TAB));
  const { mode: buildsMode, tab, update: updateTab, setTabs } = tabs;
  const theoretical = buildsMode === "theoretical";
  // Pins follow the account between computers (synced-settings.ts), not the selections.
  const pinnedSets = usePinnedSets();
  const [setFilters, setSetFilters] = useState<SetFilters>(
    () => initialSaved?.setFilters ?? DEFAULT_SET_FILTERS,
  );
  /**
   * The Dream build modal: which pieces of a build to replace with farmable Tier-5 rolls
   * to reach the stats the user sets. The build outlives `dreamOpen` so the modal can
   * animate closed with its content, and is dropped once it has. `null` until the first
   * open, so the (lazy) modal chunk isn't fetched before then.
   */
  const [dreamOpen, setDreamOpen] = useState(false);
  const [dreamBuild, setDreamBuild] = useState<OptimizerLoadout | null>(null);
  const [useBalancedTuning, setUseBalancedTuning] = useState(
    initialSaved?.balancedTuning ?? true,
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
  // Power matters is a Builds setting: Theoretical ignores it, so its exotic is never
  // displaced by a pinned Dreamer's Bond.
  const classItemPinned = !theoretical && useDreamersBond;

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

  // The legacy raids this class owns armor from, and the raid requirements narrowed to
  // what that armor can make (like ownedSetReqs below; the raw map is what's stored).
  const legacyRaids = useMemo(() => ownedLegacyRaids(classPieces), [classPieces]);
  const ownedRaidReqs = useMemo(
    () => makeableRaidReqs(tabs.actual.raidReqs, legacyRaids),
    [tabs.actual.raidReqs, legacyRaids],
  );
  // Keyed on which raids are required, not how many pieces: a count change leaves the
  // pool (and everything built from it) alone.
  const requiredRaidList = Object.keys(ownedRaidReqs).sort().join(",");
  const requiredRaids = useMemo(
    () =>
      new Set(requiredRaidList ? (requiredRaidList.split(",") as LegacyRaidKey[]) : []),
    [requiredRaidList],
  );

  // Candidate pool for the optimizer: Tier-5 pieces (exactly those with a tuning
  // socket) plus — when enabled — legacy/non-tunable exotics, whose artifice +3 the
  // solver spends, Tier 1–4 Armor 3.0 legendaries, and (only while "Power matters" is
  // on) legacy Armor 2.0 legendaries, plus the armor of any required legacy raid. FotL
  // masks are never in this pool; they join the helmet slot as optional power-0
  // candidates while "Power matters" is on. The power preview below reuses the same
  // options with its own legacy-armor checkbox.
  const poolOptions = useMemo(
    (): PoolOptions => ({
      legacyExotics: useLegacyExotics,
      lowerTierArmor: useLowerTierArmor,
      legacyArmor: useLegacyArmor,
      legacyRaids: requiredRaids,
    }),
    [useLegacyExotics, useLowerTierArmor, useLegacyArmor, requiredRaids],
  );
  const pool = useMemo(
    () => classPieces.filter((p) => inDefaultOptimizerPool(p, poolOptions)),
    [classPieces, poolOptions],
  );

  const sets = useMemo(
    () => (manifest ? availableSets(pool, manifest) : []),
    [pool, manifest],
  );
  const setMap = useMemo(
    () => new Map(sets.map((s) => [s.setHash, s])),
    [sets],
  );
  const setNames = useMemo(
    () => new Map(sets.map((s) => [s.setHash, s.name])),
    [sets],
  );

  // Set requirements narrowed to bonuses the player's pieces for this class can make: a
  // restored (or class-corrected) requirement for a set they no longer own, or one they
  // now own too few pieces of, would make every build infeasible. A 4pc with 2–3 owned
  // pieces becomes the 2pc they can make. This is what the Builds tab searches with and
  // shows; persistence and "Load in builder" keep the raw `setReqs` so turning a pool
  // toggle off can't permanently drop a requirement.
  const ownedSetReqs = useMemo(
    () => makeableSetReqs(tabs.actual.setReqs, setMap),
    [tabs.actual.setReqs, setMap],
  );

  // What persistence and "Load in builder" store: the Builds tab's raw map, capped at what
  // parseBuilderSnapshot accepts. Requirements for sets that left the pool are
  // invisible in the UI, so without the cap they accumulate silently and every
  // later save is rejected with a bare "Invalid loadout". Owned ones take the
  // slots first; orphans fill what's left.
  const persistedSetReqs = useMemo(() => {
    const entries = Object.entries(tabs.actual.setReqs);
    if (entries.length <= MAX_SET_BONUSES) return tabs.actual.setReqs;
    const owned = entries.filter(([h]) => setMap.has(Number(h)));
    const orphans = entries.filter(([h]) => !setMap.has(Number(h)));
    return Object.fromEntries(
      [...owned, ...orphans].slice(0, MAX_SET_BONUSES),
    ) as Record<number, 2 | 4>;
  }, [tabs.actual.setReqs, setMap]);

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
  const { activeSubclass: actualSubclass, fragSel: actualFragSel } = tabs.actual;
  const dimSubclass = useMemo(
    () => ({
      name: actualSubclass,
      itemHash:
        classType !== null
          ? SUBCLASS_ITEM_HASHES[actualSubclass]?.[classType]
          : undefined,
      fragmentHashes: [...actualFragSel[actualSubclass]],
      socketStart: FRAGMENT_SOCKET_START[actualSubclass],
    }),
    [actualSubclass, classType, actualFragSel],
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

  const archetypes = useMemo(() => (manifest ? getArchetypes(manifest) : []), [manifest]);

  const balancedTuningIcon = useMemo(
    () =>
      manifest?.def("DestinyInventoryItemDefinition", BALANCED_TUNING_PLUG_HASH)
        ?.displayProperties?.icon,
    [manifest],
  );

  const toggleFragment = useCallback(
    (hash: number) =>
      updateTab("fragSel", (prev) => {
        const next = new Set(prev[tab.activeSubclass]);
        if (next.has(hash)) next.delete(hash);
        else next.add(hash);
        return { ...prev, [tab.activeSubclass]: next };
      }),
    [tab.activeSubclass, updateTab],
  );

  const {
    applying: applyingFragments,
    apply: applyCurrentFragments,
    canApply: canApplyCurrentFragments,
  } = useApplyCurrentFragments({ armoryQuery, classType, fragments });

  // Lands on the tab the click came from, even if the other one is open by then.
  const onApplyCurrentFragments = useCallback(async () => {
    const target = buildsMode;
    const result = await applyCurrentFragments();
    if (!result) return;
    updateTab("activeSubclass", result.subclass, target);
    updateTab(
      "fragSel",
      (prev) => ({ ...prev, [result.subclass]: result.fragmentHashes }),
      target,
    );
  }, [applyCurrentFragments, buildsMode, updateTab]);

  const setRequirements = useMemo(
    () => [
      ...Object.entries(ownedSetReqs).map(([setHash, count]) => ({
        setHash: Number(setHash),
        count,
      })),
      ...raidSetRequirements(ownedRaidReqs),
    ],
    [ownedSetReqs, ownedRaidReqs],
  );

  // Dedupe by name — the same exotic can exist in multiple versions (Armor 2.0 vs 3.0)
  // with different hashes; the optimizer picks whichever version builds best.
  // Exotic class items are always listed (from the manifest) even when unowned.
  // Ordered by slot (helmet, arms, chest, legs, class item), then name.
  const exotics = useMemo(() => {
    const map = new Map<
      string,
      {
        slot: ArmorSlot;
        hashes: number[];
        icon?: string;
        watermark?: string;
        isTier5?: boolean;
      }
    >();
    for (const p of pool) {
      if (!p.isExotic) continue;
      const entry = map.get(p.name) ?? {
        slot: p.slot,
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
          slot: "classItem" as const,
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
      .sort(
        (a, b) =>
          ARMOR_SLOTS.indexOf(a.slot) - ARMOR_SLOTS.indexOf(b.slot) ||
          a.name.localeCompare(b.name),
      );
  }, [pool, manifest, classType]);

  // Each tab's selections against the live lists. Builds' feed its search; the open
  // tab's (`shown`) feed the controls.
  const actualResolved = useTabDerived(tabs.actual, exotics, fragments, manifest);
  const theoryResolved = useTabDerived(tabs.theoretical, exotics, fragments, manifest);
  const shown = theoretical ? theoryResolved : actualResolved;
  // Spirit pairs of the owned rolls of the selected class item, for the picker's
  // owned counts and its "you don't own this pair" notice.
  const ownedSpiritPairs = useMemo(
    () =>
      classPieces.flatMap((p) =>
        p.itemHash === shown.classItemHash && p.exoticPerkHashes
          ? [{ perks: p.exoticPerkHashes, tiered: p.tunedStat !== undefined }]
          : [],
      ),
    [classPieces, shown.classItemHash],
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
  // Builds only, like everything down to the search: it reads the Builds tab's exotic.
  const {
    exoticIndex: actualExotic,
    exoticOption: actualExoticOption,
    classItemHash: actualClassItemHash,
  } = actualResolved;
  const actualExoticPerks = tabs.actual.exoticPerks;
  const classItemPieces = useMemo(() => {
    if (useDreamersBond) return dreamersPiece ? [dreamersPiece] : [];
    const pieces = pool.filter((p) => p.slot === "classItem");
    if (
      !manifest ||
      classType === null ||
      actualClassItemHash === undefined
    ) {
      return pieces;
    }
    return applySpiritSelectionToClassItems(pieces, manifest, {
      selectedClassItemHash: actualClassItemHash,
      exoticPerks: actualExoticPerks,
      name: actualExoticOption?.name ?? "Exotic class item",
      icon: actualExoticOption?.icon,
      classType,
    });
  }, [
    pool,
    manifest,
    classType,
    actualClassItemHash,
    actualExoticOption,
    actualExoticPerks,
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
    const previewOptions = { ...poolOptions, legacyArmor: powerRange.legacyArmor };
    const previewPool = classPieces.filter((p) => inDefaultOptimizerPool(p, previewOptions));
    let previewClassItems;
    if (powerRange.dreamersBond) {
      previewClassItems = dreamersPiece ? [dreamersPiece] : [];
    } else {
      previewClassItems = previewPool.filter((p) => p.slot === "classItem");
      if (
        manifest &&
        classType !== null &&
        actualClassItemHash !== undefined
      ) {
        previewClassItems = applySpiritSelectionToClassItems(
          previewClassItems,
          manifest,
          {
            selectedClassItemHash: actualClassItemHash,
            exoticPerks: actualExoticPerks,
            name: actualExoticOption?.name ?? "Exotic class item",
            icon: actualExoticOption?.icon,
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
    poolOptions,
    powerRange.enabled,
    powerRange.dreamersBond,
    powerRange.legacyArmor,
    dreamersPiece,
    festivalMaskHelmets,
    manifest,
    classType,
    actualClassItemHash,
    actualExoticOption,
    actualExoticPerks,
  ]);

  // A stored exotic class item loses to a forced Dreamer's Bond on restore. From then on
  // the exotic picker and the power-range handler keep the two exclusive on the Builds
  // tab, so no effect has to referee them. (Theoretical ignores Power matters, so it can
  // hold an exotic class item while Dreamer's Bond is forced.)
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
    updateTab("exoticName", resolveRestoredExotic(name, useDreamersBond), "actual");
  }, [exotics, resolveRestoredExotic, useDreamersBond, updateTab]);

  // "Optimize" in the sidebar replaces the stored selections while this panel may already
  // be mounted: adopt them the way the mount-time restore does, into the Builds tab, and
  // show it. The exotic resolves right away when the class is unchanged and its list is
  // live; otherwise it waits for the list exactly like a fresh restore. A class change
  // also clears what it voids on the theoretical tab (as onClassChange does). The
  // router keeps this view mounted but hidden while the armor table is showing (effects
  // torn down, so the event is missed); the generation check catches up on such a
  // replacement when the view comes back.
  useEffect(() => {
    const adopt = () => {
      adoptedGeneration.current = selectionsGeneration();
      const saved = loadSelections();
      if (!saved) return;
      const classChanged = saved.classType !== classType;
      const resolveNow = !classChanged && exotics.length > 0;
      if (!resolveNow) pendingExoticName.current = saved.exoticName;
      setClassType(saved.classType);
      setTabs((t) => ({
        mode: "actual",
        actual: {
          ...tabFromSaved(saved),
          exoticName: resolveNow
            ? resolveRestoredExotic(saved.exoticName, forcesDreamersBond(saved.powerRange))
            : t.actual.exoticName,
        },
        theoretical: classChanged ? clearClassBound(t.theoretical) : t.theoretical,
      }));
      setSetFilters(saved.setFilters);
      setUseBalancedTuning(saved.balancedTuning);
      setUseLegacyExotics(saved.legacyExotics);
      setUseLowerTierArmor(saved.lowerTierArmor);
      setPowerRange(saved.powerRange);
    };
    if (adoptedGeneration.current !== selectionsGeneration()) adopt();
    window.addEventListener(SELECTIONS_REPLACED_EVENT, adopt);
    return () => window.removeEventListener(SELECTIONS_REPLACED_EVENT, adopt);
  }, [classType, exotics, resolveRestoredExotic, setTabs]);

  // The Builds tab's exotic as persisted: by name, and only while it's in the live list.
  const persistedExoticName = actualExoticOption?.name ?? null;

  // Persist the Builds tab's selections (debounced) on any change; the theoretical tab's
  // live only as long as the panel. Held off while a restored exotic is still unresolved
  // (see pendingExoticName).
  const pendingSave = useRef<{ timer: number; save: () => void } | null>(null);
  useEffect(() => {
    if (pendingExoticName.current !== undefined) return;
    const save = () => {
      pendingSave.current = null;
      saveSelections({
        version: SCHEMA_VERSION,
        classType,
        targets: tabs.actual.targets,
        major: tabs.actual.major,
        setReqs: persistedSetReqs,
        raidReqs: tabs.actual.raidReqs,
        setFilters,
        exoticName: persistedExoticName,
        exoticPerks: actualExoticPerks,
        allowTuning: true,
        balancedTuning: useBalancedTuning,
        legacyExotics: useLegacyExotics,
        lowerTierArmor: useLowerTierArmor,
        powerRange,
        activeSubclass: actualSubclass,
        fragSel: fragSelToArrays(actualFragSel),
      });
    };
    const timer = window.setTimeout(save, 300);
    pendingSave.current = { timer, save };
    return () => window.clearTimeout(timer);
    // `exotics` is a dep for the commit that settles a restored exotic: the resolve
    // effect above consumes pendingExoticName first, and if the stored exotic is gone it
    // writes null over null, which changes nothing else here. Without this the stale name
    // would stay in storage.
  }, [
    classType,
    tabs.actual.targets,
    tabs.actual.major,
    persistedSetReqs,
    tabs.actual.raidReqs,
    setFilters,
    persistedExoticName,
    exotics,
    actualExoticPerks,
    useBalancedTuning,
    useLegacyExotics,
    useLowerTierArmor,
    powerRange,
    actualSubclass,
    actualFragSel,
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

  // What a saved loadout remembers about this session, so "Load in builder" restores it:
  // the Builds tab's selections, whichever tab is open.
  const builderSnapshot = useMemo<BuilderSnapshot>(
    () => ({
      targets: tabs.actual.targets,
      major: tabs.actual.major,
      setReqs: persistedSetReqs,
      raidReqs: tabs.actual.raidReqs,
      exoticName: persistedExoticName,
      exoticPerks: actualExoticPerks,
      allowTuning: true,
      balancedTuning: useBalancedTuning,
      legacyExotics: useLegacyExotics,
      lowerTierArmor: useLowerTierArmor,
      powerRange,
      activeSubclass: actualSubclass,
      fragmentHashes: [...actualFragSel[actualSubclass]],
    }),
    [
      tabs.actual.targets,
      tabs.actual.major,
      persistedSetReqs,
      tabs.actual.raidReqs,
      persistedExoticName,
      actualExoticPerks,
      useBalancedTuning,
      useLegacyExotics,
      useLowerTierArmor,
      powerRange,
      actualSubclass,
      actualFragSel,
    ],
  );

  // The state a shown build's actions (save, DIM export) act on: the query origin the
  // store pairs with the shown result (see ShownResult). Every search hands the store
  // the state it was dispatched from (`origin` in runOptimizer), so the rows always act
  // on the configuration that PRODUCED the list they show — the list deliberately stays
  // on screen while a newer query runs, sits in the debounce, or was cancelled, and the
  // live state would combine a new subclass/targets with an old list's stats. Rows only
  // exist when a result is shown, so a missing pair is a programming error, not a state.
  // Stable getter (rows memoize on it): a slider drag re-renders one StatTargetRow, not
  // fifty BuildRows; rows read it only at click time.
  const getBuilderState = useCallback((): QueryOrigin => {
    const shown = getSnapshot().shown;
    if (!shown) throw new Error("A build acted on with no shown result");
    return shown.origin;
  }, [getSnapshot]);

  // The search settings, the regular search input, and the weapon-mix scan.
  const { searchSettings, optimizerInput, weaponPlan } = useBuilderSearchInputs({
    classType,
    slotPieces,
    targets: tabs.actual.targets,
    major: tabs.actual.major,
    setRequirements,
    useBalancedTuning,
    fragmentBonus: actualResolved.fragmentBonus,
    powerRange,
    selectedExotic: actualExotic,
    exotics,
  });

  const runOptimizer = useCallback(() => {
    if (!optimizerInput) return;
    run(
      optimizerInput,
      // The state this query is dispatched from, bound to its results (see
      // getBuilderState). Snapshot/subclass are deps too: an edit that changes them
      // without changing the optimizer input (a fragment swap with the same stat
      // effect) still re-dispatches, and the store refreshes the bound state in place.
      {
        targets: tabs.actual.targets,
        builderSnapshot,
        setBonuses: ownedSetReqs,
        subclass: dimSubclass,
        classType: classType ?? undefined,
      },
    );
  }, [optimizerInput, tabs.actual.targets, builderSnapshot, ownedSetReqs, dimSubclass, classType, run]);

  const authed = session.data?.authenticated ?? false;
  // Last visit's gear (provisional) drives the controls and lists, but never a search
  // or a build card: builds are computed only from a live profile.
  const provisional = armoryQuery.isProvisional;
  const ready = authed && Boolean(armory) && Boolean(manifest);
  const searchReady = ready && !provisional;

  useOptimizerWarmup();
  // Auto-search (see useAutoSearch): `runOptimizer` is memoized on exactly the build
  // inputs, so its identity changing is the "something changed" signal. Paused on the
  // theoretical tab. Coming back dispatches at once, and the store drops it as a repeat
  // unless a shared setting (class, pools) changed meanwhile: Builds' inputs read only
  // the Builds tab.
  useAutoSearch(searchReady && classType !== null && !theoretical, runOptimizer);

  const theory = useTheoryBuilds({
    active: theoretical,
    searchReady,
    manifest,
    classType,
    pool,
    classPieces,
    archetypes,
    setReqs: tabs.theoretical.setReqs,
    targets: tabs.theoretical.targets,
    major: tabs.theoretical.major,
    fragmentBonus: theoryResolved.fragmentBonus,
    exotic: {
      option: theoryResolved.exoticOption ?? null,
      classItemHash: theoryResolved.classItemHash,
      spiritPerks: theoryResolved.spiritPerks,
      exoticPerks: tabs.theoretical.exoticPerks,
    },
  });
  // What the two tabs show differently in the settings, picked once: Theoretical Builds
  // plans what to farm, so it lists every set (owned or not) and its own slider maxima.
  const settingsView = theoretical
    ? { sets: theory.sets, setMap: theory.setMap, setReqs: tab.setReqs, ceilings: theory.ceilings }
    : { sets, setMap, setReqs: ownedSetReqs, ceilings: ceilingsView };

  // The dream query for one build at the modal's targets (see dreamInputForBuild).
  const makeDreamInput = useCallback(
    (build: OptimizerLoadout, dreamTargets: number[]): DreamInput | null =>
      manifest
        ? dreamInputForBuild({
            pieces: build.pieceIds.map((id) => pieceMap.get(id)),
            targets: dreamTargets,
            settings: searchSettings,
            archetypes,
            manifest,
            classItemPinned: useDreamersBond,
          })
        : null,
    [manifest, pieceMap, searchSettings, archetypes, useDreamersBond],
  );
  const openDream = useCallback((build: OptimizerLoadout) => {
    setDreamBuild(build);
    setDreamOpen(true);
  }, []);
  // Drop the build once the modal has finished closing (it pins its pieces otherwise).
  const onDreamOpenChangeComplete = useCallback((open: boolean) => {
    if (!open) setDreamBuild(null);
  }, []);

  // Wheeling in the empty space under a short builds list scrolls the
  // settings pane instead, and leaves the builds pane still (no bounce).
  // Native non-passive listener: React's onWheel is passive, so it can't
  // preventDefault.
  const settingsScrollRef = useRef<HTMLDivElement>(null);
  const buildsContentRef = useRef<HTMLDivElement>(null);
  const buildsScrollRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const settings = settingsScrollRef.current;
      const content = buildsContentRef.current;
      if (!settings || !content || e.ctrlKey || e.deltaY === 0) return;
      if (e.clientY <= content.getBoundingClientRect().bottom) return;
      e.preventDefault();
      const unit =
        e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? settings.clientHeight : 1;
      settings.scrollBy({ top: e.deltaY * unit });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const setTarget = useCallback(
    (i: number, value: number) =>
      updateTab("targets", (prev) => prev.map((v, idx) => (idx === i ? value : v))),
    [updateTab],
  );
  // Section Reset buttons: always clickable. A section already at its default keeps
  // its state object, so the click is a no-op (no re-render, no new search).
  const resetTargets = useCallback(
    () => updateTab("targets", (prev) => (prev.some((v) => v > 0) ? DEFAULT_TAB.targets : prev)),
    [updateTab],
  );

  // Sets and exotics are per class, so a class switch clears them on both tabs.
  const onClassChange = useCallback(
    (next: number) => {
      setClassType(next);
      setTabs((t) => updateTabs(t, "both", clearClassBound));
    },
    [setTabs],
  );

  const onExoticSelect = useCallback(
    (index: number | null) => {
      updateTab("exoticName", index === null ? null : (exotics[index]?.name ?? null));
      updateTab("exoticPerks", DEFAULT_TAB.exoticPerks);
      // Picking an exotic class item on Builds unchecks Dreamer's Bond, which would pin
      // the slot. Theoretical ignores Power matters (see classItemPinned).
      if (index === null || theoretical) return;
      const hashes = exotics[index]?.hashes ?? [];
      if (hashes.some(isExoticClassItemHash)) {
        setPowerRange((r) => (r.dreamersBond ? { ...r, dreamersBond: false } : r));
      }
    },
    [exotics, theoretical, updateTab],
  );

  // Forcing Dreamer's Bond — by its checkbox, or by turning Power matters on with it
  // already checked — evicts the Builds tab's exotic class item from the pinned slot,
  // whichever tab is open.
  const onPowerRangeChange = useCallback(
    (next: PowerRangeSelection) => {
      setPowerRange(next);
      if (
        forcesDreamersBond(next) &&
        !forcesDreamersBond(powerRange) &&
        actualClassItemHash !== undefined
      ) {
        updateTab("exoticName", null, "actual");
        updateTab("exoticPerks", DEFAULT_TAB.exoticPerks, "actual");
      }
    },
    [powerRange, actualClassItemHash, updateTab],
  );

  const setSetMinOwned = useCallback(
    (minOwned: SetMinOwned) =>
      setSetFilters((prev) =>
        prev.minOwned === minOwned ? prev : { ...prev, minOwned },
      ),
    [],
  );

  const visibleSets = settingsView.setMap;
  const toggleSet = useCallback(
    (setHash: number, count: 2 | 4) => {
      updateTab("setReqs", (prev) => {
        // Toggles act on the requirements as shown (on Builds, the ones the owned pieces
        // make — see ownedSetReqs).
        const shown = theoretical ? prev : makeableSetReqs(prev, visibleSets);
        const next = { ...prev };
        if (shown[setHash] === count) {
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
            keys.find((h) => Number(h) !== setHash && !visibleSets.has(Number(h))) ??
            keys.find((h) => Number(h) !== setHash);
          if (evict !== undefined) delete next[Number(evict)];
        }
        return next;
      });
    },
    [visibleSets, theoretical, updateTab],
  );

  const onMajorChange = useCallback((v: string) => updateTab("major", Number(v)), [updateTab]);
  const onSubclassChange = useCallback(
    (subclass: Subclass) => updateTab("activeSubclass", subclass),
    [updateTab],
  );
  const onExoticPerksChange = useCallback(
    (perks: [number | null, number | null]) => updateTab("exoticPerks", perks),
    [updateTab],
  );

  // How many of a raid's pieces every build must wear; 0 drops the requirement.
  const setRaidCount = useCallback(
    (key: LegacyRaidKey, count: number) =>
      updateTab("raidReqs", (prev) => {
        if ((prev[key] ?? 0) === count) return prev;
        const next = { ...prev };
        if (count > 0) next[key] = count;
        else delete next[key];
        return next;
      }),
    [updateTab],
  );

  const resetSetReqs = useCallback(() => {
    updateTab("setReqs", (prev) =>
      Object.keys(prev).length > 0 ? DEFAULT_TAB.setReqs : prev,
    );
    updateTab("raidReqs", (prev) =>
      Object.keys(prev).length > 0 ? DEFAULT_TAB.raidReqs : prev,
    );
  }, [updateTab]);
  const resetFragments = useCallback(
    () =>
      updateTab("fragSel", (prev) =>
        prev[tab.activeSubclass].size > 0
          ? { ...prev, [tab.activeSubclass]: new Set<number>() }
          : prev,
      ),
    [tab.activeSubclass, updateTab],
  );
  const resetAdvanced = useCallback(() => {
    setUseBalancedTuning(true);
    setUseLegacyExotics(true);
    setUseLowerTierArmor(false);
  }, []);
  const resetPowerRange = useCallback(
    () =>
      setPowerRange((prev) =>
        prev.enabled ||
        prev.bounds !== null ||
        prev.weapons.some((w) => w !== null) ||
        prev.dreamersBond ||
        prev.legacyArmor
          ? DEFAULT_POWER_RANGE
          : prev,
      ),
    [],
  );

  const refetchArmory = armoryQuery.refetch;
  const onEquipped = useCallback(() => {
    void refetchArmory();
  }, [refetchArmory]);

  const buildsProps: BuildsColumnContentProps = useMemo(
    () => ({
      mode: buildsMode,
      onModeChange: tabs.setMode,
      theory,
      ready: searchReady,
      provisional,
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
      onDream: openDream,
    }),
    [
      buildsMode,
      tabs.setMode,
      theory,
      searchReady,
      provisional,
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
      openDream,
    ],
  );

  return (
    <div className="grid h-full min-h-0 w-full flex-1 grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,39.74rem)_5rem_minmax(0,calc((80rem-39.74rem-5rem)*1.15))_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:gap-x-0">
      {/* Settings scroller spans the left leftover + the card column, so
          wheel-scrolling anywhere to the left of the cards still moves this
          pane. Inner max-width keeps the cards on the 39.74rem track. Mins are
          0 so the two columns share a narrow main pane instead of overflowing
          past `lg:overflow-hidden`. */}
      <div
        ref={settingsScrollRef}
        className="d2-scroll flex min-h-0 min-w-0 flex-col lg:col-start-1 lg:col-end-3 lg:overflow-y-auto lg:overscroll-contain lg:pl-6 lg:pr-2"
      >
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

            <Section
              title="Stats"
              trailing={<SectionReset onClick={resetTargets} />}
            >
              <div className="space-y-7">
                {STAT_DISPLAY_ORDER.map((key) => {
                  const i = STAT_ORDER.indexOf(key);
                  return (
                    <StatTargetRow
                      key={key}
                      statKey={key}
                      index={i}
                      icon={statIcons[key]}
                      value={tab.targets[i]}
                      ceilingsView={settingsView.ceilings}
                      onChange={setTarget}
                    />
                  );
                })}
              </div>
            </Section>

            <Section title="Major mods">
              <Tabs value={String(tab.major)} onValueChange={onMajorChange}>
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
                selected={shown.exoticIndex}
                onSelect={onExoticSelect}
              />
              {shown.spiritPerks && !classItemPinned && (
                <ExoticClassPerkPicker
                  left={shown.spiritPerks.left}
                  right={shown.spiritPerks.right}
                  selected={tab.exoticPerks}
                  onChange={onExoticPerksChange}
                  statIcons={statIcons}
                  itemName={shown.exoticOption?.name ?? "this class item"}
                  owned={ownedSpiritPairs}
                  legacyExotics={useLegacyExotics}
                />
              )}
            </Section>

            <Section title="Set bonuses">
              <SetBonusesSection
                sets={settingsView.sets}
                setReqs={settingsView.setReqs}
                onToggleSet={toggleSet}
                onReset={resetSetReqs}
                pinnedSets={pinnedSets}
                onTogglePin={togglePinnedSet}
                setFilters={setFilters}
                onSetMinOwnedChange={setSetMinOwned}
                planning={theoretical}
                legacyRaids={legacyRaids}
                raidReqs={ownedRaidReqs}
                onRaidCountChange={setRaidCount}
                pieces={pool}
                manifest={manifest}
                classType={classType}
                statIcons={statIcons}
              />
            </Section>

            <Section title="Fragments">
              {fragments && (
                <FragmentPicker
                  fragments={fragments}
                  activeSubclass={tab.activeSubclass}
                  onSubclassChange={onSubclassChange}
                  selected={tab.fragSel[tab.activeSubclass]}
                  onToggle={toggleFragment}
                  onReset={resetFragments}
                  statIcons={statIcons}
                  onApplyCurrent={onApplyCurrentFragments}
                  applyDisabled={!canApplyCurrentFragments}
                  applyLoading={applyingFragments}
                />
              )}
            </Section>

            {!theoretical && (
              <>
                <Section
                  title="Advanced settings"
                  trailing={<SectionReset onClick={resetAdvanced} />}
                >
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
                <Section
                  title="Underlight settings"
                  trailing={<SectionReset onClick={resetPowerRange} />}
                >
                  <PowerRangeControls
                    value={powerRange}
                    onChange={onPowerRangeChange}
                    slotPieces={powerSlotPieces}
                    weaponPlan={weaponPlan}
                    dreamersItemName={dreamersClassItemName(classType ?? 2)}
                  />
                </Section>
              </>
            )}
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

      {dreamBuild && (
        <DreamBuildDialog
          open={dreamOpen}
          onOpenChange={setDreamOpen}
          onOpenChangeComplete={onDreamOpenChangeComplete}
          build={dreamBuild}
          makeInput={makeDreamInput}
          pieceMap={pieceMap}
          statIcons={statIcons}
          setNames={setNames}
        />
      )}

      {/* Builds scroller spans the results column + the right leftover. */}
      <div
        className="d2-scroll min-h-0 min-w-0 lg:col-start-4 lg:col-end-6 lg:overflow-y-auto lg:overscroll-contain lg:pr-6 lg:pl-2"
        ref={buildsScrollRef}
      >
        <div
          ref={buildsContentRef}
          className="lg:max-w-[calc((80rem-39.74rem-5rem)*1.15)]"
        >
          <BuildsSurface {...buildsProps} />
        </div>
      </div>
    </div>
  );
}

/** A section header's Reset button, sized like "Save as loadout". */
function SectionReset({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="outline" onClick={onClick}>
      Reset
    </Button>
  );
}

function Section({
  title,
  trailing,
  className,
  children,
}: {
  title?: string;
  /** Right-aligned header slot, e.g. a Reset button. */
  trailing?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "d2-card-frame relative flex flex-col gap-3 rounded-none p-3 transition-[--line-alpha] duration-200 hover:[--line-alpha:1.6] normal:gap-4 normal:p-6 normal:hover:[--line-alpha:1]",
        className,
      )}
    >
      {title ? (
        <SectionHeading trailing={trailing} className="justify-between">
          {title}
        </SectionHeading>
      ) : null}
      {children}
    </section>
  );
}
