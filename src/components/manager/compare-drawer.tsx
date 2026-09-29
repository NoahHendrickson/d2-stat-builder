"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, ArrowUp01Icon, Cancel01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { CLASS_NAMES } from "@/lib/armory/stats";
import { useProfile } from "@/lib/armory/use-profile";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import { annotationsStore, setTag, type Annotations } from "@/lib/inventory/annotations";
import type { InventoryItem, ManagerInventory } from "@/lib/inventory/build";
import type { Place } from "@/lib/inventory/moves";
import {
  activePicks,
  comparePerkFinderItems,
  findPerkFinderResult,
  finderPerkColumns,
  masterworkColumn,
  perkFinderInput,
  togglePick,
  type PerkCombo,
  type PerkFinderResult,
  type PerkMatchMode,
  type PerkPick,
  type PerkPriority,
} from "@/lib/inventory/perk-finder";
import { weaponCopies } from "@/lib/inventory/search";
import { weaponRoll, weaponStats, type ItemStat, type WeaponRoll } from "@/lib/inventory/weapon-details";
import { useManifest } from "@/lib/manifest/use-manifest";
import { cn } from "@/lib/utils";
import { ItemTile } from "./item-tile";
import { PerkFinder } from "./perk-finder";

/** Stats where less is better (DIM highlights the lowest). */
const LOWER_IS_BETTER = new Set(["Charge Time", "Draw Time"]);
const NO_ANNOTATIONS: Annotations = {};

/**
 * DIM's Compare for weapons: every copy you own side by side (stats, masterwork, perks),
 * with the perk finder from the DIM branch new-compare-feature: pick the perks you want
 * and it marks the fewest copies to Keep, sorts them first, and offers to junk the rest.
 */
export function CompareDrawer({
  inventory,
  name,
  onClose,
}: {
  inventory: ManagerInventory;
  /** The weapon being compared; null closes the drawer. */
  name: string | null;
  onClose: () => void;
}) {
  return (
    // Non-modal like the loadout editor: tiles behind it stay usable, and clicking a
    // copy opens its details popup over the drawer.
    <Drawer open={name !== null} onOpenChange={(open) => !open && onClose()} swipeDirection="down" modal={false}>
      <DrawerContent
        aria-label={name ? `Compare ${name}` : "Compare"}
        className="d2-sidebar-opaque d2-line rounded-none border border-transparent shadow-none data-[swipe-axis=y]:[--drawer-content-max-height:min(85dvh,56rem)] [--bleed:0px] [--drawer-bleed-background:var(--glass-opaque)]"
        style={{ left: "var(--app-sidebar-width, 0px)" }}
      >
        {name !== null && <CompareBody key={name} inventory={inventory} name={name} onClose={onClose} />}
      </DrawerContent>
    </Drawer>
  );
}

export interface Copy {
  item: InventoryItem;
  place: Place;
  roll: WeaponRoll;
  stats: ItemStat[];
}

type StatSort = { name: string; descending: boolean };

function CompareBody({
  inventory,
  name,
  onClose,
}: {
  inventory: ManagerInventory;
  name: string;
  onClose: () => void;
}) {
  const { query: profile } = useProfile();
  const manifestStatus = useManifest();
  const manifest = manifestStatus.state === "ready" ? manifestStatus.manifest : undefined;
  const copies = useMemo<Copy[]>(() => {
    if (!profile.data || !manifest) return [];
    return weaponCopies(inventory, name).map(({ item, place }) => ({
      item,
      place,
      roll: weaponRoll(profile.data, manifest, item.instanceId!),
      stats: weaponStats(profile.data, manifest, item.instanceId!),
    }));
  }, [inventory, name, profile.data, manifest]);
  return <CompareView inventory={inventory} name={name} copies={copies} onClose={onClose} />;
}

