"use client";

import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUp02Icon, CrosshairIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PerkTooltip } from "@/components/weapons/perk-tooltip";
import { WeaponStats } from "@/components/weapons/weapon-stats";
import { WeaponSearchBox } from "@/components/weapons/weapon-search-box";
import { clarityLines } from "@/lib/weapons/clarity";
import { weaponDisplayStats } from "@/lib/weapons/display-stats";
import { useClarity } from "@/lib/weapons/use-clarity";
import { useWeaponCatalog } from "@/lib/weapons/use-weapon-catalog";
import {
  activeFilterChips,
  buildFilterIndex,
  pendingPairValue,
  withFilter,
  withoutFilter,
} from "@/lib/weapons/filter-suggestions";
import { SORTS, readSearchState } from "@/lib/weapons/search-state";
import type { WeaponCatalog } from "@/lib/weapons/catalog";
import type {
  AmmoTypeRef,
  DamageTypeRef,
  WeaponSummary,
} from "@/lib/weapons/types";
import { useMinWidth } from "@/lib/use-min-width";
import { cn } from "@/lib/utils";

const SORT_ITEMS: Record<string, string> = Object.fromEntries(SORTS);
/** Tailwind `lg`: from here the details sit beside the list instead of in a dialog. */
const SPLIT_MIN_PX = 1024;

function WeaponIcon({
  weapon,
  size = 44,
}: {
  weapon: WeaponSummary;
  size?: number;
}) {
  return (
    <span
      className="relative block shrink-0 bg-foreground/5"
      style={{ width: size, height: size }}
    >
      {weapon.icon && (
        <Image
          src={`https://www.bungie.net${weapon.icon}`}
          alt=""
          width={size}
          height={size}
          unoptimized
        />
      )}
      {weapon.watermark && (
        <Image
          className="absolute inset-0"
          src={`https://www.bungie.net${weapon.watermark}`}
          alt=""
          width={size}
          height={size}
          unoptimized
        />
      )}
    </span>
  );
}

/** The element's damage-type glyph from the catalog; Kinetic's is white, so it inverts on light. */
function ElementIcon({
  element,
  damageTypes,
  size = 14,
}: {
  element: string;
  damageTypes: readonly DamageTypeRef[] | undefined;
  size?: number;
}) {
  const icon = damageTypes?.find((type) => type.name === element)?.icon;
  if (!icon) return <span>{element}</span>;
  return (
    <Image
      className={cn(
        "shrink-0",
        element === "Kinetic" && "invert dark:invert-0",
      )}
      src={`https://www.bungie.net${icon}`}
      alt={element}
      title={element}
      width={size}
      height={size}
      unoptimized
    />
  );
}

/** The in-game HUD tints: white (Primary), green (Special), purple (Heavy). */
const AMMO_COLOR: Record<string, string> = {
  Primary: "text-foreground",
  Special: "text-[#58c26c]",
  Heavy: "text-[#7d58c2]",
};

/** Ammo HUD icon used as a mask so it takes the ammo color; falls back to the name. */
function AmmoIcon({
  ammo,
  ammoTypes,
}: {
  ammo: string;
  ammoTypes: readonly AmmoTypeRef[] | undefined;
}) {
  const icon = ammoTypes?.find((type) => type.name === ammo)?.icon;
  if (!icon) return <span>{ammo}</span>;
  const mask = `url("https://www.bungie.net${icon}") center / contain no-repeat`;
  return (
    <span
      role="img"
      aria-label={ammo}
      title={ammo}
      className={cn(
        "-my-1 inline-block size-6 shrink-0 bg-current",
        AMMO_COLOR[ammo],
      )}
      style={{ mask, WebkitMask: mask }}
    />
  );
}

/** A perk's place in the grid: which column, and its catalog index. */
type PerkPick = { column: number; perk: number };

/** Masterworks pick like their own column; no real column index is negative. */
const MASTERWORK = -1;

