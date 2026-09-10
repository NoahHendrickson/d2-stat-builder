"use client";

import { TooltipLabel } from "@/components/ui/tooltip";
import {
  useCallback,
  useDeferredValue,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowsDownUp, FunnelSimple, MagnifyingGlass, X } from "@phosphor-icons/react";
import { toast } from "@/lib/toast";
import type { Armory } from "@/lib/armory/fetch";
import type { Manifest } from "@/lib/manifest/load";
import { SUBCLASSES, type Subclass } from "@/lib/armory/fragments";
import { CLASS_NAMES, STAT_HASH_TO_INDEX } from "@/lib/armory/stats";
import {
  balancedTuningIconFromManifest,
  statIconsFromManifest,
} from "@/lib/manifest/stat-icons";
import {
  loadSelections,
  replaceSelections,
} from "@/lib/builder/selection-storage";
import { useQueryClient } from "@tanstack/react-query";
import {
  LOADOUTS_QUERY_KEY,
  useLoadoutMutations,
  useLoadouts,
} from "@/lib/loadouts/use-loadouts";
import {
  collectHashtags,
  collectSetBonusHashes,
  duplicateName,
  filterLoadouts,
  LOADOUT_LIST_SORT_OPTIONS,
  sortSavedLoadouts,
  type LoadoutListSortKey,
} from "@/lib/loadouts/list";
import {
  buildShareUrl,
  parseShareParam,
  SHARE_PARAM,
} from "@/lib/loadouts/share";
import { countMajorStatMods, isMajorStatMod } from "@/lib/dim/mod-hashes";
import { selectionsForLoadout } from "@/lib/loadouts/load-in-builder";
import { loadoutSubclass, withLoadoutSubclass } from "@/lib/loadouts/subclass";
import {
  LOADOUT_SCHEMA_VERSION,
  type SavedLoadout,
  type SavedLoadoutData,
} from "@/lib/loadouts/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/loadouts/confirm-dialog";
import {
  LoadoutDetailsDialog,
  type LoadoutDetailsValues,
  type ModsSection,
} from "@/components/loadouts/loadout-details-dialog";
import {
  modsFromEditor,
  modsSectionFromPlan,
} from "@/lib/loadouts/mod-placement";
import { resolveLoadout } from "@/lib/loadouts/resolve";
import { planLoadoutPlugs } from "@/lib/loadouts/apply-plan";
import { planPiecesFromArmor } from "@/lib/loadouts/plan-pieces";
import { plugInfoFromManifest } from "@/lib/loadouts/plug-info";
import { getModCatalog } from "@/lib/loadouts/mod-options";
import { LoadoutRow } from "@/components/loadouts/loadout-row";
import { LoadoutEditorDrawer } from "@/components/loadouts/loadout-editor-drawer";

// Survives the list remounting (the sidebar moves between the desktop column and the
// mobile drawer at the breakpoint) so a dismissed share-link import stays dismissed.
let dismissedImportParam: string | null = null;

type DialogState =
  | { kind: "none" }
  | { kind: "edit"; loadout: SavedLoadout; mods?: ModsSection }
  | { kind: "delete"; loadout: SavedLoadout };

function toggleIn<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

function filterSummary(labels: string[]): string | undefined {
  if (labels.length === 0) return undefined;
  return labels.length === 1 ? labels[0] : `${labels[0]} +${labels.length - 1}`;
}

