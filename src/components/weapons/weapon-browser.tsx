"use client";

import Image from "next/image";
import { useSearchParams } from "next/navigation";
import {
  type CSSProperties,
  type ReactNode,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUpDownIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { WeaponDetails } from "@/components/weapons/weapon-details";
import {
  AMMO_TYPE,
  AmmoIcon,
  ChampionIcon,
  ElementIcon,
  TypeSilhouette,
  WeaponIcon,
} from "@/components/weapons/weapon-icons";
import { WeaponSearchBox } from "@/components/weapons/weapon-search-box";
import { useWeaponCatalog } from "@/lib/weapons/use-weapon-catalog";
import {
  activeFilterChips,
  buildFilterIndex,
  pendingPairValue,
  withFilter,
  withoutFilter,
} from "@/lib/weapons/filter-suggestions";
import { resolveFrame } from "@/lib/weapons/pick-slots";
import { SORTS, readSearchState } from "@/lib/weapons/search-state";
import type { WeaponSummary } from "@/lib/weapons/types";
import { weaponTypeIcon } from "@/lib/weapons/weapon-type-icon-paths";
import { useMinWidth } from "@/lib/use-min-width";
import { cn } from "@/lib/utils";

const SORT_ITEMS: Record<string, string> = Object.fromEntries(SORTS);
/** Tailwind `lg`: from here the details sit beside the list instead of in a dialog. */
const SPLIT_MIN_PX = 1024;
/** A result row's nameplate height, and the gap left between plates. */
const ROW_PX = 40;
const ROW_GAP_PX = 4;

/** Each element's tint, as RGB channels: the chip colours from the search box. */
const ELEMENT_PLATE: Record<string, string> = {
  Arc: "40 180 220",
  Solar: "255 120 40",
  Void: "125 88 194",
  Stasis: "60 140 220",
  Strand: "60 200 120",
  Kinetic: "180 180 180",
};

/**
 * A row's look, a pane of tinted glass over the page: its element's colour,
 * easing off to the right. The open weapon's row doesn't ease off but
 * brightens toward its end instead.
 */
function nameplate(element: string, current: boolean): CSSProperties {
  const tint = ELEMENT_PLATE[element] ?? ELEMENT_PLATE.Kinetic;
  const [from, to] = current ? [0.3, 0.42] : [0.28, 0.12];
  return {
    background: `linear-gradient(90deg, rgb(${tint} / ${from}), rgb(${tint} / ${to}))`,
  };
}

/**
 * A list row icon's name in the site's tooltip, quick to open. The trigger is
 * a span, as the icon already sits inside the row's button.
 */
function IconTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        delay={100}
        render={<span className="flex shrink-0 items-center" />}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
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
    estimateSize: () => ROW_PX + ROW_GAP_PX,
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
      <div className="flex min-w-0 flex-1 flex-col gap-4 lg:w-[26rem] lg:flex-none xl:w-1/2 2xl:w-[32rem]">
        <h1 className="flex shrink-0 items-center gap-2 text-lg font-medium">
          <Image src="/weapon-search-icon.png" alt="" width={28} height={28} className="size-7" />
          Weapon search
        </h1>

        {/* Full-bleed band: from the sidebar's edge to the details divider (the page's
            padding on the left, the gap before the divider on the right). */}
        <div className="-mx-4 flex shrink-0 items-start md:-mx-6">
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
            // The result count and sort ride at the end of the bar (Figma 120:127).
            trailing={
              <>
                <span
                  role="status"
                  className="ml-auto shrink-0 text-sm tabular-nums"
                  title={
                    data
                      ? `${results.length.toLocaleString()} weapons\nCatalog updated ${data.generatedAt.slice(0, 10)}`
                      : undefined
                  }
                >
                  {query.isPending ? (
                    "Loading…"
                  ) : state !== deferred ? (
                    <span className="text-muted-foreground">Updating…</span>
                  ) : (
                    <>
                      {results.length.toLocaleString()}
                      <span className="sr-only"> weapons</span>
                    </>
                  )}
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    className="flex size-7 shrink-0 items-center justify-center text-muted-foreground outline-none hover:text-foreground focus-visible:outline-1 data-popup-open:text-foreground"
                    aria-label={`Sort weapons: ${SORT_ITEMS[state.sort]}`}
                    title={`Sort: ${SORT_ITEMS[state.sort]}`}
                  >
                    <HugeiconsIcon icon={ArrowUpDownIcon} className="size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                    </DropdownMenuGroup>
                    <DropdownMenuRadioGroup
                      value={state.sort}
                      onValueChange={(value) => update("sort", [value])}
                    >
                      {SORTS.map(([value, label]) => (
                        <DropdownMenuRadioItem key={value} value={value}>
                          {label}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            }
          />
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
              // Out into the page padding by the row's border, so the
              // thumbnails line up with the heading and the search bar's icon.
              "-mx-px min-h-40 flex-1 overflow-y-auto",
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
                const frame = data && resolveFrame(weapon, data.perks).perk?.icon;
                return (
                  <div
                    key={row.key}
                    role="listitem"
                    aria-posinset={row.index + 1}
                    aria-setsize={results.length}
                    className="absolute top-0 left-0 w-full"
                    style={{
                      height: row.size,
                      paddingBottom: ROW_GAP_PX,
                      transform: `translateY(${row.start}px)`,
                    }}
                  >
                    {/* A nameplate, like the game's roster: the icon square at the
                        left edge, then the name, the type's silhouette, and element,
                        frame, ammo, and champion icons, on a faint wash of the
                        element's colour. */}
                    <button
                      type="button"
                      // The open weapon keeps the hover frame.
                      className={cn(
                        "flex h-full w-full items-center gap-3 overflow-hidden border border-transparent pr-3 text-left outline-none dark:[text-shadow:0_1px_2px_rgb(0_0_0/0.5)] hover:border-foreground/50 focus-visible:border-foreground/50 normal:rounded-[10px]",
                        current && "border-foreground/50",
                      )}
                      style={nameplate(weapon.element, current)}
                      onClick={() => {
                        setPicked(weapon);
                        setDialogOpen(!split);
                      }}
                      aria-current={current || undefined}
                      aria-label={`View ${weapon.name} perks`}
                    >
                      <WeaponIcon weapon={weapon} size={ROW_PX - 2} />
                      <p
                        // A set width (shrinking alike on every row) so the icons after it line up.
                        className="min-w-0 shrink basis-60 truncate text-[15px]"
                      >
                        {weapon.name}
                        {poolLabel && (
                          <span className="ml-1.5 text-muted-foreground">
                            {poolLabel}
                          </span>
                        )}
                      </p>
                      {weaponTypeIcon(weapon.type, AMMO_TYPE[weapon.ammo]) ? (
                        <IconTip label={weapon.type}>
                          <TypeSilhouette weapon={weapon} />
                        </IconTip>
                      ) : (
                        <TypeSilhouette weapon={weapon} />
                      )}
                      <span className="flex shrink-0 items-center gap-4">
                        <IconTip label={weapon.element}>
                          <ElementIcon
                            element={weapon.element}
                            damageTypes={data?.damageTypes}
                            size={18}
                          />
                        </IconTip>
                        {/* Kept as an empty slot when missing, so the columns hold. */}
                        <span className="flex size-5 shrink-0">
                          {frame && (
                            <IconTip label={weapon.frame ?? "Frame"}>
                              <Image
                                src={`https://www.bungie.net${frame}`}
                                alt={weapon.frame ?? ""}
                                width={20}
                                height={20}
                                unoptimized
                              />
                            </IconTip>
                          )}
                        </span>
                        <IconTip label={`${weapon.ammo} ammo`}>
                          <AmmoIcon
                            ammo={weapon.ammo}
                            ammoTypes={data?.ammoTypes}
                          />
                        </IconTip>
                        <span className="flex items-center gap-1.5">
                          {weapon.champions?.map((champion) => (
                            <IconTip key={champion} label={`Anti-${champion}`}>
                              <ChampionIcon
                                champion={champion}
                                championTypes={data?.championTypes}
                              />
                            </IconTip>
                          ))}
                        </span>
                      </span>
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
          // Keyed here, not on WeaponDetails, so the fade replays per weapon.
          <div key={shown.hash} className="d2-fade grid grid-cols-1 gap-4 text-sm">
            <WeaponDetails weapon={shown} catalog={data} />
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