/** The compare table and perk finder for already-read copies. */
export function CompareView({
  inventory,
  name,
  copies,
  onClose,
}: {
  inventory: ManagerInventory;
  name: string;
  copies: Copy[];
  onClose: () => void;
}) {
  const annotations = useSyncExternalStore(annotationsStore.subscribe, annotationsStore.get, () => NO_ANNOTATIONS);

  const [statSort, setStatSort] = useState<StatSort | null>(null);
  const [showFinder, setShowFinder] = useState(false);
  /** Picked perks, most important first. */
  const [priority, setPriority] = useState<PerkPriority>([]);
  const [rankingEnabled, setRankingEnabled] = useState(false);
  const [mode, setMode] = useState<PerkMatchMode>("strict");
  const [combos, setCombos] = useState<PerkCombo[]>([]);

  const finderInput = useMemo(
    () => perkFinderInput(copies.map((c) => ({ id: c.item.key, roll: c.roll }))),
    [copies],
  );
  // Only count picks (and combos) the copies still offer, e.g. after one is dismantled.
  const isOffered = (pick: PerkPick) =>
    finderInput.columns.some((c) => c.index === pick.column && c.options.some((o) => o.hash === pick.hash));
  const activePriority = priority.filter(isOffered);
  const activeCombos = combos.filter((combo) => combo.every(isOffered));
  const result = findPerkFinderResult(finderInput.items, activePriority, mode, rankingEnabled, activeCombos);
  const finderActive = showFinder && result.pickedCount > 0;
  const picks = finderActive ? activePicks(activePriority, mode, activeCombos) : [];

  // Copies not needed for the picks; skip ones already tagged Favorite, Keep, or Junk.
  const junk = finderActive
    ? copies.filter((c) => {
        const tag = annotations[c.item.instanceId!]?.tag;
        return !result.keep.has(c.item.key) && tag !== "favorite" && tag !== "keep" && tag !== "junk";
      })
    : [];

  const statNames = [...new Set(copies.flatMap((c) => c.stats.map((s) => s.name)))];
  const statOf = (copy: Copy, stat: string) => copy.stats.find((s) => s.name === stat)?.value;

  // With perks picked, the copies to keep come first; else the stat sort, else Power.
  const ordered = copies.toSorted((a, b) => {
    if (finderActive) return comparePerkFinderItems(result)(a.item.key, b.item.key);
    if (statSort) {
      const diff = (statOf(a, statSort.name) ?? -Infinity) - (statOf(b, statSort.name) ?? -Infinity);
      return statSort.descending ? -diff : diff;
    }
    return (b.item.power ?? 0) - (a.item.power ?? 0);
  });

  const sortBy = (stat: string) =>
    setStatSort((s) => (s?.name === stat ? (s.descending ? { name: stat, descending: false } : null) : { name: stat, descending: true }));

  /** The best value of a stat, or undefined when every copy has the same. */
  const best = (stat: string) => {
    const values = copies.map((c) => statOf(c, stat)).filter((v) => v !== undefined);
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (min === max) return undefined;
    return LOWER_IS_BETTER.has(stat) ? min : max;
  };

  const grid = { gridTemplateColumns: `8.5rem repeat(${ordered.length}, minmax(10.5rem, 1fr))` };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-foreground/12 flex flex-wrap items-center gap-3 border-b px-4 py-2.5">
        <DrawerTitle className="text-base font-medium">{name}</DrawerTitle>
        <span className="text-muted-foreground text-sm">
          {copies.length} {copies.length === 1 ? "copy" : "copies"}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            size="sm"
            variant="default"
            aria-pressed={showFinder}
            className={cn(showFinder && "bg-foreground text-background")}
            onClick={() => setShowFinder((s) => !s)}
          >
            <HugeiconsIcon icon={Search01Icon} aria-hidden />
            Find a roll
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label="Close compare" onClick={onClose}>
            <HugeiconsIcon icon={Cancel01Icon} aria-hidden />
          </Button>
        </div>
      </div>

      <div className="d2-scroll min-h-0 flex-1 overflow-auto">
        {showFinder && (
          <PerkFinder
            columns={finderInput.columns}
            priority={activePriority}
            combos={activeCombos}
            onCombosChange={setCombos}
            rankingEnabled={rankingEnabled}
            onRankingEnabledChange={setRankingEnabled}
            mode={mode}
            result={result}
            onTogglePerk={(pick) => setPriority((p) => togglePick(p, pick))}
            onPriorityChange={setPriority}
            onModeChange={setMode}
            onClear={() => {
              setPriority([]);
              setCombos([]);
            }}
            junkCount={junk.length}
            onTagJunk={() => setTag(junk.map((c) => c.item.instanceId!), "junk")}
          />
        )}

        {copies.length === 0 ? (
          <p className="text-muted-foreground p-4 text-sm">Loading your copies…</p>
        ) : (
          <div className="grid w-max min-w-full px-4 py-3 text-[13px]" style={grid}>
            {/* Header: each copy's tile, where it is, and how it fares against the picks. */}
            <div />
            {ordered.map((copy) => (
              <CopyHeader
                key={copy.item.key}
                copy={copy}
                inventory={inventory}
                status={finderActive ? statusOf(result, copy.item.key) : undefined}
              />
            ))}

            {statNames.map((stat) => (
              <Row key={stat}>
                <button
                  type="button"
                  onClick={() => sortBy(stat)}
                  className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-left outline-none focus-visible:d2-tile-selected"
                >
                  {stat}
                  {statSort?.name === stat && !finderActive && (
                    <HugeiconsIcon
                      icon={statSort.descending ? ArrowDown01Icon : ArrowUp01Icon}
                      className="size-3"
                      aria-label={statSort.descending ? "highest first" : "lowest first"}
                    />
                  )}
                </button>
                {ordered.map((copy) => {
                  const value = statOf(copy, stat);
                  return (
                    <Cell key={copy.item.key} dim={isDim(finderActive, result, copy)}>
                      <span
                        className={cn(
                          "tabular-nums",
                          value !== undefined && value === best(stat)
                            ? "text-positive font-medium"
                            : undefined,
                        )}
                      >
                        {value ?? "–"}
                      </span>
                    </Cell>
                  );
                })}
              </Row>
            ))}

            <Row>
              <span className="text-muted-foreground">Masterwork</span>
              {ordered.map((copy) => {
                const mw = copy.roll.mods.find((m) => m.kind === "masterwork");
                const picked = mw?.stat
                  ? picks.some((p) => p.column === masterworkColumn && p.hash === mw.stat!.hash)
                  : false;
                return (
                  <Cell key={copy.item.key} dim={isDim(finderActive, result, copy)}>
                    <span className={cn("px-1", picked && "bg-item-frame-masterwork/70")}>{mw?.stat?.name ?? "–"}</span>
                  </Cell>
                );
              })}
            </Row>

            <Row last>
              <span className="text-muted-foreground">Perks</span>
              {ordered.map((copy) => (
                <Cell key={copy.item.key} dim={isDim(finderActive, result, copy)}>
                  <CopyPerks roll={copy.roll} picks={picks} names={finderInput} />
                </Cell>
              ))}
            </Row>
          </div>
        )}
      </div>
    </div>
  );
}

