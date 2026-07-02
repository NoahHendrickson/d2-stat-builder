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
import { MagnifyingGlass, PushPin } from "@phosphor-icons/react";
import { useSession } from "@/lib/auth/use-session";
import { useArmory } from "@/lib/armory/use-armory";
import { useManifest } from "@/lib/manifest/use-manifest";
import { useOptimizer } from "@/lib/optimizer/use-optimizer";
import { availableSets } from "@/lib/armory/sets";
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
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SignInCard } from "@/components/auth/sign-in-card";
import { PieceInspector } from "@/components/armory/piece-inspector";
import { BuilderStatusCards } from "@/components/builder/builder-status-cards";
import { ExoticPicker } from "@/components/builder/exotic-picker";
import { FragmentPicker } from "@/components/builder/fragment-picker";
import { ClassEmblemTabs } from "@/components/builder/class-emblem-tabs";
import { BuildResults, MAX_SHOWN } from "@/components/builder/build-results";
import type { ExoticConstraint } from "@/lib/optimizer/types";
import {
  loadSelections,
  saveSelections,
  fragSelToArrays,
  fragSelFromArrays,
  resolveExoticIndex,
  SCHEMA_VERSION,
} from "@/lib/builder/selection-storage";
import { getStatModHashes, getTuningPlugHashes } from "@/lib/dim/mod-hashes";
import {
  FRAGMENT_SOCKET_START,
  SUBCLASS_ITEM_HASHES,
} from "@/lib/dim/subclasses";

const MAX_MODS = 5;
/** Clickable preset markers under each stat slider. */
const STAT_TARGET_TICKS = [0, 50, 100, 150, 200] as const;
const STAT_SLIDER_MAX = STAT_TARGET_TICKS[STAT_TARGET_TICKS.length - 1];
/** Skeleton rows shown while a search is in flight. */
const LOADING_ROWS = 5;

/**
 * Smooths the worker's raw progress into a fluid displayed value. A rAF loop eases the
 * displayed fraction toward the reported progress while the run is live (with a slight
 * forward trickle so the bar never sits dead, capped just ahead of the real value), and
 * sweeps it to 100% once the run finishes. `showLoading` stays true through that final
 * sweep, so even instant searches render a brief fluid fill instead of a flash.
 */
