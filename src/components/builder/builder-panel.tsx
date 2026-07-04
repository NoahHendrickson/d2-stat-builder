"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Image from "next/image";
import { MagnifyingGlass, PushPin, SlidersHorizontal } from "@phosphor-icons/react";
import { useSession } from "@/lib/auth/use-session";
import { useArmory } from "@/lib/armory/use-armory";
import { useManifest } from "@/lib/manifest/use-manifest";
import { useOptimizer } from "@/lib/optimizer/use-optimizer";
import { useSmoothedProgress } from "@/lib/use-smoothed-progress";
import { availableSets, type SetPerkInfo } from "@/lib/armory/sets";
import {
  DEFAULT_SET_FILTERS,
  hasCustomSetFilters,
  passesSetFilters,
  type SetFilters,
} from "@/lib/armory/set-filters";
import {
  availableFragments,
  SUBCLASSES,
  type Subclass,
} from "@/lib/armory/fragments";
import {
  ARMOR_SLOTS,
  BALANCED_TUNING_PLUG_HASH,
  CLASS_NAMES,
  STAT_DISPLAY_ORDER,
  STAT_HASHES,
  STAT_LABELS,
  STAT_ORDER,
  offArchetypeIndices,
  type StatIconMap,
} from "@/lib/armory/stats";
import { Slider, sliderEdgeAlignedLeft } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import {
  field3dFocusVisibleClasses,
  field3dSurfaceClasses,
} from "@/lib/field-surface";
import { cn } from "@/lib/utils";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SignInCard } from "@/components/auth/sign-in-card";
import { ArmoryStatus } from "@/components/armory/armory-status";
import { ManifestStatus } from "@/components/manifest/manifest-status";
import { ExoticPicker } from "@/components/builder/exotic-picker";
import { FragmentPicker } from "@/components/builder/fragment-picker";
import { ClassEmblemTabs } from "@/components/builder/class-emblem-tabs";
import { BuildsSurface } from "@/components/builder/builds-surface";
import type { BuildsColumnContentProps } from "@/components/builder/builds-column-content";
import type { ExoticConstraint } from "@/lib/optimizer/types";
import {
  loadSelections,
  saveSelections,
  fragSelToArrays,
  fragSelFromArrays,
  resolveExoticIndex,
  SCHEMA_VERSION,
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

const MAX_MODS = 5;
/** Clickable preset markers under each stat slider. */
const STAT_TARGET_TICKS = [0, 50, 100, 150, 200] as const;
const STAT_SLIDER_MAX = STAT_TARGET_TICKS[STAT_TARGET_TICKS.length - 1];
/** Skeleton rows shown while a search is in flight. */

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
    ceilings,
    ceilingsExact,
    running,
    progress,
    runId,
    refinement,
    applyPending,
  } = useOptimizer();
  const { displayedProgress, showLoading } = useSmoothedProgress(
    progress,
    running,
    runId,
  );

  const armory = armoryQuery.data;
  const manifest =
    manifestStatus.state === "ready" ? manifestStatus.manifest : undefined;

  // One localStorage read on mount — shared by the class initializer and restore effect.
  const initialSaved = useRef(loadSelections());

  const [classType, setClassType] = useState<number | null>(
    () => initialSaved.current?.classType ?? null,
  );
  const [targets, setTargets] = useState<number[]>(() => [0, 0, 0, 0, 0, 0]);
  const [major, setMajor] = useState(0);
  const [setReqs, setSetReqs] = useState<Record<number, 2 | 4>>({});
  const [pinnedSets, setPinnedSets] = useState<number[]>([]);
  const [hoveredSetHash, setHoveredSetHash] = useState<number | null>(null);
  const setRowRefs = useRef(new Map<number, HTMLDivElement>());
  const [setQuery, setSetQuery] = useState("");
  const [setFilters, setSetFilters] = useState<SetFilters>(DEFAULT_SET_FILTERS);
  const [selectedExotic, setSelectedExotic] = useState<number | null>(null);
  const [allowTuning, setAllowTuning] = useState(true);
  const [activeSubclass, setActiveSubclass] = useState<Subclass>("Prismatic");
  const [fragSel, setFragSel] = useState<Record<Subclass, Set<number>>>(
    () =>
      Object.fromEntries(
        SUBCLASSES.map((s) => [s, new Set<number>()]),
      ) as Record<Subclass, Set<number>>,
  );
  // Legacy EXOTICS are supported (the solver spends their artifice +3); legacy
  // legendaries are not yet — that toggle stays disabled.
  const [useLegacyExotics, setUseLegacyExotics] = useState(true);

  // Persistence guards: `restored` stops the save effect from writing defaults over stored
  // data before the restore runs; `pendingExoticName` hands the restored exotic (persisted by
  // name) to the effect that can resolve it once the live exotics list exists.
  const restored = useRef(false);
  const pendingExoticName = useRef<string | null | undefined>(undefined);

  // Restore last session's selections on mount. Inventory-independent fields apply now; the
  // exotic is stashed for resolution once its list is built. Absent/stale/corrupt → defaults.
  // classType is initialized synchronously from initialSaved above.
  useEffect(() => {
    const saved = initialSaved.current;
    if (saved) {
      setTargets(saved.targets);
      setMajor(saved.major);
      setSetReqs(saved.setReqs);
      setPinnedSets(saved.pinnedSets);
      setSetFilters(saved.setFilters);
      setAllowTuning(saved.allowTuning);
      setUseLegacyExotics(saved.legacyExotics);
      setActiveSubclass(saved.activeSubclass);
      setFragSel(fragSelFromArrays(saved.fragSel));
      pendingExoticName.current = saved.exoticName;
    }
    restored.current = true;
  }, []);

  const classes = useMemo(() => {
    if (!armory) return [];
    return [...new Set(armory.characters.map((c) => c.classType))].filter(
      (c) => CLASS_NAMES[c] !== undefined,
    );
  }, [armory]);

  // Default the class to the player's first — and correct a restored class they no longer have.
  useEffect(() => {
    if (!classes.length) return;
    if (classType === null || !classes.includes(classType)) setClassType(classes[0]);
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

  const pieceMap = useMemo(
    () => new Map(classPieces.map((p) => [p.instanceId, p])),
    [classPieces],
  );

  const sets = useMemo(
    () => (manifest ? availableSets(pool, manifest) : []),
    [pool, manifest],
  );
  const setMap = useMemo(() => new Map(sets.map((s) => [s.setHash, s])), [sets]);

  // Pinned sets float to the top; within each group the ownedCount order is kept.
  // Pins for sets outside the current list (e.g. another class) simply don't show.
  // Both groups are narrowed by the search query (case-insensitive substring).
  const { pinnedList, unpinnedList } = useMemo(() => {
    const q = setQuery.trim().toLowerCase();
    const shown = sets.filter((s) => {
      if (q && !s.name.toLowerCase().includes(q)) return false;
      return passesSetFilters(s.ownedCount, setFilters);
    });
    const pinned = new Set(pinnedSets);
    return {
      pinnedList: shown.filter((s) => pinned.has(s.setHash)),
      unpinnedList: shown.filter((s) => !pinned.has(s.setHash)),
    };
  }, [sets, pinnedSets, setQuery, setFilters]);

  const customSetFilters = hasCustomSetFilters(setFilters);

  const visibleSetRows =
    sets.length > 0 && (pinnedList.length > 0 || unpinnedList.length > 0);

  const registerSetRowRef = useCallback(
    (setHash: number, el: HTMLDivElement | null) => {
      if (el) setRowRefs.current.set(setHash, el);
      else setRowRefs.current.delete(setHash);
    },
    [],
  );

  // Reveal the pin when the pointer is vertically aligned with a row, even far to its left
  // (e.g. over the status sidebar or panel padding while moving toward the set list).
  useEffect(() => {
    if (!visibleSetRows) {
      setHoveredSetHash(null);
      return;
    }

    const updateHover = (clientY: number, clientX: number) => {
      for (const [hash, el] of setRowRefs.current) {
        const { top, bottom, right } = el.getBoundingClientRect();
        if (clientY >= top && clientY <= bottom && clientX <= right) {
          setHoveredSetHash((prev) => (prev === hash ? prev : hash));
          return;
        }
      }
      setHoveredSetHash((prev) => (prev === null ? prev : null));
    };

    const onMouseMove = (e: MouseEvent) => updateHover(e.clientY, e.clientX);
    const onMouseLeave = () => setHoveredSetHash(null);

    window.addEventListener("mousemove", onMouseMove);
    document.documentElement.addEventListener("mouseleave", onMouseLeave);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      document.documentElement.removeEventListener("mouseleave", onMouseLeave);
    };
  }, [visibleSetRows]);

  // After a restore (or a class correction), drop set requirements for sets the player no
  // longer owns — an unowned requirement would make every build infeasible.
  useEffect(() => {
    if (!restored.current || !sets.length) return;
    setSetReqs((prev) => {
      const valid = new Set(sets.map((s) => s.setHash));
      const kept = Object.entries(prev).filter(([h]) => valid.has(Number(h)));
      return kept.length === Object.keys(prev).length
        ? prev
        : (Object.fromEntries(kept) as Record<number, 2 | 4>);
    });
  }, [sets]);

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
        out[key] = manifest.def(
          "DestinyStatDefinition",
          STAT_HASHES[key],
        )?.displayProperties?.icon;
      }
    }
    return out;
  }, [manifest]);

  const balancedTuningIcon = useMemo(
    () =>
      manifest?.def(
        "DestinyInventoryItemDefinition",
        BALANCED_TUNING_PLUG_HASH,
      )?.displayProperties?.icon,
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

  const toggleFragment = (hash: number) =>
    setFragSel((prev) => {
      const next = new Set(prev[activeSubclass]);
      if (next.has(hash)) next.delete(hash);
      else next.add(hash);
      return { ...prev, [activeSubclass]: next };
    });

  const setRequirements = useMemo(
    () =>
      Object.entries(setReqs).map(([setHash, count]) => ({
        setHash: Number(setHash),
        count,
      })),
    [setReqs],
  );

  // Dedupe by name — the same exotic can exist in multiple versions (Armor 2.0 vs 3.0)
  // with different hashes; the optimizer picks whichever version builds best.
  const exotics = useMemo(() => {
    const map = new Map<string, { hashes: number[]; icon?: string }>();
    for (const p of pool) {
      if (!p.isExotic) continue;
      const entry = map.get(p.name) ?? { hashes: [], icon: p.icon };
      if (!entry.hashes.includes(p.itemHash)) entry.hashes.push(p.itemHash);
      if (!entry.icon) entry.icon = p.icon;
      map.set(p.name, entry);
    }
    return [...map]
      .map(([name, { hashes, icon }]) => ({ name, hashes, icon }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [pool]);

  // Resolve the restored exotic (persisted by name) to an index once the live list exists.
  // Consumed once so a later class switch can't re-apply it; not-owned-now → cleared.
  useEffect(() => {
    if (pendingExoticName.current === undefined || !exotics.length) return;
    const name = pendingExoticName.current;
    pendingExoticName.current = undefined;
    setSelectedExotic(resolveExoticIndex(name, exotics));
  }, [exotics]);

  // Persist selections (debounced) on any change. The `restored` guard prevents the first
  // render from clobbering stored data before the restore runs; the exotic is saved by name.
  useEffect(() => {
    if (!restored.current) return;
    const t = window.setTimeout(() => {
      saveSelections({
        version: SCHEMA_VERSION,
        classType,
        targets,
        major,
        setReqs,
        pinnedSets,
        setFilters,
        exoticName:
          selectedExotic === null ? null : (exotics[selectedExotic]?.name ?? null),
        allowTuning,
        legacyExotics: useLegacyExotics,
        activeSubclass,
        fragSel: fragSelToArrays(fragSel),
      });
    }, 300);
    return () => window.clearTimeout(t);
  }, [
    classType,
    targets,
    major,
    setReqs,
    pinnedSets,
    setFilters,
    selectedExotic,
    exotics,
    allowTuning,
    useLegacyExotics,
    activeSubclass,
    fragSel,
  ]);

  const runOptimizer = useCallback(() => {
    if (classType === null) return;
    const slots = ARMOR_SLOTS.map((slot) =>
      pool
        .filter((p) => p.slot === slot)
        .map((p) => ({
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
        })),
    );
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
      fragmentBonus,
      maxResults: 200,
    });
  }, [
    pool,
    classType,
    targets,
    major,
    setRequirements,
    selectedExotic,
    exotics,
    allowTuning,
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

  const setTarget = (i: number, value: number) =>
    setTargets((prev) => prev.map((v, idx) => (idx === i ? value : v)));

  const onClassChange = (next: number) => {
    setClassType(next);
    setSetReqs({});
    setSelectedExotic(null);
  };

  const setSetFilter = (key: keyof SetFilters, value: boolean) =>
    setSetFilters((prev) => ({ ...prev, [key]: value }));

  const toggleSet = (setHash: number, count: 2 | 4) =>
    setSetReqs((prev) => {
      const next = { ...prev };
      if (next[setHash] === count) delete next[setHash];
      else next[setHash] = count;
      return next;
    });

  const togglePin = (setHash: number) =>
    setPinnedSets((prev) =>
      prev.includes(setHash)
        ? prev.filter((h) => h !== setHash)
        : [...prev, setHash],
    );

  const renderSetRow = (s: (typeof sets)[number]) => {
    const pinned = pinnedSets.includes(s.setHash);
    const pinVisible = pinned || hoveredSetHash === s.setHash;
    const perk2Info = s.perks.find((p) => p.requiredCount === 2);
    const perk4Info = s.perks.find((p) => p.requiredCount === 4);
    return (
      <div
        key={s.setHash}
        ref={(el) => registerSetRowRef(s.setHash, el)}
        className="col-span-full grid grid-cols-subgrid items-center"
      >
        <span className="flex min-w-0 items-center gap-1.5 text-sm">
          <button
            type="button"
            onClick={() => togglePin(s.setHash)}
            aria-label={pinned ? "Unpin set" : "Pin set"}
            className={cn(
              "shrink-0 transition-opacity focus-visible:opacity-100",
              pinned
                ? "text-foreground"
                : cn(
                    "text-muted-foreground hover:text-foreground",
                    pinVisible ? "opacity-100" : "opacity-0",
                  ),
            )}
          >
            <PushPin
              weight={pinned ? "fill" : "duotone"}
              className="size-3.5"
              aria-hidden
            />
          </button>
          <span className="truncate">
            {s.name}{" "}
            <span className="text-muted-foreground">({s.ownedCount})</span>
          </span>
        </span>
        <SetToggle
          active={setReqs[s.setHash] === 2}
          disabled={s.ownedCount < 2}
          onToggle={() => toggleSet(s.setHash, 2)}
        />
        <SetPerkLabel
          perk={perk2Info}
          disabled={s.ownedCount < 2}
          onClick={() => toggleSet(s.setHash, 2)}
        />
        <SetToggle
          active={setReqs[s.setHash] === 4}
          disabled={s.ownedCount < 4}
          onToggle={() => toggleSet(s.setHash, 4)}
        />
        <SetPerkLabel
          perk={perk4Info}
          disabled={s.ownedCount < 4}
          onClick={() => toggleSet(s.setHash, 4)}
        />
      </div>
    );
  };

  const buildsProps: BuildsColumnContentProps = useMemo(
    () => ({
      ready,
      showLoading,
      running,
      result,
      displayedProgress,
      refinement,
      onShowPending: applyPending,
      onCancel: cancel,
      pieceMap,
      targets,
      setMap,
      statIcons,
      balancedTuningIcon,
      characters: armory?.characters ?? [],
      statModHashes,
      tuningPlugHashes,
      artificeModHashes,
      subclass: dimSubclass,
      onEquipped: () => void armoryQuery.refetch(),
    }),
    [
      ready,
      showLoading,
      running,
      result,
      displayedProgress,
      refinement,
      applyPending,
      cancel,
      pieceMap,
      targets,
      setMap,
      statIcons,
      balancedTuningIcon,
      armory?.characters,
      statModHashes,
      tuningPlugHashes,
      artificeModHashes,
      dimSubclass,
      armoryQuery,
    ],
  );

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 lg:items-start lg:gap-12">
      {/* Left — configure the build */}
      <div className="divide-border/60 divide-y">
        {ready && (
          <>
            {classes.length > 1 && classType !== null && (
              <div className="pb-4">
                <ClassEmblemTabs
                  characters={armory?.characters ?? []}
                  value={classType}
                  onChange={onClassChange}
                />
              </div>
            )}

            <Section>
              <div className="space-y-3">
                {STAT_DISPLAY_ORDER.map((key) => {
                  const i = STAT_ORDER.indexOf(key);
                  const icon = statIcons[key];
                  // Achievable ceiling for this stat given the others. Overlay it as a
                  // lighter fill up to that max (full-width at 200); omit only while
                  // unknown (before the first search).
                  const cap = ceilings ? ceilings[i] : null;
                  const ceilingValue = cap ?? undefined;
                  return (
                    <div
                      key={key}
                      className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 max-lg:gap-x-2"
                    >
                      {icon ? (
                        <Image
                          src={`${BUNGIE_IMAGE_BASE}${icon}`}
                          alt={STAT_LABELS[key]}
                          title={STAT_LABELS[key]}
                          width={24}
                          height={24}
                          className="size-6 shrink-0 invert dark:invert-0"
                          unoptimized
                        />
                      ) : (
                        <span className="size-6 shrink-0" aria-hidden />
                      )}
                      <Slider
                        min={0}
                        max={STAT_SLIDER_MAX}
                        step={1}
                        value={[targets[i]]}
                        onValueChange={(v) => setTarget(i, Array.isArray(v) ? v[0] : v)}
                        ceiling={ceilingValue}
                        aria-label={`${STAT_LABELS[key]} target`}
                        className="cursor-pointer py-1.5"
                      />
                      <div className="flex shrink-0 items-center gap-1">
                        <Input
                          type="number"
                          min={0}
                          max={STAT_SLIDER_MAX}
                          step={1}
                          value={targets[i]}
                          aria-label={`${STAT_LABELS[key]} target value`}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => {
                            const n = Math.round(Number(e.target.value));
                            setTarget(
                              i,
                              Number.isFinite(n)
                                ? Math.max(0, Math.min(STAT_SLIDER_MAX, n))
                                : 0,
                            );
                          }}
                          className="w-12 tabular-nums"
                          style={{ textAlign: "center" }}
                        />
                        {cap !== null && (
                          <>
                            <span className="sr-only">
                              {ceilingsExact
                                ? `${STAT_LABELS[key]} achievable max: ${cap}`
                                : `${STAT_LABELS[key]} achievable: at least ${cap}`}
                            </span>
                            <span
                              className="text-muted-foreground inline-flex shrink-0 items-baseline text-xs tabular-nums"
                              aria-hidden
                            >
                              {/* "≥" while the ceiling is an unproven lower bound (still
                                  refining, or the refinement budget expired) — only a
                                  proven-exact ceiling may read as a hard "/ max". */}
                              {ceilingsExact ? "/" : "≥"}
                              <span className="inline-block w-7 text-right">
                                {cap}
                              </span>
                            </span>
                          </>
                        )}
                      </div>
                      <div className="col-start-2 relative h-5">
                        {STAT_TARGET_TICKS.map((t) => {
                          // Once a ceiling is known, the top tick jumps the target to
                          // that achievable value instead of 200. It reads "max" only
                          // when the ceiling is proven exact; an unproven bound reads
                          // "81+" (achievable, but possibly more out there).
                          const tickValue =
                            t === STAT_SLIDER_MAX && cap !== null ? cap : t;
                          const tickLabel =
                            t === STAT_SLIDER_MAX && cap !== null
                              ? ceilingsExact
                                ? "max"
                                : `${cap}+`
                              : String(t);
                          return (
                            <button
                              key={t}
                              type="button"
                              onClick={() => setTarget(i, tickValue)}
                              aria-label={
                                t === STAT_SLIDER_MAX && cap !== null
                                  ? ceilingsExact
                                    ? `Set ${STAT_LABELS[key]} to its max (${tickValue})`
                                    : `Set ${STAT_LABELS[key]} to its highest proven value (${tickValue})`
                                  : `Set ${STAT_LABELS[key]} to ${t}`
                              }
                              style={{
                                left: sliderEdgeAlignedLeft(t, 0, STAT_SLIDER_MAX),
                              }}
                              className={cn(
                                "absolute top-0 -translate-x-1/2 cursor-pointer text-[10px] tabular-nums transition-colors after:absolute after:-inset-x-2 after:-inset-y-1.5 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-hidden",
                                targets[i] === tickValue
                                  ? "text-foreground"
                                  : "text-muted-foreground hover:text-foreground",
                              )}
                            >
                              {tickLabel}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="border-border/60 space-y-2 border-t pt-3">
                <h3 className="text-sm font-medium">Major Mods</h3>
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
              </div>
            </Section>

            <Section>
              <ExoticPicker
                options={exotics}
                selected={selectedExotic}
                onSelect={setSelectedExotic}
              />
            </Section>

            <Section>
              <div className="flex items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <MagnifyingGlass
                    className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 z-10 size-3.5 -translate-y-1/2"
                    aria-hidden
                  />
                  <Input
                    type="search"
                    value={setQuery}
                    onChange={(e) => setSetQuery(e.target.value)}
                    placeholder="Find armor sets"
                    aria-label="Find armor sets"
                    className="pl-6"
                  />
                </div>
                <div className="shrink-0">
                  <Popover>
                    <PopoverTrigger
                      aria-label="Armor set list settings"
                      className={cn(
                        "inline-flex size-8 shrink-0 items-center justify-center rounded-[6px] border border-transparent text-muted-foreground transition-colors hover:text-foreground",
                        field3dSurfaceClasses,
                        field3dFocusVisibleClasses,
                      )}
                    >
                      <SlidersHorizontal className="size-4" aria-hidden />
                    </PopoverTrigger>
                    <PopoverContent align="end" className="space-y-0.5">
                      <SetListSettingRow
                        checked={setFilters.hideZero}
                        onCheckedChange={(checked) =>
                          setSetFilter("hideZero", checked)
                        }
                      >
                        Hide sets I have 0 pieces for
                      </SetListSettingRow>
                      <SetListSettingRow
                        checked={setFilters.hideLessThan2}
                        onCheckedChange={(checked) =>
                          setSetFilter("hideLessThan2", checked)
                        }
                      >
                        Hide sets I have less than 2 pieces for
                      </SetListSettingRow>
                    </PopoverContent>
                  </Popover>
                </div>
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
                <div className="max-lg:overflow-x-auto">
                <div className="grid grid-cols-[minmax(0,1.4fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 max-lg:min-w-[36rem]">
                  <span aria-hidden />
                  <span className="text-muted-foreground col-span-2 text-sm">
                    2pc
                  </span>
                  <span className="text-muted-foreground col-span-2 text-sm">
                    4pc
                  </span>
                  {pinnedList.map(renderSetRow)}
                  {pinnedList.length > 0 && unpinnedList.length > 0 && (
                    <div
                      className="border-border/60 col-span-full my-0.5 border-t"
                      aria-hidden
                    />
                  )}
                  {unpinnedList.map(renderSetRow)}
                </div>
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
                />
              )}
            </Section>

            <Section title="Tier-5 tuning">
              <div className="flex items-center justify-between gap-4">
                <p className="text-muted-foreground text-xs">
                  Auto-apply Balanced (+1 to off-stats) or a directional (+5/−5)
                  tune on tunable pieces to hit your targets.
                </p>
                <Switch
                  checked={allowTuning}
                  onCheckedChange={setAllowTuning}
                  aria-label="Toggle Tier-5 tuning"
                />
              </div>
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

        <div className="space-y-4 py-4 opacity-80">
          <SignInCard />
          {showInlineStatusCards && <ArmoryStatus />}
          <ManifestStatus />
        </div>
      </div>

      <BuildsSurface {...buildsProps} />
    </div>
  );
}

function SetListSettingRow({
  checked,
  onCheckedChange,
  children,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  const label = typeof children === "string" ? children : undefined;
  return (
    <div className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5">
      <span className="text-sm leading-snug">{children}</span>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-label={label}
      />
    </div>
  );
}

function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 py-4">
      {title ? <h3 className="text-sm font-medium">{title}</h3> : null}
      {children}
    </section>
  );
}

function perkTooltipContent(perk: SetPerkInfo | undefined): string | null {
  if (!perk) return null;
  return perk.description?.trim() || perk.name;
}

function SetPerkLabel({
  perk,
  disabled,
  onClick,
}: {
  perk: SetPerkInfo | undefined;
  disabled: boolean;
  onClick: () => void;
}) {
  const tooltipContent = perkTooltipContent(perk);
  const button = (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={perk?.name}
      className={cn(
        "text-muted-foreground min-w-0 max-w-full truncate text-left text-sm disabled:cursor-not-allowed disabled:opacity-50",
        !disabled && "cursor-pointer hover:text-foreground",
      )}
    >
      {perk?.name}
    </button>
  );

  if (!tooltipContent) return button;

  return (
    <Tooltip>
      <TooltipTrigger
        render={<span className="w-fit max-w-full min-w-0" />}
      >
        {button}
      </TooltipTrigger>
      <TooltipContent side="top" align="start">
        {tooltipContent}
      </TooltipContent>
    </Tooltip>
  );
}

function SetToggle({
  active,
  disabled,
  onToggle,
}: {
  active: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <Checkbox
      size="lg"
      checked={active}
      disabled={disabled}
      onCheckedChange={onToggle}
      aria-label="Toggle set bonus"
      className={cn("justify-self-center", !disabled && "cursor-pointer")}
    />
  );
}