interface PerkStatus {
  keep: boolean;
  matched: number;
  total: number;
}

function statusOf(result: PerkFinderResult, key: string): PerkStatus {
  return { keep: result.keep.has(key), matched: result.matchedCount.get(key) ?? 0, total: result.pickedCount };
}

/** Copies with none of the picks fade back. */
const isDim = (active: boolean, result: PerkFinderResult, copy: Copy) =>
  active && (result.matchedCount.get(copy.item.key) ?? 0) === 0;

/** A row of the grid: its label cell then one cell per copy, over a faint rule. */
function Row({ children, last = false }: { children: React.ReactNode; last?: boolean }) {
  return <div className={cn("contents [&>*]:border-foreground/8 [&>*]:py-1.5", !last && "[&>*]:border-b")}>{children}</div>;
}

function Cell({ dim, children }: { dim: boolean; children: React.ReactNode }) {
  return <div className={cn("px-2 transition-opacity", dim && "opacity-40")}>{children}</div>;
}

function placeLabel(inventory: ManagerInventory, place: Place) {
  if (place.kind === "vault") return "Vault";
  if (place.kind === "account") return "Account";
  const character = inventory.characters.find((c) => c.id === place.characterId);
  const className = character ? (CLASS_NAMES[character.classType] ?? "Character") : "Character";
  if (place.kind === "postmaster") return `${className} postmaster`;
  return place.equipped ? `Equipped on ${className}` : className;
}