function FilterCascade({
  label,
  summary,
  children,
}: {
  label: string;
  summary?: string;
  children: ReactNode;
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger openOnHover>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {summary ? (
          <span className="text-muted-foreground max-w-24 truncate text-xs">
            {summary}
          </span>
        ) : null}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-40">
        {children}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/** Collapsed card height (Figma "Attachment", 1:1209); expanded cards are remeasured. */
const ESTIMATED_ROW_HEIGHT_PX = 104;
/** Vertical gap between cards. */
const ROW_GAP_PX = 10;

/**
 * The sidebar's loadouts section (Figma 1:409): search, the count with sort / filter
 * menus, and the virtualized card list. Rows scroll inside this section — the sidebar
 * itself never scrolls, so the armor summary stays pinned below.
 */
export function LoadoutsList({
  armory,
  manifest,
  onArmoryChanged,
  onNavigate,
}: {
  armory: Armory;
  manifest: Manifest;
  onArmoryChanged: () => void;
  /** Called after an action that switches views (the mobile drawer closes itself). */
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  // Read at click time only, via a ref, so a route change doesn't change
  // optimizeLoadout's identity and re-render every visible row. Written in a layout
  // effect rather than during render so a discarded render can't leave it stale.
  const pathnameRef = useRef(pathname);
  useLayoutEffect(() => {
    pathnameRef.current = pathname;
  });
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const loadouts = useLoadouts();
  const { create, update, remove } = useLoadoutMutations();

  const [query, setQuery] = useState("");
  // The filter pass runs on the deferred value so typing never waits on it.
  const deferredQuery = useDeferredValue(query);
  const [classFilter, setClassFilter] = useState<number[]>([]);
  const [subclassFilter, setSubclassFilter] = useState<Subclass[]>([]);
  const [setFilter, setSetFilter] = useState<number[]>([]);
  const [sortKey, setSortKey] = useState<LoadoutListSortKey>("edited");
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  // Expanded rows, by id — kept here (not in the row) so it survives virtualization.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const toggleExpanded = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  // A share link lands here with ?import=<json>; offer to save a copy.
  const importParam = searchParams.get(SHARE_PARAM);
  const importData = useMemo(() => parseShareParam(importParam), [importParam]);
  const [importDismissed, setImportDismissed] = useState<string | null>(
    () => dismissedImportParam,
  );
  const importOpen =
    importData !== null &&
    importDismissed !== importParam &&
    dialog.kind === "none";

  const clearImportParam = () => {
    dismissedImportParam = importParam;
    setImportDismissed(importParam);
    router.replace(pathname);
  };

  const pieceMap = useMemo(
    () => new Map(armory.pieces.map((p) => [p.instanceId, p])),
    [armory.pieces],
  );
  const statIcons = useMemo(() => statIconsFromManifest(manifest), [manifest]);
  const balancedTuningIcon = useMemo(
    () => balancedTuningIconFromManifest(manifest),
    [manifest],
  );
  const ownedClasses = useMemo(
    () =>
      [...new Set(armory.characters.map((c) => c.classType))].filter(
        (c) => CLASS_NAMES[c] !== undefined,
      ),
    [armory.characters],
  );

  const all = useMemo(() => loadouts.data ?? [], [loadouts.data]);
  // Captured once per mount: relative "edited … ago" labels don't need to tick.
  const [now] = useState(() => Date.now());
  const hashtags = useMemo(() => collectHashtags(all), [all]);
  const setBonusOptions = useMemo(() => {
    return collectSetBonusHashes(all)
      .map((hash) => ({
        hash,
        name:
          manifest.def("DestinyEquipableItemSetDefinition", hash)?.displayProperties
            ?.name ?? `Set ${hash}`,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [all, manifest]);
  const shown = useMemo(
    () =>
      sortSavedLoadouts(
        filterLoadouts(all, {
          query: deferredQuery,
          classTypes: classFilter,
          subclasses: subclassFilter,
          setHashes: setFilter,
          setName: (hash) =>
            manifest.def("DestinyEquipableItemSetDefinition", hash)?.displayProperties
              ?.name,
        }),
        sortKey,
      ),
    [all, deferredQuery, classFilter, subclassFilter, setFilter, sortKey, manifest],
  );
  const activeTag = query.trim().toLowerCase().startsWith("#")
    ? query.trim().toLowerCase().slice(1)
    : null;

  // Rows are virtualized against the section's own scroller: only the visible slice
  // (plus overscan) resolves items and renders, however long the list gets.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: shown.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => ESTIMATED_ROW_HEIGHT_PX,
    overscan: 6,
    gap: ROW_GAP_PX,
    getItemKey: (index) => shown[index].id,
  });

  const onMutationError = (err: { notConfigured: boolean; message: string }) =>
    toast.error(
      err.notConfigured
        ? "Loadout storage isn't configured — set DATABASE_URL"
        : err.message,
    );

  // Row callbacks take the loadout as an argument and are memoized so the rows
  // (React.memo) only re-render when their own data changes.

  /** Open Edit; the mod picker is available when every piece is still in the armory. */
  const openEdit = useCallback(
    (saved: SavedLoadout) => {
      const resolved = resolveLoadout(saved.loadout, pieceMap, manifest);
      let mods: ModsSection | undefined;
      if (resolved.armor.length > 0 && !resolved.missing) {
        const pieces = resolved.armor.map((a) => a.piece!);
        const plan = planLoadoutPlugs({
          pieces: planPiecesFromArmor(pieces, manifest),
          modHashes: saved.loadout.parameters.mods,
          plugInfo: plugInfoFromManifest(manifest),
          placements: saved.modPlacement,
        });
        mods = modsSectionFromPlan(
          pieces,
          getModCatalog(manifest),
          plan,
          armory.insertablePlugs,
        );
      }
      setDialog({ kind: "edit", loadout: saved, mods });
    },
    [pieceMap, manifest, armory.insertablePlugs],
  );
  const openDelete = useCallback(
    (saved: SavedLoadout) => setDialog({ kind: "delete", loadout: saved }),
    [],
  );

  const editLoadout = ({ name, notes, placement, subclass }: LoadoutDetailsValues) => {
    if (dialog.kind !== "edit") return;
    const { id, loadout, optimizer, builder, modPlacement } = dialog.loadout;
    // Mods the planner couldn't place on the current armor are kept, not dropped.
    const mods =
      placement && dialog.mods
        ? modsFromEditor(dialog.mods, placement)
        : loadout.parameters.mods;
    const nextPlacement = placement ?? modPlacement;
    const next: SavedLoadoutData = {
      version: LOADOUT_SCHEMA_VERSION,
      loadout: {
        ...loadout,
        name,
        ...(notes ? { notes } : { notes: undefined }),
        parameters: { ...loadout.parameters, mods },
      },
      ...(optimizer ? { optimizer } : {}),
      ...(builder ? { builder } : {}),
      ...(nextPlacement && Object.keys(nextPlacement).length > 0
        ? { modPlacement: nextPlacement }
        : {}),
    };
    update.mutate(
      { id, data: withLoadoutSubclass(next, subclass, manifest,
        dialog.mods?.pieces[0]?.stats.map((_, i) => dialog.mods!.pieces.reduce((sum, piece) => sum + piece.stats[i], 0)),
      ) },
      {
        onSuccess: () => {
          setDialog({ kind: "none" });
          toast.success("Loadout updated");
        },
        onError: onMutationError,
      },
    );
  };

  const deleteLoadout = () => {
    if (dialog.kind !== "delete") return;
    remove.mutate(dialog.loadout.id, {
      onSuccess: () => {
        setDialog({ kind: "none" });
        toast.success("Loadout deleted");
      },
      onError: onMutationError,
    });
  };

  const createMutate = create.mutate;
  const duplicateLoadout = useCallback(
    (saved: SavedLoadout) => {
      // Read the names at click time (not via a dependency) so this callback — and with
      // it every memoized row — doesn't change identity after each mutation.
      const existingNames = (
        queryClient.getQueryData<SavedLoadout[]>(LOADOUTS_QUERY_KEY) ?? []
      ).map((l) => l.loadout.name);
      const data: SavedLoadoutData = {
        version: LOADOUT_SCHEMA_VERSION,
        loadout: {
          ...saved.loadout,
          name: duplicateName(saved.loadout.name, existingNames),
        },
        ...(saved.optimizer ? { optimizer: saved.optimizer } : {}),
        ...(saved.builder ? { builder: saved.builder } : {}),
        ...(saved.modPlacement ? { modPlacement: saved.modPlacement } : {}),
      };
      createMutate(data, {
        onSuccess: () => toast.success("Loadout duplicated"),
        onError: onMutationError,
      });
    },
    [createMutate, queryClient],
  );

  const importLoadout = ({ name, notes, subclass }: LoadoutDetailsValues) => {
    if (!importData) return;
    const data: SavedLoadoutData = {
      ...importData,
      loadout: {
        ...importData.loadout,
        name,
        ...(notes ? { notes } : { notes: undefined }),
      },
    };
    create.mutate(withLoadoutSubclass(data, subclass, manifest), {
      onSuccess: () => {
        clearImportParam();
        toast.success("Loadout imported");
      },
      onError: onMutationError,
    });
  };

  const shareLoadout = useCallback((saved: SavedLoadout) => {
    const url = buildShareUrl(window.location.origin, saved);
    navigator.clipboard.writeText(url).then(
      () =>
        toast.success(
          "Share link copied",
          "Anyone with the link can import a copy",
        ),
      () => toast.error("Couldn't copy to clipboard"),
    );
  }, []);

  /**
   * "Optimize": push the loadout's stat targets, exotic, set bonuses, fragments,
   * and major-mod count into the optimizer and show it.
   */
  const optimizeLoadout = useCallback(
    (saved: SavedLoadout) => {
      const exoticName = manifest.def(
        "DestinyInventoryItemDefinition",
        saved.loadout.parameters.exoticArmorHash,
      )?.displayProperties?.name;
      replaceSelections(
        selectionsForLoadout(saved, loadSelections(), {
          statHashToIndex: STAT_HASH_TO_INDEX,
          exoticName,
          subclass: resolveLoadout(saved.loadout, pieceMap, manifest).subclass,
          major: countMajorStatMods(saved.loadout.parameters.mods, (hash) =>
            isMajorStatMod(manifest.def("DestinyInventoryItemDefinition", hash)),
          ),
        }),
      );
      if (pathnameRef.current !== "/") router.push("/");
      onNavigate?.();
    },
    [manifest, pieceMap, router, onNavigate],
  );

  const editorLoadout = dialog.kind === "edit" ? dialog.loadout : undefined;
  const editorMods = dialog.kind === "edit" ? dialog.mods : undefined;
  const editorSubclass = useMemo(() => {
    if (!editorLoadout || editorLoadout.loadout.classType >= 3) return undefined;
    return {
      manifest,
      classType: editorLoadout.loadout.classType,
      initial: loadoutSubclass(editorLoadout.loadout),
    };
  }, [editorLoadout, manifest]);

  const sortLabel =
    LOADOUT_LIST_SORT_OPTIONS.find((o) => o.key === sortKey)?.label ?? "Sort";
  const filterCount =
    classFilter.length +
    subclassFilter.length +
    setFilter.length +
    (activeTag !== null ? 1 : 0);
  const countLabel = loadouts.isPending
    ? "Loading…"
    : shown.length === all.length
      ? `${all.length} ${all.length === 1 ? "Loadout" : "Loadouts"}`
      : `${shown.length} of ${all.length} loadouts`;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-col gap-1 px-4">
        <div className="relative">
          <MagnifyingGlass
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 z-10 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your loadouts"
            aria-label="Search loadouts (names, notes, set bonuses, or #hashtags)"
            className="pl-8 pr-8 [&::-webkit-search-cancel-button]:hidden"
          />
          {query.length > 0 && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery("")}
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-[4px] outline-none focus-visible:ring-3"
            >
              <X weight="bold" className="size-3.5" aria-hidden />
            </button>
          )}
        </div>

        <div className="flex items-center justify-between pl-1">
          <span className="text-sm tabular-nums" aria-live="polite">
            {countLabel}
          </span>
          <div className="flex items-center gap-px">
            <DropdownMenu>
              <TooltipLabel label={`Sort by ${sortLabel}`}>
                <DropdownMenuTrigger
                  render={<Button variant="ghost" size="icon" />}
                  aria-label={`Sort by ${sortLabel}`}
                >
                  <ArrowsDownUp aria-hidden />
                </DropdownMenuTrigger>
              </TooltipLabel>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                  {LOADOUT_LIST_SORT_OPTIONS.map((o) => (
                    <DropdownMenuCheckboxItem
                      key={o.key}
                      checked={sortKey === o.key}
                      onCheckedChange={() => setSortKey(o.key)}
                    >
                      {o.label}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <TooltipLabel label="Filter loadouts">
                <DropdownMenuTrigger
                  render={
                    <Button variant="ghost" size="icon" className="relative" />
                  }
                  aria-label={
                    filterCount > 0
                      ? `Filter loadouts, ${filterCount} active`
                      : "Filter loadouts"
                  }
                >
                  <FunnelSimple aria-hidden />
                  {filterCount > 0 && (
                    <Badge
                      variant="emphatic"
                      className="absolute top-0.5 right-0.5 h-3.5 min-w-3.5 px-1 text-[9px] leading-none"
                    >
                      {filterCount}
                    </Badge>
                  )}
                </DropdownMenuTrigger>
              </TooltipLabel>
              <DropdownMenuContent align="end" className="w-44">
                <FilterCascade
                  label="Class"
                  summary={filterSummary(classFilter.map((c) => CLASS_NAMES[c]))}
                >
                  {ownedClasses.map((c) => (
                    <DropdownMenuCheckboxItem
                      key={c}
                      indicator="start"
                      closeOnClick={false}
                      checked={classFilter.includes(c)}
                      onCheckedChange={() =>
                        setClassFilter((prev) => toggleIn(prev, c))
                      }
                    >
                      {CLASS_NAMES[c]}
                    </DropdownMenuCheckboxItem>
                  ))}
                </FilterCascade>
                <FilterCascade
                  label="Subclass"
                  summary={filterSummary(subclassFilter)}
                >
                  {SUBCLASSES.map((sc) => (
                    <DropdownMenuCheckboxItem
                      key={sc}
                      indicator="start"
                      closeOnClick={false}
                      checked={subclassFilter.includes(sc)}
                      onCheckedChange={() =>
                        setSubclassFilter((prev) => toggleIn(prev, sc))
                      }
                    >
                      {sc}
                    </DropdownMenuCheckboxItem>
                  ))}
                </FilterCascade>
                <FilterCascade
                  label="Set bonuses"
                  summary={filterSummary(
                    setFilter.map(
                      (hash) =>
                        setBonusOptions.find((s) => s.hash === hash)?.name ??
                        `Set ${hash}`,
                    ),
                  )}
                >
                  {setBonusOptions.map((s) => (
                    <DropdownMenuCheckboxItem
                      key={s.hash}
                      indicator="start"
                      closeOnClick={false}
                      checked={setFilter.includes(s.hash)}
                      onCheckedChange={() =>
                        setSetFilter((prev) => toggleIn(prev, s.hash))
                      }
                    >
                      {s.name}
                    </DropdownMenuCheckboxItem>
                  ))}
                </FilterCascade>
                {hashtags.length > 0 && (
                  <FilterCascade
                    label="Hashtag"
                    summary={activeTag !== null ? `#${activeTag}` : undefined}
                  >
                    {hashtags.map((tag) => (
                      <DropdownMenuCheckboxItem
                        key={tag}
                        indicator="start"
                        closeOnClick={false}
                        checked={activeTag === tag}
                        onCheckedChange={(checked) =>
                          setQuery(checked ? `#${tag}` : "")
                        }
                      >
                        #{tag}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </FilterCascade>
                )}
                {filterCount > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => {
                        setClassFilter([]);
                        setSubclassFilter([]);
                        setSetFilter([]);
                        if (activeTag !== null) setQuery("");
                      }}
                    >
                      Clear filters
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {loadouts.isError ? (
        <p className="text-muted-foreground px-4 text-sm">
          {loadouts.error.notConfigured
            ? "Loadout storage isn't configured on this deployment yet — set DATABASE_URL (see .env.example)."
            : `Couldn't load your loadouts — ${loadouts.error.message}`}
        </p>
      ) : loadouts.isPending ? (
        <p className="text-muted-foreground px-4 text-sm">
          Loading your loadouts…
        </p>
      ) : all.length === 0 ? (
        <p className="text-muted-foreground px-4 text-sm">
          No saved loadouts yet. Expand a build in the optimizer and choose
          Save.
        </p>
      ) : shown.length === 0 ? (
        <p className="text-muted-foreground px-4 text-sm">No loadouts match.</p>
      ) : (
        <div
          ref={setScrollEl}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        >
          <div
            className="relative w-full"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((item) => {
              const saved = shown[item.index];
              return (
                <div
                  key={item.key}
                  ref={virtualizer.measureElement}
                  data-index={item.index}
                  className="absolute top-0 left-0 w-full"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <LoadoutRow
                    saved={saved}
                    open={expanded.has(saved.id)}
                    onToggle={toggleExpanded}
                    pieceMap={pieceMap}
                    manifest={manifest}
                    characters={armory.characters}
                    statIcons={statIcons}
                    balancedTuningIcon={balancedTuningIcon}
                    now={now}
                    onEdit={openEdit}
                    onDuplicate={duplicateLoadout}
                    onDelete={openDelete}
                    onShare={shareLoadout}
                    onOptimize={optimizeLoadout}
                    onArmoryChanged={onArmoryChanged}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      <LoadoutEditorDrawer
        open={dialog.kind === "edit"}
        onOpenChange={(open) => !open && setDialog({ kind: "none" })}
        formKey={dialog.kind === "edit" ? dialog.loadout.id : undefined}
        title="Edit loadout"
        description={
          dialog.kind === "edit" && !dialog.mods
            ? "Mods can't be edited while a piece is missing from your inventory."
            : undefined
        }
        submitLabel="Save changes"
        initialName={dialog.kind === "edit" ? dialog.loadout.loadout.name : ""}
        initialNotes={
          dialog.kind === "edit" ? (dialog.loadout.loadout.notes ?? "") : ""
        }
        mods={editorMods}
        subclass={editorSubclass}
        busy={update.isPending}
        onSubmit={editLoadout}
      />
      <ConfirmDialog
        open={dialog.kind === "delete"}
        onOpenChange={(open) => !open && setDialog({ kind: "none" })}
        title="Delete loadout?"
        description={
          dialog.kind === "delete"
            ? `“${dialog.loadout.loadout.name}” will be removed. This can't be undone.`
            : undefined
        }
        confirmLabel="Delete"
        busy={remove.isPending}
        onConfirm={deleteLoadout}
      />
      <LoadoutDetailsDialog
        open={importOpen}
        onOpenChange={(open) => !open && clearImportParam()}
        title="Import shared loadout"
        description="Save a copy of this loadout to your account. Items you don't own will show as missing."
        submitLabel="Import"
        initialName={importData?.loadout.name ?? ""}
        initialNotes={importData?.loadout.notes ?? ""}
        subclass={importData && importData.loadout.classType < 3 ? {
          manifest, classType: importData.loadout.classType,
          initial: loadoutSubclass(importData.loadout),
        } : undefined}
        busy={create.isPending}
        onSubmit={importLoadout}
      />
    </div>
  );
}
