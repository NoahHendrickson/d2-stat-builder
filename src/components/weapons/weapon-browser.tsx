"use client";

import Image from "next/image";
import { useSearchParams } from "next/navigation";
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  BookmarkSimple,
  Crosshair,
  MagnifyingGlass,
  X,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { FilterMultiselect } from "@/components/armor-table/filter-multiselect";
import { useWeaponCatalog } from "@/lib/weapons/use-weapon-catalog";
import {
  FILTERS,
  SORTS,
  describeSearchState,
  readSearchState,
} from "@/lib/weapons/search-state";
import type { WeaponCatalog } from "@/lib/weapons/catalog";
import type { WeaponSummary } from "@/lib/weapons/types";
import { cn } from "@/lib/utils";

const SAVED_KEY = "d2.weapon-search.saved.v1";
/** Perk lists run to ~900 rows; mount a page of them until the user types. */
const MAX_VISIBLE_OPTIONS = 100;
function subscribeSaved(notify: () => void) {
  window.addEventListener("storage", notify);
  window.addEventListener(SAVED_KEY, notify);
  return () => {
    window.removeEventListener("storage", notify);
    window.removeEventListener(SAVED_KEY, notify);
  };
}
function savedSnapshot() {
  try {
    return localStorage.getItem(SAVED_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}
function readSaved(raw: string): string[] {
  try {
    const data: unknown = JSON.parse(raw);
    return Array.isArray(data)
      ? data.filter((v): v is string => typeof v === "string").slice(0, 12)
      : [];
  } catch {
    return [];
  }
}
function writeSaved(values: string[]) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(values.slice(0, 12)));
  } catch {
    return;
  }
  window.dispatchEvent(new Event(SAVED_KEY));
}

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