function CopyHeader({
  copy,
  inventory,
  status,
}: {
  copy: Copy;
  inventory: ManagerInventory;
  status: PerkStatus | undefined;
}) {
  return (
    <div
      className={cn(
        "border-foreground/8 flex items-start gap-2.5 border-b px-2 pb-3",
        status?.matched === 0 && "opacity-40",
      )}
    >
      <ItemTile item={copy.item} />
      <div className="flex min-w-0 flex-col gap-1 pt-0.5">
        <span className="truncate">{placeLabel(inventory, copy.place)}</span>
        {status && (
          <span className="flex items-center gap-1.5 text-xs">
            {status.keep && <span className="bg-positive px-1.5 py-px font-medium text-white">Keep</span>}
            <span className="text-muted-foreground tabular-nums">
              {status.matched}/{status.total} perks
            </span>
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * A copy's perk columns, small: the perk in each socket filled blue, the others it
 * rolled faint. Picked perks get the perk finder's fill.
 */
function CopyPerks({
  roll,
  picks,
  names,
}: {
  roll: WeaponRoll;
  picks: PerkPick[];
  names: ReturnType<typeof perkFinderInput>;
}) {
  const finderColumns = finderPerkColumns(roll);
  // A pick is by (column, unenhanced hash); match plugs by name so enhanced ones count.
  const pickedNames = new Set(
    picks.map((p) => {
      const option = names.columns.find((c) => c.index === p.column)?.options.find((o) => o.hash === p.hash);
      return `${p.column}:${option?.name}`;
    }),
  );
  return (
    <div className="flex gap-1">
      {roll.columns.map((column) => {
        const finderIndex = finderColumns.indexOf(column);
        return (
          <div key={column.socketIndex} className="flex flex-col gap-0.5">
            {column.options.map((plug) => {
              const picked = finderIndex >= 0 && pickedNames.has(`${finderIndex}:${plug.name}`);
              const current = plug.hash === column.current.hash;
              return (
                <span
                  key={plug.hash}
                  title={current ? `${plug.name} (equipped)` : plug.name}
                  className={cn(
                    "relative flex size-7 items-center justify-center",
                    // Picked: gold, brighter when it's the perk in the socket now.
                    picked
                      ? current
                        ? "bg-item-frame-masterwork/70"
                        : "bg-item-frame-masterwork/30"
                      : current
                        ? "bg-[#305f8e]"
                        : "bg-foreground/4",
                  )}
                >
                  {plug.icon ? (
                    <Image
                      src={`${BUNGIE_IMAGE_BASE}${plug.icon}`}
                      alt={plug.name}
                      width={22}
                      height={22}
                      className="size-[22px]"
                      unoptimized
                    />
                  ) : (
                    <span className="bg-muted size-[22px]" />
                  )}
                  {plug.enhanced && (
                    <Image
                      src="/manager/perk-enhanced.svg"
                      alt=""
                      width={6}
                      height={6}
                      className="absolute top-0.5 left-0.5"
                    />
                  )}
                </span>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