function useSmoothedProgress(progress: number, running: boolean, runId: number) {
  const [displayed, setDisplayed] = useState(0);
  const [showLoading, setShowLoading] = useState(false);
  const displayedRef = useRef(0);
  const targetRef = useRef({ progress, running });
  targetRef.current = { progress, running };

  // Each new run (including one superseding an in-flight run) restarts the sweep.
  useEffect(() => {
    if (runId === 0) return;
    displayedRef.current = 0;
    setDisplayed(0);
    setShowLoading(true);
  }, [runId]);

  useEffect(() => {
    if (!showLoading) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      // rAF timestamps can predate the performance.now() that seeded `last` — clamp so
      // a bogus negative dt can't run the easing math backwards.
      const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
      last = now;
      const { progress: p, running: r } = targetRef.current;
      const prev = displayedRef.current;
      let next: number;
      if (r) {
        // Track the worker's progress near-real-time; when it's quiet, trickle forward
        // slowly but never more than a touch ahead of the real value.
        const eased = prev + Math.max(0, p - prev) * (1 - Math.exp(-14 * dt));
        const trickle = Math.min(prev + dt * 0.04, p + 0.06);
        next = Math.min(0.98, Math.max(prev, eased, trickle));
      } else {
        // Run finished — sweep quickly to full, then hand back to the results.
        next = prev + (1 - prev) * (1 - Math.exp(-25 * dt));
        if (next >= 0.995) {
          displayedRef.current = 0;
          setShowLoading(false);
          return;
        }
      }
      displayedRef.current = next;
      setDisplayed(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [showLoading]);

  return { displayedProgress: displayed, showLoading };
}

export function BuilderPanel({
  showInlineStatusCards = true,
}: {
  showInlineStatusCards?: boolean;
}) {
  const session = useSession();
  const armoryQuery = useArmory();
  const manifestStatus = useManifest();
  const { run, cancel, result, ceilings, running, progress, runId } = useOptimizer();
  const { displayedProgress, showLoading } = useSmoothedProgress(
    progress,
    running,
    runId,
  );

  const armory = armoryQuery.data;
  const manifest =
    manifestStatus.state === "ready" ? manifestStatus.manifest : undefined;

  const [classType, setClassType] = useState<number | null>(null);
  const [targets, setTargets] = useState<number[]>(() => [0, 0, 0, 0, 0, 0]);
  const [major, setMajor] = useState(0);
  const [setReqs, setSetReqs] = useState<Record<number, 2 | 4>>({});
  const [pinnedSets, setPinnedSets] = useState<number[]>([]);
  const [setQuery, setSetQuery] = useState("");
  const [selectedExotic, setSelectedExotic] = useState<number | null>(null);
  const [allowTuning, setAllowTuning] = useState(true);
  const [activeSubclass, setActiveSubclass] = useState<Subclass>("Prismatic");
  const [fragSel, setFragSel] = useState<Record<Subclass, Set<number>>>(
    () =>
      Object.fromEntries(
        SUBCLASSES.map((s) => [s, new Set<number>()]),
      ) as Record<Subclass, Set<number>>,
  );
  // Legacy (Armor 2.0 / artifice) support is not built yet — the toggle is disabled.
  const [useLegacyArmor] = useState(false);

  // Persistence guards: `restored` stops the save effect from writing defaults over stored
  // data before the restore runs; `pendingExoticName` hands the restored exotic (persisted by
  // name) to the effect that can resolve it once the live exotics list exists.
  const restored = useRef(false);
  const pendingExoticName = useRef<string | null | undefined>(undefined);

  // Restore last session's selections on mount. Inventory-independent fields apply now; the
  // exotic is stashed for resolution once its list is built. Absent/stale/corrupt → defaults.
  useEffect(() => {
    const saved = loadSelections();
    if (saved) {
      setTargets(saved.targets);
      setMajor(saved.major);
      setSetReqs(saved.setReqs);
      setPinnedSets(saved.pinnedSets);
      setAllowTuning(saved.allowTuning);
      setActiveSubclass(saved.activeSubclass);
      setFragSel(fragSelFromArrays(saved.fragSel));
      if (saved.classType !== null) setClassType(saved.classType);
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

  // Candidate pool for the optimizer. Legacy (non-Tier-5) armor is excluded by default;
  // Tier-5 pieces are exactly those with a tuning socket (tunedStat set).
  const pool = useMemo(
    () =>
      useLegacyArmor
        ? classPieces
        : classPieces.filter((p) => p.tunedStat !== undefined),
    [classPieces, useLegacyArmor],
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
    const shown = q ? sets.filter((s) => s.name.toLowerCase().includes(q)) : sets;
    const pinned = new Set(pinnedSets);
    return {
      pinnedList: shown.filter((s) => pinned.has(s.setHash)),
      unpinnedList: shown.filter((s) => !pinned.has(s.setHash)),
    };
  }, [sets, pinnedSets, setQuery]);

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
    () => (manifest ? availableFragments(manifest) : null),
    [manifest],
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
        exoticName:
          selectedExotic === null ? null : (exotics[selectedExotic]?.name ?? null),
        allowTuning,
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
    selectedExotic,
    exotics,
    allowTuning,
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
    const perk2 = s.perks.find((p) => p.requiredCount === 2)?.name;
    const perk4 = s.perks.find((p) => p.requiredCount === 4)?.name;
    return (
      <div
        key={s.setHash}
        className="group col-span-full grid grid-cols-subgrid items-center"
      >
        <span className="flex min-w-0 items-center gap-1.5 text-xs">
          <button
            type="button"
            onClick={() => togglePin(s.setHash)}
            aria-label={pinned ? "Unpin set" : "Pin set"}
            className={cn(
              "shrink-0 transition-opacity focus-visible:opacity-100",
              pinned
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100",
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
        <button
          type="button"
          disabled={s.ownedCount < 2}
          onClick={() => toggleSet(s.setHash, 2)}
          className={cn(
            "text-muted-foreground min-w-0 truncate text-left text-xs disabled:cursor-not-allowed disabled:opacity-50",
            s.ownedCount >= 2 && "cursor-pointer hover:text-foreground",
          )}
          title={perk2}
        >
          {perk2}
        </button>
        <SetToggle
          active={setReqs[s.setHash] === 4}
          disabled={s.ownedCount < 4}
          onToggle={() => toggleSet(s.setHash, 4)}
        />
        <button
          type="button"
          disabled={s.ownedCount < 4}
          onClick={() => toggleSet(s.setHash, 4)}
          className={cn(
            "text-muted-foreground min-w-0 truncate text-left text-xs disabled:cursor-not-allowed disabled:opacity-50",
            s.ownedCount >= 4 && "cursor-pointer hover:text-foreground",
          )}
          title={perk4}
        >
          {perk4}
        </button>
      </div>
    );
  };

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
                      className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1"
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
                          className="h-7 w-14 px-2 text-right tabular-nums"
                        />
                        {cap !== null && (
                          <>
                            <span
                              className="sr-only"
                            >{`${STAT_LABELS[key]} achievable max: ${cap}`}</span>
                            <span
                              className="text-muted-foreground inline-flex shrink-0 items-baseline text-xs tabular-nums"
                              aria-hidden
                            >
                              /
                              <span className="inline-block w-7 text-right">
                                {cap}
                              </span>
                            </span>
                          </>
                        )}
                      </div>
                      <div className="col-start-2 relative h-3.5">
                        {STAT_TARGET_TICKS.map((t) => {
                          // Once a ceiling is predicted, the top tick reads "max" and
                          // jumps the target to that achievable maximum instead of 200.
                          const tickValue =
                            t === STAT_SLIDER_MAX && cap !== null ? cap : t;
                          const tickLabel =
                            t === STAT_SLIDER_MAX && cap !== null
                              ? "max"
                              : String(t);
                          return (
                            <button
                              key={t}
                              type="button"
                              onClick={() => setTarget(i, tickValue)}
                              aria-label={
                                tickLabel === "max"
                                  ? `Set ${STAT_LABELS[key]} to its max (${tickValue})`
                                  : `Set ${STAT_LABELS[key]} to ${t}`
                              }
                              style={{
                                left: sliderEdgeAlignedLeft(t, 0, STAT_SLIDER_MAX),
                              }}
                              className={cn(
                                "absolute top-0 -translate-x-1/2 text-[10px] tabular-nums transition-colors",
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
              <div className="relative">
                <MagnifyingGlass
                  className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
                  aria-hidden
                />
                <Input
                  type="search"
                  value={setQuery}
                  onChange={(e) => setSetQuery(e.target.value)}
                  placeholder="Find armor sets"
                  aria-label="Find armor sets"
                  className="pl-8"
                />
              </div>
              {sets.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  No set-bonus armor found for this class.
                </p>
              ) : pinnedList.length === 0 && unpinnedList.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  No sets match &ldquo;{setQuery.trim()}&rdquo;.
                </p>
              ) : (
                <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5">
                  <span aria-hidden />
                  <span className="text-muted-foreground col-span-2 text-xs">
                    2pc
                  </span>
                  <span className="text-muted-foreground col-span-2 text-xs">
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
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <span className="text-sm">Use legacy armor</span>
                  <p className="text-muted-foreground text-xs">
                    Coming soon — Armor 2.0 / artifice pieces. Builds currently use
                    Tier-5 armor only.
                  </p>
                </div>
                <Switch
                  checked={useLegacyArmor}
                  disabled
                  aria-label="Use legacy armor (coming soon)"
                />
              </div>
            </Section>
          </>
        )}

        <div className="space-y-4 py-4 opacity-80">
          <SignInCard />
          {showInlineStatusCards && <BuilderStatusCards />}
          <PieceInspector />
        </div>
      </div>

      {/* Right — generated builds */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-medium">Builds</h2>
          <div className="flex items-center gap-3">
            {running && (
              <Button
                variant="link"
                onClick={cancel}
                className="text-muted-foreground hover:text-foreground h-auto p-0 text-xs font-normal"
              >
                Cancel
              </Button>
            )}
            <span
              className="text-muted-foreground text-sm tabular-nums"
              aria-live="polite"
            >
              {!ready
                ? ""
                : showLoading
                  ? "Searching…"
                  : result
                    ? result.loadouts.length === 0
                      ? "No builds match"
                      : `${Math.min(MAX_SHOWN, result.loadouts.length).toLocaleString()} / ${result.combosValid.toLocaleString()}`
                    : ""}
            </span>
          </div>
        </div>
        {!ready ? (
          <p className="text-muted-foreground text-sm">
            Sign in and load your gear to generate builds.
          </p>
        ) : showLoading ? (
          <BuildsLoading progress={displayedProgress} />
        ) : result ? (
          <BuildResults
            result={result}
            pieceMap={pieceMap}
            targets={targets}
            setMap={setMap}
            statIcons={statIcons}
            balancedTuningIcon={balancedTuningIcon}
            characters={armory?.characters ?? []}
            statModHashes={statModHashes}
            tuningPlugHashes={tuningPlugHashes}
            subclass={dimSubclass}
            onEquipped={() => void armoryQuery.refetch()}
          />
        ) : (
          <p className="text-muted-foreground text-sm">
            Pick an exotic, set bonuses, and stat targets — builds update as you go.
          </p>
        )}
      </div>
    </div>
  );
}

/** In-place loading state for the results column: a progress bar over pulsing skeleton rows. */
function BuildsLoading({ progress }: { progress: number }) {
  return (
    <div className="space-y-3">
      <div
        role="progressbar"
        aria-label="Search progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        className="bg-muted h-1 w-full overflow-hidden rounded-full"
      >
        <div
          className="bg-primary h-full rounded-full"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
      <div className="space-y-1.5">
        {Array.from({ length: LOADING_ROWS }, (_, i) => (
          <div
            key={i}
            className="border-border/60 flex animate-pulse items-center gap-3 rounded-lg border p-2.5"
            style={{ animationDelay: `${i * 120}ms` }}
            aria-hidden
          >
            <span className="bg-muted size-7 shrink-0 rounded" />
            <div className="flex flex-1 items-center gap-3">
              {Array.from({ length: 6 }, (_, j) => (
                <span key={j} className="bg-muted h-3.5 w-10 rounded" />
              ))}
            </div>
            <span className="bg-muted h-3.5 w-8 shrink-0 rounded" />
          </div>
        ))}
      </div>
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