function WeaponDetails({
  weapon,
  catalog,
  inDialog = false,
}: {
  weapon: WeaponSummary;
  catalog: WeaponCatalog;
  inDialog?: boolean;
}) {
  const clarity = useClarity();
  // One picked perk per column (column index → perk index); a hovered perk
  // previews in place of its column's pick. Keyed by weapon, so both reset.
  const [picked, setPicked] = useState<Record<number, number>>({});
  const [hovered, setHovered] = useState<PerkPick | null>(null);
  const statsFor = (picks: Record<number, number>) =>
    weaponDisplayStats(
      weapon,
      catalog.statCurves,
      Object.values(picks).flatMap((i) => catalog.perks[i] ?? []),
    );
  // Picks are the settled roll, drawn plain; a hover shows its change against
  // them in green and red.
  const current = statsFor(picked);
  const preview = hovered
    ? statsFor({ ...picked, [hovered.column]: hovered.perk })
    : current;
  function toggle(column: number, perk: number) {
    setPicked(({ [column]: current, ...rest }) =>
      current === perk ? rest : { ...rest, [column]: perk },
    );
  }
  const masterworks = weapon.masterworks ?? [];
  const hasIntrinsic = weapon.columns.some((c) => c.kind === "Intrinsic");

  /** One perk's tile. `columnKey` is the column it picks in (MASTERWORK for masterworks). */
  function perkTile(columnKey: number, index: number) {
    const perk = catalog.perks[index];
    if (!perk) return null;
    const selected = picked[columnKey] === index;
    const label = perk.currentlyCanRoll ? perk.name : `${perk.name} (retired)`;
    // light.gg's perk grid: the icon on a tile framed by the app's line;
    // picking it fills the tile blue, under the line too, so the line reads
    // on the blue. A gold arrow tucked into the top-left corner marks perks
    // with an enhanced tier. The name lives in the tooltip.
    const content = (
      <>
        {perk.icon && (
          <Image
            src={`https://www.bungie.net${perk.icon}`}
            alt=""
            width={40}
            height={40}
            unoptimized
          />
        )}
        {perk.alternateHashes?.length ? (
          <HugeiconsIcon icon={ArrowUp02Icon}
            aria-hidden
            strokeWidth={2}
            className="absolute top-1 left-1 size-2.5 text-exotic-line"
          />
        ) : null}
      </>
    );
    return (
      <Tooltip key={index}>
        <TooltipTrigger
          delay={0}
          render={
            <button
              type="button"
              aria-label={label}
              aria-pressed={selected}
              onClick={() => toggle(columnKey, index)}
              onPointerEnter={() =>
                setHovered({ column: columnKey, perk: index })
              }
              // Leaving a tile ends its preview, even into the gaps between
              // tiles; only clear if a neighbour hasn't already taken over.
              onPointerLeave={() =>
                setHovered((h) =>
                  h?.column === columnKey && h.perk === index ? null : h,
                )
              }
              className={cn(
                "d2-line relative flex size-14 shrink-0 items-center justify-center [--line-alpha:1.6] hover:[--line-alpha:2.6] focus-visible:outline-1 focus-visible:outline-offset-2",
                selected
                  ? "bg-[#3b6ea5] [--line-alpha:2.6]"
                  : "hover:bg-foreground/10",
                !perk.currentlyCanRoll && "opacity-40",
              )}
            />
          }
        >
          {content}
        </TooltipTrigger>
        <TooltipContent side="right" align="start" className="max-w-sm">
          <PerkTooltip perk={perk} insight={clarityLines(clarity, perk)} />
        </TooltipContent>
      </Tooltip>
    );
  }

  const poolLabel = catalog.poolLabel(weapon.hash);
  const Title = inDialog ? DialogTitle : "h2";
  const Description = inDialog ? DialogDescription : "p";
  return (
    <>
      <div className={cn("flex items-center gap-3", inDialog && "pr-8")}>
        <WeaponIcon weapon={weapon} size={inDialog ? 56 : 72} />
        <div>
          <Title
            className={cn(
              "font-medium",
              inDialog ? "text-base" : "text-xl",
              weapon.rarity === "Exotic" && "text-amber-300",
            )}
          >
            {weapon.name}
          </Title>
          <Description className="mt-2 flex items-center gap-3 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <ElementIcon
                element={weapon.element}
                damageTypes={catalog.damageTypes}
                size={16}
              />
              {weapon.type}
            </span>
            <span>{weapon.ammo}</span>
          </Description>
        </div>
      </div>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
        {[
          weapon.frame,
          ...(weapon.champions ?? []).map((champion) => `Anti-${champion}`),
          weapon.source,
          poolLabel !== weapon.source ? poolLabel : undefined,
          weapon.seasonName,
        ]
          .filter(Boolean)
          .map((part) => (
            <span key={part}>{part}</span>
          ))}
      </p>
      <div className="flex flex-wrap items-start gap-8">
        {Object.keys(current).length > 0 && (
          <WeaponStats base={current} stats={preview} />
        )}
        <div className="flex max-w-full gap-2.5 overflow-x-auto pb-1">
          {!hasIntrinsic && masterworks.length > 0 && (
            <section
              aria-label="Masterwork"
              className="flex shrink-0 flex-col gap-2.5"
            >
              {masterworks.map((index) => perkTile(MASTERWORK, index))}
            </section>
          )}
          {weapon.columns.map((column, i) => (
            <section
              key={i}
              aria-label={column.kind}
              className="flex shrink-0 flex-col gap-2.5"
            >
              {column.perkIndices.map((index) => perkTile(i, index))}
              {column.kind === "Intrinsic" && masterworks.length > 0 && (
                // Masterworks sit under the frame, a step apart from it.
                <div
                  role="group"
                  aria-label="Masterwork"
                  className="mt-2.5 flex flex-col gap-2.5"
                >
                  {masterworks.map((index) => perkTile(MASTERWORK, index))}
                </div>
              )}
            </section>
          ))}
        </div>
      </div>
    </>
  );
}

