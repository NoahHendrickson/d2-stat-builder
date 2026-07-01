"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Image from "next/image";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { useSession } from "@/lib/auth/use-session";
import { useArmory } from "@/lib/armory/use-armory";
import { useManifest } from "@/lib/manifest/use-manifest";
import { useOptimizer } from "@/lib/optimizer/use-optimizer";
import type { ArmorPiece } from "@/lib/armory/normalize";
import { availableSets, type ArmorSetInfo } from "@/lib/armory/sets";
import {
  availableFragments,
  SUBCLASSES,
  type Subclass,
} from "@/lib/armory/fragments";
import {
  ARMOR_SLOTS,
  CLASS_NAMES,
  STAT_HASHES,
  STAT_LABELS,
  STAT_ORDER,
  offArchetypeIndices,
  type StatKey,
} from "@/lib/armory/stats";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import { Toggle } from "@/components/ui/toggle";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SignInCard } from "@/components/auth/sign-in-card";
import { ManifestStatus } from "@/components/manifest/manifest-status";
import { ArmoryStatus } from "@/components/armory/armory-status";
import { PieceInspector } from "@/components/armory/piece-inspector";
import { ExoticPicker } from "@/components/builder/exotic-picker";
import { FragmentPicker } from "@/components/builder/fragment-picker";
import { ClassEmblemTabs } from "@/components/builder/class-emblem-tabs";
import type {
  AppliedTuning,
  ExoticConstraint,
  OptimizerLoadout,
} from "@/lib/optimizer/types";
import {
  loadSelections,
  saveSelections,
  fragSelToArrays,
  fragSelFromArrays,
  resolveExoticIndex,
  SCHEMA_VERSION,
} from "@/lib/builder/selection-storage";

const MAX_SHOWN = 25;
const MAX_MODS = 5;
/** Clickable preset markers under each stat slider. */
const STAT_TARGET_TICKS = [0, 50, 100, 150, 200] as const;
/** Stat rows top-to-bottom (icon-only); each maps back to its STAT_ORDER index. */
const STAT_DISPLAY_ORDER = [
  "health",
  "melee",
  "grenade",
  "super",
  "class",
  "weapons",
] as const;
/** Display stat columns paired with their STAT_ORDER index (used by the build breakdown). */
const STAT_COLS = STAT_DISPLAY_ORDER.map((key) => ({
  key,
  i: STAT_ORDER.indexOf(key),
}));