function WeaponDetails({
  weapon,
  catalog,
  onPerk,
}: {
  weapon: WeaponSummary;
  catalog: WeaponCatalog;
  onPerk: (name: string) => void;
}) {
  const poolLabel = catalog.poolLabel(weapon.hash);
  return (
    <>
      <div className="flex items-center gap-3 pr-8">
        <WeaponIcon weapon={weapon} size={56} />
        <div>
          <DialogTitle>{weapon.name}</DialogTitle>
          <DialogDescription className="mt-2">
            {weapon.rarity} · {weapon.element} {weapon.type} · {weapon.ammo}
          </DialogDescription>
        </div>
      </div>
      <p className="text-muted-foreground">
        {[
          weapon.frame,
          weapon.source,
          poolLabel !== weapon.source ? poolLabel : undefined,
          weapon.seasonName,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <p className="text-xs text-muted-foreground">
        Possible perks for this version. Select a perk to find other weapons
        that can roll it.
      </p>
      <div className="grid grid-cols-2 gap-5 md:grid-cols-3">
        {weapon.columns.map((column, i) => (
          <section key={i} className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {column.kind}
            </h3>
            {column.perkIndices.map((index) => {
              const perk = catalog.perks[index];
              return (
                perk && (
                  <button
                    type="button"
                    key={index}
                    onClick={() => onPerk(perk.name)}
                    title={perk.description}
                    className="flex w-full items-center gap-2 p-1 text-left text-xs hover:bg-foreground/8 focus-visible:outline-1"
                  >
                    {perk.icon && (
                      <Image
                        src={`https://www.bungie.net${perk.icon}`}
                        alt=""
                        width={24}
                        height={24}
                        unoptimized
                      />
                    )}
                    <span>
                      {perk.name}
                      {!perk.currentlyCanRoll && (
                        <span className="text-muted-foreground">
                          {" "}
                          (retired)
                        </span>
                      )}
                    </span>
                  </button>
                )
              );
            })}
          </section>
        ))}
      </div>
    </>
  );
}

export function WeaponBrowser() {
  const query = useWeaponCatalog();
  const params = useSearchParams();
  const serialized = params.toString();
  const state = useMemo(
    () => readSearchState(new URLSearchParams(serialized)),
    [serialized],
  );
  const deferred = useDeferredValue(state);
  const [advanced, setAdvanced] = useState(false);
  const [perkGroup, setPerkGroup] = useState<string[]>([]);
  const [selected, setSelected] = useState<WeaponSummary | null>(null);
  const savedRaw = useSyncExternalStore(
    subscribeSaved,
    savedSnapshot,
    () => "[]",
  );
  const saved = useMemo(() => readSaved(savedRaw), [savedRaw]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const data = query.data;
  const results = useMemo(
    () => data?.search(deferred.query, deferred.filters, deferred.sort) ?? [],
    [data, deferred],
  );
  const options = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(data?.facets ?? {}).map(([key, values]) => [
          key,
          values.map(({ value }) => ({ value, label: value })),
        ]),
      ),
    [data],
  );
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
  const active = Boolean(state.query || Object.keys(state.filters).length);
  const visibleFilters = advanced ? FILTERS : FILTERS.slice(0, 6);

  return (
    <main className="mx-auto flex h-full min-h-[480px] w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
      <header className="flex shrink-0 items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-medium">
            <Crosshair className="size-5 text-muted-foreground" /> Weapon search
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Explore the full catalog. Find the perks you want to play.
          </p>
        </div>
        <span className="hidden pt-1 text-xs text-muted-foreground sm:block">
          Destiny 2 armory
        </span>
      </header>

      <div className="shrink-0 space-y-3">
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <MagnifyingGlass className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground" />
            <Input
              className="h-10 pl-9"
              type="search"
              aria-label="Search weapons"
              placeholder="Name, perk, or type:hc element:solar…"
              value={state.query}
              onChange={(e) => update("q", [e.target.value], false)}
              aria-describedby="weapon-search-help"
            />
          </div>
          <Button
            className="h-10"
            variant="outline"
            disabled={!active || saved.includes(serialized)}
            onClick={() => writeSaved([serialized, ...saved])}
            aria-label="Save search"
          >
            <BookmarkSimple className="size-4" />
            <span className="hidden sm:inline">Save search</span>
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {visibleFilters.map(([key, label]) => (
            <FilterMultiselect
              key={key}
              label={label}
              allLabel={label}
              searchable
              options={options[key] ?? []}
              value={state.filters[key] ?? []}
              onChange={(values) =>
                update(key, key === "perkCombo" ? values.slice(-2) : values)
              }
              maxVisible={MAX_VISIBLE_OPTIONS}
              className="max-w-64"
            />
          ))}
          <Button
            variant="ghost"
            onClick={() => setAdvanced(!advanced)}
            aria-expanded={advanced}
          >
            {advanced ? "Fewer filters" : "More filters"}
          </Button>
        </div>
        {advanced && (
          <div className="flex flex-wrap gap-5 text-xs">
            <FilterMultiselect
              label="Adept"
              allLabel="Adept & standard"
              options={[
                { value: "true", label: "Adept" },
                { value: "false", label: "Standard" },
              ]}
              value={
                state.filters.adept == null ? [] : [String(state.filters.adept)]
              }
              onChange={(values) => update("adept", values.slice(-1))}
            />
            {([1, 2] as const).map((column) => {
              const key =
                column === 1 ? "trait1DamagePerks" : "trait2DamagePerks";
              return (
                <label key={key} className="flex items-center gap-2">
                  <Checkbox
                    checked={state.filters[key] ?? false}
                    onCheckedChange={(checked) =>
                      update(key, checked ? ["true"] : [])
                    }
                  />
                  Damage perks in trait {column}
                </label>
              );
            })}
          </div>
        )}
        {advanced && (
          <div className="flex flex-wrap items-center gap-2">
            <FilterMultiselect
              label="Custom perk group"
              allLabel="Choose perks for a group"
              searchable
              options={options.perks ?? []}
              value={perkGroup}
              onChange={setPerkGroup}
              maxVisible={MAX_VISIBLE_OPTIONS}
              className="max-w-80"
            />
            <Button
              variant="outline"
              disabled={
                !perkGroup.length ||
                (state.filters.customPerkGroups?.length ?? 0) >= 12
              }
              onClick={() => {
                update(
                  "group",
                  [...(state.filters.customPerkGroups ?? []), perkGroup].map(
                    (group) => JSON.stringify(group),
                  ),
                );
                setPerkGroup([]);
              }}
            >
              Add perk group
            </Button>
            <span className="text-xs text-muted-foreground">
              Any perk in each group; every group must match.
            </span>
          </div>
        )}
        <p id="weapon-search-help" className="text-xs text-muted-foreground">
          Combine categories to narrow results. Required perks match all
          selected perks; perk combos match traits in separate columns.
        </p>
        <details className="text-xs text-muted-foreground">
          <summary className="w-fit cursor-pointer hover:text-foreground">
            Search syntax & saved searches
            {saved.length > 0 ? ` (${saved.length})` : ""}
          </summary>
          <div className="space-y-2 pt-2">
            <p>
              Try <code>type:hc element:solar</code>,{" "}
              <code>perk:&quot;Heal Clip&quot;</code>,{" "}
              <code>trait1:&quot;Reconstruction&quot;</code>,{" "}
              <code>is:craftable</code>, or <code>not:adept</code>. Quotes keep
              multi-word values together. Search URLs can be bookmarked or
              shared.
            </p>
            {saved.map((value) => {
              const label = describeSearchState(
                readSearchState(new URLSearchParams(value)),
              );
              return (
                <div key={value} className="flex items-center gap-2">
                  <button
                    type="button"
                    className="truncate text-left underline underline-offset-4"
                    onClick={() => navigate(new URLSearchParams(value), true)}
                  >
                    {label}
                  </button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Delete saved search ${label}`}
                    onClick={() =>
                      writeSaved(saved.filter((entry) => entry !== value))
                    }
                  >
                    <X />
                  </Button>
                </div>
              );
            })}
          </div>
        </details>
        {Object.keys(state.filters).length > 0 && (
          <div className="flex flex-wrap gap-2" aria-label="Active filters">
            {FILTERS.flatMap(([key, label]) =>
              (state.filters[key] ?? []).map((value) => (
                <Button
                  key={`${key}:${value}`}
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    update(
                      key,
                      (state.filters[key] ?? []).filter((v) => v !== value),
                    )
                  }
                  aria-label={`Remove ${label}: ${value}`}
                >
                  {label}: {value}
                  <X className="size-3" />
                </Button>
              )),
            )}
            {(["adept", "trait1DamagePerks", "trait2DamagePerks"] as const)
              .filter((key) => state.filters[key] != null)
              .map((key) => (
                <Button
                  key={key}
                  size="sm"
                  variant="outline"
                  onClick={() => update(key, [])}
                >
                  {key === "adept"
                    ? state.filters.adept
                      ? "Adept"
                      : "Standard"
                    : `Trait ${key === "trait1DamagePerks" ? 1 : 2}: damage perks`}
                  <X className="size-3" />
                </Button>
              ))}
            {state.filters.customPerkGroups?.map((group, i) => (
              <Button
                key={i}
                size="sm"
                variant="outline"
                className="max-w-full"
                onClick={() =>
                  update(
                    "group",
                    state.filters
                      .customPerkGroups!.filter((_, j) => j !== i)
                      .map((values) => JSON.stringify(values)),
                  )
                }
              >
                <span className="truncate">Any: {group.join(" / ")}</span>
                <X className="size-3" />
              </Button>
            ))}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3 border-b border-foreground/8 pb-3 text-xs">
        <span role="status" className="tabular-nums text-muted-foreground">
          {query.isPending
            ? "Loading weapons…"
            : `${results.length.toLocaleString()} weapons`}
          {state !== deferred ? " · Updating…" : ""}
        </span>
        {active && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => navigate(new URLSearchParams(), true)}
          >
            Clear all
          </Button>
        )}
        <label className="ml-auto flex items-center gap-2 text-muted-foreground">
          Sort
          <select
            aria-label="Sort weapons"
            className="h-8 max-w-40 border border-foreground/10 bg-background px-2 text-foreground"
            value={state.sort}
            onChange={(e) => update("sort", [e.target.value])}
          >
            {SORTS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
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
                    className="flex h-full w-full items-center gap-3 border-b border-foreground/5 px-2 text-left hover:bg-foreground/5 focus-visible:bg-foreground/8 focus-visible:outline-1"
                    onClick={() => setSelected(weapon)}
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
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {weapon.element} · {weapon.type}
                        {weapon.frame ? ` · ${weapon.frame}` : ""}
                      </p>
                    </div>
                    <span className="hidden w-36 shrink-0 truncate text-xs text-muted-foreground xl:block">
                      {weapon.source ?? "—"}
                    </span>
                    <div className="w-20 shrink-0 text-right text-xs text-muted-foreground">
                      <p>{weapon.ammo}</p>
                      <p className="mt-1">
                        {weapon.craftable
                          ? "Craftable"
                          : weapon.adept
                            ? "Adept"
                            : weapon.rarity}
                      </p>
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {data && (
        <p className="shrink-0 text-[11px] text-muted-foreground">
          Catalog updated {data.generatedAt.slice(0, 10)} · Select a weapon to
          explore its perk pool.
        </p>
      )}
      <Dialog
        open={selected != null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl">
          {selected && data && (
            <WeaponDetails
              weapon={selected}
              catalog={data}
              onPerk={(name) => {
                const next = new URLSearchParams();
                next.set("perks", name);
                navigate(next, true);
                setSelected(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