export function WeaponBrowser() {
  const query = useWeaponCatalog();
  const params = useSearchParams();
  const serialized = params.toString();
  const currentParams = useMemo(
    () => new URLSearchParams(serialized),
    [serialized],
  );
  const state = useMemo(() => readSearchState(currentParams), [currentParams]);
  const chips = useMemo(
    () => activeFilterChips(state, currentParams),
    [state, currentParams],
  );
  const deferred = useDeferredValue(state);
  const [picked, setPicked] = useState<WeaponSummary | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const split = useMinWidth(SPLIT_MIN_PX);
  const scrollRef = useRef<HTMLDivElement>(null);
  const detailsRef = useRef<HTMLElement>(null);
  const data = query.data;
  const results = useMemo(
    () => data?.search(deferred.query, deferred.filters, deferred.sort) ?? [],
    [data, deferred],
  );
  // A weapon always stays open: the last one picked (even after a search
  // filters it out), else the top result.
  const shown = picked ?? results[0] ?? null;
  // Half a perk combo narrows its list to perks that roll opposite that half.
  const comboFirst = pendingPairValue(currentParams, "perkCombo");
  const filterIndex = useMemo(() => {
    if (!data) return [];
    return buildFilterIndex(
      comboFirst
        ? { ...data.facets, perkCombo: data.comboPartners(comboFirst) }
        : data.facets,
    );
  }, [data, comboFirst]);
  // The virtualizer owns mutable measurements; don't memoize its returned methods.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: results.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 76,
    overscan: 8,
    getItemKey: (index) => results[index].hash,
  });
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [deferred]);
  useEffect(() => {
    detailsRef.current?.scrollTo({ top: 0 });
  }, [shown?.hash]);

  function navigate(next: URLSearchParams, push = false) {
    const url = `${window.location.pathname}${next.size ? `?${next}` : ""}`;
    window.history[push ? "pushState" : "replaceState"](null, "", url);
  }
  function update(key: string, values: string[], push = true) {
    const next = new URLSearchParams(window.location.search);
    next.delete(key);
    for (const value of values) if (value) next.append(key, value);
    navigate(next, push);
  }
  function currentUrlParams() {
    return new URLSearchParams(window.location.search);
  }

  return (
    <main className="flex h-full min-h-[480px] w-full gap-6 p-4 md:p-6">
      <div className="flex min-w-0 flex-1 flex-col gap-4 lg:w-[26rem] lg:flex-none xl:w-1/2 2xl:w-[44rem]">
        <h1 className="flex shrink-0 items-center gap-2 text-lg font-medium">
          <HugeiconsIcon icon={CrosshairIcon} className="size-5 text-muted-foreground" /> Weapon search
        </h1>

        <div className="flex shrink-0 items-start">
          <WeaponSearchBox
            index={filterIndex}
            query={state.query}
            params={currentParams}
            chips={chips}
            onQuery={(text) => update("q", [text], false)}
            onAdd={(value, category) =>
              navigate(withFilter(currentUrlParams(), value, category), true)
            }
            onRemove={(chip) =>
              navigate(withoutFilter(currentUrlParams(), chip), true)
            }
            onClear={() => navigate(new URLSearchParams(), true)}
            damageTypes={data?.damageTypes}
            ammoTypes={data?.ammoTypes}
          />
        </div>

        <div className="flex shrink-0 items-center gap-3 border-b border-foreground/8 pb-3 text-xs">
          <span
            role="status"
            className="text-sm tabular-nums text-foreground"
            title={
              data
                ? `Catalog updated ${data.generatedAt.slice(0, 10)}`
                : undefined
            }
          >
            {query.isPending
              ? "Loading weapons…"
              : `${results.length.toLocaleString()} weapons`}
            {state !== deferred && (
              <span className="ml-3 text-muted-foreground">Updating…</span>
            )}
          </span>
          <Select
            items={SORT_ITEMS}
            value={state.sort}
            onValueChange={(value) => value && update("sort", [value])}
          >
            <SelectTrigger
              className="ml-auto min-w-36"
              aria-label="Sort weapons"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {SORTS.map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {query.isError ? (
          <div role="alert" className="py-8 text-sm">
            <p>{query.error.message}</p>
            <Button className="mt-3" onClick={() => void query.refetch()}>
              Try again
            </Button>
          </div>
        ) : (
          <div
            ref={scrollRef}
            className={cn(
              "min-h-40 flex-1 overflow-y-auto",
              state !== deferred && "opacity-60",
            )}
            aria-busy={query.isPending || state !== deferred}
          >
            {!query.isPending && results.length === 0 && (
              <div className="py-12 text-center">
                <p>No weapons match this search.</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Try removing a filter or searching for a different perk.
                </p>
              </div>
            )}
            <div
              className="relative w-full"
              style={{ height: virtualizer.getTotalSize() }}
              role="list"
              aria-label="Weapons"
            >
              {virtualizer.getVirtualItems().map((row) => {
                const weapon = results[row.index];
                const poolLabel = data?.poolLabel(weapon.hash);
                const current = weapon.hash === shown?.hash;
                return (
                  <div
                    key={row.key}
                    role="listitem"
                    aria-posinset={row.index + 1}
                    aria-setsize={results.length}
                    className="absolute top-0 left-0 w-full"
                    style={{
                      height: row.size,
                      transform: `translateY(${row.start}px)`,
                    }}
                  >
                    <button
                      type="button"
                      className={cn(
                        "flex h-full w-full items-center gap-3 border-b border-foreground/5 px-2 text-left outline-none hover:bg-foreground/5 focus-visible:bg-foreground/8",
                        current && "bg-foreground/8",
                      )}
                      onClick={() => {
                        setPicked(weapon);
                        setDialogOpen(!split);
                      }}
                      aria-current={current || undefined}
                      aria-label={`View ${weapon.name} perks`}
                    >
                      <WeaponIcon weapon={weapon} />
                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            "truncate text-sm font-medium",
                            weapon.rarity === "Exotic" && "text-amber-300",
                          )}
                        >
                          {weapon.name}
                          {poolLabel && (
                            <>
                              {" "}
                              <span className="ml-1 font-normal text-muted-foreground">
                                {poolLabel}
                              </span>
                            </>
                          )}
                        </p>
                        <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <ElementIcon
                            element={weapon.element}
                            damageTypes={data?.damageTypes}
                          />
                          <AmmoIcon
                            ammo={weapon.ammo}
                            ammoTypes={data?.ammoTypes}
                          />
                          <span className="truncate">{weapon.type}</span>
                          {weapon.frame && (
                            <span className="ml-1.5 truncate">
                              {weapon.frame}
                            </span>
                          )}
                          {weapon.craftable && (
                            <span className="ml-1.5 shrink-0">Craftable</span>
                          )}
                        </p>
                      </div>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <aside
        ref={detailsRef}
        aria-label="Weapon details"
        className="hidden min-w-0 flex-1 overflow-y-auto border-l border-foreground/8 pl-6 lg:block"
      >
        {/* Below the split the dialog shows the details instead; this pane is hidden,
            so don't build a second copy of them (perks, stats, Clarity) behind it. */}
        {!split ? null : shown && data ? (
          <div className="grid gap-4 text-sm">
            <WeaponDetails key={shown.hash} weapon={shown} catalog={data} />
          </div>
        ) : (
          !query.isPending && (
            <p className="pt-12 text-center text-sm text-muted-foreground">
              No weapon selected.
            </p>
          )
        )}
      </aside>
      <Dialog
        open={!split && dialogOpen && picked != null}
        onOpenChange={setDialogOpen}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl">
          {picked && data && (
            <WeaponDetails
              key={picked.hash}
              weapon={picked}
              catalog={data}
              inDialog
            />
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