export function BuilderPanel() {
  const session = useSession();
  const armoryQuery = useArmory();
  const manifestStatus = useManifest();
  const { run, cancel, result, ceilings, running } = useOptimizer();

  const armory = armoryQuery.data;
  const manifest =
    manifestStatus.state === "ready" ? manifestStatus.manifest : undefined;

  const [classType, setClassType] = useState<number | null>(null);
  const [targets, setTargets] = useState<number[]>(() => [0, 0, 0, 0, 0, 0]);
  const [major, setMajor] = useState(0);
  const [setReqs, setSetReqs] = useState<Record<number, 2 | 4>>({});
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

  const statIcons = useMemo(() => {
    const out = {} as Record<StatKey, string | undefined>;
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

  const fragmentBonus = useMemo(() => {
    const v = [0, 0, 0, 0, 0, 0];
    if (!fragments) return v;
    const list = fragments[activeSubclass];
    for (const hash of fragSel[activeSubclass]) {
      const f = list.find((x) => x.hash === hash);
      if (f) for (let i = 0; i < 6; i++) v[i] += f.stats[i];
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

  const ready =
    Boolean(session.data?.authenticated) && Boolean(armory) && Boolean(manifest);

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

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
      {/* Left — configure the build */}
      <div className="space-y-4">
        {ready && (
          <>
            {classes.length > 1 && classType !== null && (
              <Section title="Class">
                <ClassEmblemTabs
                  characters={armory?.characters ?? []}
                  value={classType}
                  onChange={onClassChange}
                />
              </Section>
            )}

            <Section title="Stat targets">
              <div className="space-y-3">
                {STAT_DISPLAY_ORDER.map((key) => {
                  const i = STAT_ORDER.indexOf(key);
                  const icon = statIcons[key];
                  // Achievable ceiling for this stat given the others. Overlay it as a
                  // lighter fill up to that max; omit once it's the full range (200) or
                  // unknown (before the first search).
                  const cap = ceilings ? ceilings[i] : null;
                  const ceilingValue = cap !== null && cap < 200 ? cap : undefined;
                  return (
                    <div key={key} className="flex items-center gap-3">
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
                      <div className="min-w-0 flex-1 space-y-1">
                        <Slider
                          min={0}
                          max={200}
                          step={1}
                          value={[targets[i]]}
                          onValueChange={(v) => setTarget(i, Array.isArray(v) ? v[0] : v)}
                          ceiling={ceilingValue}
                          aria-label={`${STAT_LABELS[key]} target`}
                          className="cursor-pointer py-1.5"
                        />
                        <div className="flex justify-between px-0.5">
                          {STAT_TARGET_TICKS.map((t) => {
                            // Once a ceiling is predicted, the top tick reads "max" and
                            // jumps the target to that achievable maximum instead of 200.
                            const tickValue =
                              t === 200 && cap !== null ? cap : t;
                            const tickLabel =
                              t === 200 && cap !== null ? "max" : String(t);
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
                                className={cn(
                                  "text-[10px] tabular-nums transition-colors",
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
                      <Input
                        type="number"
                        min={0}
                        max={200}
                        step={1}
                        value={targets[i]}
                        aria-label={`${STAT_LABELS[key]} target value`}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => {
                          const n = Math.round(Number(e.target.value));
                          setTarget(
                            i,
                            Number.isFinite(n)
                              ? Math.max(0, Math.min(200, n))
                              : 0,
                          );
                        }}
                        className="h-7 w-14 shrink-0 px-2 text-right tabular-nums"
                      />
                    </div>
                  );
                })}
              </div>
            </Section>

            <Section title="Mod budget">
              <Tabs
                value={String(major)}
                onValueChange={(v) => setMajor(Number(v))}
              >
                <TabsList className="w-full">
                  {[0, 1, 2, 3, 4, 5].map((n) => (
                    <TabsTrigger key={n} value={String(n)}>
                      {n}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
              <p className="text-muted-foreground text-xs">
                {major} major (+10) · {MAX_MODS - major} minor (+5). Auto-assigned
                as needed to hit your targets.
              </p>
            </Section>

            <Section title="Exotic">
              <ExoticPicker
                options={exotics}
                selected={selectedExotic}
                onSelect={setSelectedExotic}
              />
            </Section>

            <Section title="Set bonuses">
              {sets.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  No set-bonus armor found for this class.
                </p>
              ) : (
                <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 gap-y-1.5">
                  <span className="text-muted-foreground text-xs">Set</span>
                  <span className="text-muted-foreground w-7 text-center text-xs">
                    2pc
                  </span>
                  <span className="text-muted-foreground w-7 text-center text-xs">
                    4pc
                  </span>
                  {sets.map((s) => (
                    <Fragment key={s.setHash}>
                      <span className="truncate text-xs">
                        {s.name}{" "}
                        <span className="text-muted-foreground">
                          ({s.ownedCount})
                        </span>
                      </span>
                      <SetToggle
                        active={setReqs[s.setHash] === 2}
                        disabled={s.ownedCount < 2}
                        onToggle={() => toggleSet(s.setHash, 2)}
                      />
                      <SetToggle
                        active={setReqs[s.setHash] === 4}
                        disabled={s.ownedCount < 4}
                        onToggle={() => toggleSet(s.setHash, 4)}
                      />
                    </Fragment>
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
                />
              )}
            </Section>

            <Section title="Tier-5 tuning">
              <div className="flex items-center justify-between gap-4">
                <p className="text-muted-foreground text-xs">
                  Auto-apply Balanced (+1 to off-stats) or a directional (+5/−5)
                  tune on tunable pieces to hit your targets.
                </p>
                <Toggle
                  variant="outline"
                  size="sm"
                  pressed={allowTuning}
                  onPressedChange={setAllowTuning}
                  aria-label="Toggle Tier-5 tuning"
                  className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                >
                  {allowTuning ? "On" : "Off"}
                </Toggle>
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
                <Toggle
                  variant="outline"
                  size="sm"
                  pressed={useLegacyArmor}
                  disabled
                  aria-label="Use legacy armor (coming soon)"
                  className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                >
                  {useLegacyArmor ? "On" : "Off"}
                </Toggle>
              </div>
            </Section>
          </>
        )}

        {/* Status + sign-in. Lives here for now; slated to be hidden later. */}
        <div className="space-y-4 pt-2 opacity-80">
          <SignInCard />
          <ManifestStatus />
          <ArmoryStatus />
          <PieceInspector />
        </div>
      </div>

      {/* Right — generated builds */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-medium">Builds</h2>
          <div className="flex items-center gap-3">
            {running && (
              <button
                type="button"
                onClick={cancel}
                className="text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline"
              >
                Cancel
              </button>
            )}
            <span
              className="text-muted-foreground text-sm tabular-nums"
              aria-live="polite"
            >
              {!ready
                ? ""
                : running
                  ? "Searching…"
                  : result
                    ? result.loadouts.length === 0
                      ? "No builds match"
                      : `${result.combosValid.toLocaleString()} builds`
                    : ""}
            </span>
          </div>
        </div>
        {!ready ? (
          <p className="text-muted-foreground text-sm">
            Sign in and load your gear to generate builds.
          </p>
        ) : result ? (
          <Results
            result={result}
            pieceMap={pieceMap}
            targets={targets}
            setMap={setMap}
            statIcons={statIcons}
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-border/60 bg-card space-y-3 rounded-xl border p-4">
      <h3 className="text-sm font-medium">{title}</h3>
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
    <Toggle
      variant="outline"
      size="sm"
      pressed={active}
      disabled={disabled}
      onPressedChange={onToggle}
      aria-label="Toggle set bonus"
      className="size-7 min-w-7 justify-self-center p-0 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
    >
      {active && <CheckIcon className="size-3.5" />}
    </Toggle>
  );
}

/**
 * The Tuned-column cell for one piece: the tuned stat's icon for a directional tune
 * (the +5 is implied by the icon), "Balanced" for a balanced tune, and nothing when the
 * piece was left untuned.
 */
function TunedCell({
  tune,
  statIcons,
}: {
  tune: AppliedTuning | null;
  statIcons: Record<StatKey, string | undefined>;
}) {
  if (!tune) return null;
  if (tune.kind === "balanced")
    return <span className="text-sky-400/70">Balanced</span>;
  const key = STAT_ORDER[tune.plus];
  return (
    <StatGlyph src={statIcons[key]} label={`Tuned +5 ${STAT_LABELS[key]}`} />
  );
}

function StatGlyph({
  src,
  label,
  className,
}: {
  src?: string;
  label: string;
  className?: string;
}) {
  if (!src)
    return (
      <span
        className={cn("inline-block size-4 shrink-0", className)}
        aria-hidden
      />
    );
  return (
    <Image
      src={`${BUNGIE_IMAGE_BASE}${src}`}
      alt={label}
      title={label}
      width={16}
      height={16}
      className={cn("inline-block size-4 shrink-0 invert dark:invert-0", className)}
      unoptimized
    />
  );
}

const BREAKDOWN_COLS =
  "minmax(0,1fr) repeat(6, minmax(1.75rem, 1fr)) minmax(2.75rem, auto)";

/** One aligned row of the breakdown grid: a label cell, the six stat cells, and a trailing (empty) Tuned cell. */
function BreakdownRow({
  label,
  labelClass,
  render,
}: {
  label: string;
  labelClass?: string;
  render: (i: number) => ReactNode;
}) {
  return (
    <>
      <div className={cn("text-muted-foreground truncate", labelClass)}>
        {label}
      </div>
      {STAT_COLS.map(({ key, i }) => (
        <div key={key} className="text-center tabular-nums">
          {render(i)}
        </div>
      ))}
      <div />
    </>
  );
}

/** A single build: a collapsed stat header that expands to a per-piece breakdown. */
function BuildRow({
  loadout,
  pieceMap,
  setMap,
  statIcons,
  targets,
}: {
  loadout: OptimizerLoadout;
  pieceMap: Map<string, ArmorPiece>;
  setMap: Map<number, ArmorSetInfo>;
  statIcons: Record<StatKey, string | undefined>;
  targets: number[];
}) {
  const [open, setOpen] = useState(false);
  const pieces = loadout.pieceIds.map((id) => pieceMap.get(id));
  const exotic = pieces.find((p) => p?.isExotic);

  const setCounts = new Map<number, number>();
  for (const p of pieces) {
    if (p?.setHash) setCounts.set(p.setHash, (setCounts.get(p.setHash) ?? 0) + 1);
  }
  const setBadges: { name: string; count: number }[] = [];
  for (const [hash, cnt] of setCounts) {
    if (cnt < 2) continue;
    const info = setMap.get(hash);
    if (info) setBadges.push({ name: info.name, count: cnt });
  }

  return (
    <div className="border-border/60 overflow-hidden rounded-lg border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="hover:bg-muted/40 flex w-full items-center gap-3 p-2.5 text-left transition-colors"
      >
        {exotic?.icon ? (
          <Image
            src={`${BUNGIE_IMAGE_BASE}${exotic.icon}`}
            alt={exotic.name}
            width={28}
            height={28}
            className="size-7 shrink-0 rounded"
            unoptimized
          />
        ) : (
          <span className="bg-muted size-7 shrink-0 rounded" aria-hidden />
        )}
        <div className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {STAT_COLS.map(({ key, i }) => {
            const met = targets[i] > 0 && loadout.stats[i] >= targets[i];
            return (
              <span key={key} className="flex items-center gap-1 tabular-nums">
                <span className={met ? "text-emerald-500" : "text-foreground"}>
                  {loadout.stats[i]}
                </span>
                <StatGlyph src={statIcons[key]} label={STAT_LABELS[key]} />
              </span>
            );
          })}
        </div>
        <span className="text-muted-foreground shrink-0 text-sm tabular-nums">
          {loadout.total}
        </span>
        {setBadges.map((b) => (
          <Badge
            key={b.name}
            variant="secondary"
            className="shrink-0 px-1.5 py-0 text-[10px]"
            title={b.name}
          >
            {b.count}pc
          </Badge>
        ))}
        <ChevronDownIcon
          className={cn(
            "text-muted-foreground size-4 shrink-0 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div
          className="border-border/60 grid items-center gap-x-1 gap-y-1 border-t px-2.5 py-2 text-xs"
          style={{ gridTemplateColumns: BREAKDOWN_COLS }}
        >
          <div />
          {STAT_COLS.map(({ key }) => (
            <div key={key} className="flex justify-center pb-0.5">
              <StatGlyph src={statIcons[key]} label={STAT_LABELS[key]} />
            </div>
          ))}
          <div className="text-muted-foreground pb-0.5 text-center text-[10px] leading-4">
            Tuned
          </div>

          {loadout.pieceIds.map((id, pi) => {
            const piece = pieceMap.get(id);
            if (!piece) return null;
            return (
              <Fragment key={id}>
                <div className="flex min-w-0 items-center gap-1.5">
                  {piece.icon ? (
                    <Image
                      src={`${BUNGIE_IMAGE_BASE}${piece.icon}`}
                      alt=""
                      width={20}
                      height={20}
                      className="size-5 shrink-0 rounded-sm"
                      unoptimized
                    />
                  ) : (
                    <span
                      className="bg-muted size-5 shrink-0 rounded-sm"
                      aria-hidden
                    />
                  )}
                  <span className="truncate">{piece.name}</span>
                </div>
                {STAT_COLS.map(({ key, i }) => (
                  <div
                    key={key}
                    className="text-muted-foreground text-center tabular-nums"
                  >
                    {piece.stats[i] || ""}
                  </div>
                ))}
                <div className="flex justify-center">
                  <TunedCell tune={loadout.tuning[pi]} statIcons={statIcons} />
                </div>
              </Fragment>
            );
          })}

          <div className="border-border/60 col-span-full my-0.5 border-t" />

          <BreakdownRow label="Armor" render={(i) => loadout.baseStats[i] || ""} />
          <BreakdownRow
            label="Mods"
            render={(i) =>
              loadout.modBonus[i] ? (
                <span className="text-sky-400/80">+{loadout.modBonus[i]}</span>
              ) : (
                ""
              )
            }
          />
          <BreakdownRow
            label="Tuning"
            render={(i) => {
              const v = loadout.tuningBonus[i];
              if (!v) return "";
              return (
                <span className={v < 0 ? "text-red-400/80" : "text-sky-400/80"}>
                  {v > 0 ? `+${v}` : v}
                </span>
              );
            }}
          />

          <div className="border-border/60 col-span-full my-0.5 border-t" />

          <BreakdownRow
            label="Total"
            labelClass="text-foreground font-medium"
            render={(i) => (
              <span className="text-foreground font-medium">
                {loadout.stats[i]}
              </span>
            )}
          />
        </div>
      )}
    </div>
  );
}

function Results({
  result,
  pieceMap,
  targets,
  setMap,
  statIcons,
}: {
  result: NonNullable<ReturnType<typeof useOptimizer>["result"]>;
  pieceMap: Map<string, ArmorPiece>;
  targets: number[];
  setMap: Map<number, ArmorSetInfo>;
  statIcons: Record<StatKey, string | undefined>;
}) {
  if (result.loadouts.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No loadouts from your gear meet those constraints — even with mods. Try
        easing a target, a set bonus, or raising your mod budget.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        {result.combosValid.toLocaleString()} matching loadouts · showing top{" "}
        {Math.min(MAX_SHOWN, result.loadouts.length)}
      </p>
      {result.capped && (
        <p className="text-xs text-amber-600/90 dark:text-amber-500/90">
          Hit the time limit — showing the best found so far. Narrow your targets
          for an exhaustive search.
        </p>
      )}
      <div className="space-y-1.5">
        {result.loadouts.slice(0, MAX_SHOWN).map((loadout, idx) => (
          <BuildRow
            key={idx}
            loadout={loadout}
            pieceMap={pieceMap}
            setMap={setMap}
            statIcons={statIcons}
            targets={targets}
          />
        ))}
      </div>
    </div>
  );
}
