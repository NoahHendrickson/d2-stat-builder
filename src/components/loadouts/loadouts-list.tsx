"use client";

import { TooltipLabel } from "@/components/ui/tooltip";
import {
  useCallback,
  useDeferredValue,
  useMemo,
  useState,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUpDownIcon, Search01Icon } from "@hugeicons/core-free-icons";
import { toast, type Notifier } from "@/lib/toast";
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
import { withLoadoutWeapons } from "@/lib/loadouts/weapons";
import { weaponSlotOfHash } from "@/lib/armory/weapons";
import {
  LOADOUT_SCHEMA_VERSION,
  MAX_TAGS,
  type SavedLoadout,
  type SavedLoadoutData,
} from "@/lib/loadouts/types";
import { FilterMultiselect } from "@/components/armor-table/filter-multiselect";
import { Button } from "@/components/ui/button";
import { Input, SearchClearButton } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/loadouts/confirm-dialog";
import { type ModsSection } from "@/lib/loadouts/mod-placement";
import { commitLoadout, modsSectionForPieces } from "@/lib/loadouts/commit";
import { resolveLoadout } from "@/lib/loadouts/resolve";
import { LoadoutRow } from "@/components/loadouts/loadout-row";
import {
  LoadoutEditorDrawer,
  type LoadoutDetailsValues,
} from "@/components/loadouts/loadout-editor-drawer";

// Survives the list remounting (leaving the page and coming back) so a dismissed
// share-link import stays dismissed.
let dismissedImportParam: string | null = null;

type DialogState =
  | { kind: "none" }
  | { kind: "edit"; loadout: SavedLoadout; mods?: ModsSection }
  | { kind: "delete"; loadout: SavedLoadout };

const SUBCLASS_OPTIONS = SUBCLASSES.map((sc) => ({ value: sc, label: sc }));

/** Card height with the breakdown closed (wide layout); every card is remeasured. */
const ESTIMATED_ROW_HEIGHT_PX = 300;
/** Vertical gap between cards. */
const ROW_GAP_PX = 12;

/**
 * The loadouts page body (Figma 69:865): search, then the count with sort / filter
 * menus, and the virtualized card list. Rows scroll inside this section, so the
 * search and filters stay pinned above them.
 */
export function LoadoutsList({
  armory,
  provisional = false,
  manifest,
  onArmoryChanged,
}: {
  armory: Armory;
  /** `armory` is last visit's copy; applying a loadout waits for the live profile. */
  provisional?: boolean;
  manifest: Manifest;
  onArmoryChanged: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const loadouts = useLoadouts();
  const { create, update, remove, setTag } = useLoadoutMutations();

  const [query, setQuery] = useState("");
  // The filter pass runs on the deferred value so typing never waits on it.
  const deferredQuery = useDeferredValue(query);
  const [classFilter, setClassFilter] = useState<number[]>([]);
  const [subclassFilter, setSubclassFilter] = useState<Subclass[]>([]);
  const [setFilter, setSetFilter] = useState<number[]>([]);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<LoadoutListSortKey>("created");
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
  const weaponMap = useMemo(
    () => new Map((armory.weapons ?? []).map((w) => [w.instanceId, w])),
    [armory.weapons],
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
          tags: tagFilter,
          setName: (hash) =>
            manifest.def("DestinyEquipableItemSetDefinition", hash)?.displayProperties
              ?.name,
        }),
        sortKey,
      ),
    [all, deferredQuery, classFilter, subclassFilter, setFilter, tagFilter, sortKey, manifest],
  );

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

  /** Reports a failed save on the action's spinner toast. */
  const mutationError = (pending: Notifier) => (err: { notConfigured: boolean; message: string }) =>
    pending.error(
      err.notConfigured
        ? "Loadout storage isn't configured — set DATABASE_URL"
        : err.message,
    );

  // Row callbacks take the loadout as an argument and are memoized so the rows
  // (React.memo) only re-render when their own data changes.

  /** Open Edit; the mod picker is available when every piece is still in the armory. */
  const openEdit = useCallback(
    (saved: SavedLoadout) => {
      const resolved = resolveLoadout(saved.loadout, pieceMap, manifest, weaponMap);
      let mods: ModsSection | undefined;
      if (resolved.armor.length > 0 && !resolved.missing) {
        const pieces = resolved.armor.map((a) => a.piece!);
        mods = modsSectionForPieces(
          pieces,
          saved.loadout.parameters.mods,
          manifest,
          armory.insertablePlugs,
          saved.modPlacement,
        );
      }
      setDialog({ kind: "edit", loadout: saved, mods });
    },
    [pieceMap, weaponMap, manifest, armory.insertablePlugs],
  );
  const openDelete = useCallback(
    (saved: SavedLoadout) => setDialog({ kind: "delete", loadout: saved }),
    [],
  );

  const editLoadout = ({
    name,
    notes,
    placement,
    desiredStatMods,
    subclass,
    weapons,
    stats,
  }: LoadoutDetailsValues) => {
    if (dialog.kind !== "edit") return;
    const { id, loadout, optimizer, builder, modPlacement } = dialog.loadout;
    const next: SavedLoadoutData = {
      version: LOADOUT_SCHEMA_VERSION,
      loadout: {
        ...(weapons
          ? withLoadoutWeapons(
              loadout,
              weapons,
              (ref) => weaponSlotOfHash(manifest, ref.hash) !== undefined,
            )
          : loadout),
        name,
        ...(notes ? { notes } : { notes: undefined }),
      },
      ...(optimizer ? { optimizer } : {}),
      ...(builder ? { builder } : {}),
      ...(modPlacement && Object.keys(modPlacement).length > 0
        ? { modPlacement }
        : {}),
    };
    const pending = toast.loading("Saving loadout");
    update.mutate(
      {
        id,
        data: commitLoadout(
          next,
          manifest,
          { placement, desiredStatMods, subclass, stats },
          dialog.mods,
        ),
      },
      {
        onSuccess: () => {
          setDialog({ kind: "none" });
          pending.success("Loadout updated");
        },
        onError: mutationError(pending),
      },
    );
  };

  const deleteLoadout = () => {
    if (dialog.kind !== "delete") return;
    const pending = toast.loading("Deleting loadout");
    remove.mutate(dialog.loadout.id, {
      onSuccess: () => {
        setDialog({ kind: "none" });
        pending.success("Loadout deleted");
      },
      onError: mutationError(pending),
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
      const pending = toast.loading("Duplicating loadout");
      createMutate(data, {
        onSuccess: () => pending.success("Loadout duplicated"),
        onError: mutationError(pending),
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
    const pending = toast.loading("Importing loadout");
    create.mutate(withLoadoutSubclass(data, subclass, manifest), {
      onSuccess: () => {
        clearImportParam();
        pending.success("Loadout imported");
      },
      onError: mutationError(pending),
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

  const setLoadoutTag = useCallback(
    (saved: SavedLoadout, tag: string, present: boolean) => {
      const result = setTag(saved.id, tag, present);
      if (result.status !== "refused") return;
      toast.error(
        result.reason === "cap"
          ? `A loadout can have at most ${MAX_TAGS} tags`
          : result.reason === "overflow"
            ? "Notes are too long to add that tag"
            : "That's not a valid tag",
      );
    },
    [setTag],
  );

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
      router.push("/");
    },
    [manifest, pieceMap, router],
  );

  const editorLoadout = dialog.kind === "edit" ? dialog.loadout : undefined;
  const editorMods = dialog.kind === "edit" ? dialog.mods : undefined;
  const editorWeapons = useMemo(() => {
    // Without the weapon list (an armory cached before weapons were tracked) the pickers
    // would be empty and a save would look like "remove every weapon" — so no section.
    if (dialog.kind !== "edit" || !armory.weapons) return undefined;
    return {
      manifest,
      owned: armory.weapons,
      initial: dialog.loadout.loadout.equipped.filter(
        (ref) => weaponSlotOfHash(manifest, ref.hash) !== undefined,
      ),
    };
  }, [dialog, armory.weapons, manifest]);
  const editorSubclass = useMemo(() => {
    if (!editorLoadout || editorLoadout.loadout.classType >= 3) return undefined;
    return {
      manifest,
      classType: editorLoadout.loadout.classType,
      initial: loadoutSubclass(editorLoadout.loadout),
    };
  }, [editorLoadout, manifest]);
  const importSubclass = useMemo(() => {
    if (!importData || importData.loadout.classType >= 3) return undefined;
    return {
      manifest,
      classType: importData.loadout.classType,
      initial: loadoutSubclass(importData.loadout),
    };
  }, [importData, manifest]);

  const sortLabel =
    LOADOUT_LIST_SORT_OPTIONS.find((o) => o.key === sortKey)?.label ?? "Sort";
  const classOptions = ownedClasses.map((c) => ({ value: c, label: CLASS_NAMES[c] }));
  const setOptions = setBonusOptions.map((o) => ({ value: o.hash, label: o.name }));
  const tagOptions = [...new Set([...hashtags, ...tagFilter])].map((t) => ({
    value: t,
    label: `#${t}`,
  }));
  const countLabel = loadouts.isPending
    ? "Loading…"
    : shown.length === all.length
      ? `${all.length} ${all.length === 1 ? "Loadout" : "Loadouts"}`
      : `${shown.length} of ${all.length} loadouts`;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-60 sm:max-w-sm">
          <HugeiconsIcon icon={Search01Icon}
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 z-10 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your loadouts"
            aria-label="Search loadouts (names, notes, set bonuses, or #hashtags)"
            className="pl-8 pr-8"
          />
          {query.length > 0 && <SearchClearButton onClick={() => setQuery("")} />}
        </div>

        <FilterMultiselect
          label="Class"
          allLabel="All classes"
          options={classOptions}
          value={classFilter}
          onChange={setClassFilter}
          className="max-w-56"
        />
        <FilterMultiselect
          label="Subclass"
          allLabel="All subclasses"
          options={SUBCLASS_OPTIONS}
          value={subclassFilter}
          onChange={setSubclassFilter}
          className="max-w-56"
        />
        {(setBonusOptions.length > 0 || setFilter.length > 0) && (
          <FilterMultiselect
            label="Set bonus"
            allLabel="All set bonuses"
            searchable
            options={setOptions}
            value={setFilter}
            onChange={setSetFilter}
            className="max-w-64"
          />
        )}
        {(hashtags.length > 0 || tagFilter.length > 0) && (
          <FilterMultiselect
            label="Tag"
            allLabel="All tags"
            searchable
            options={tagOptions}
            value={tagFilter}
            onChange={setTagFilter}
            className="max-w-56"
          />
        )}

        <div className="ml-auto flex items-center gap-3">
          <span className="text-muted-foreground text-sm tabular-nums" aria-live="polite">
            {countLabel}
          </span>
          <DropdownMenu>
            <TooltipLabel label={`Sort by ${sortLabel}`}>
              <DropdownMenuTrigger
                render={<Button variant="default" size="icon" />}
                aria-label={`Sort by ${sortLabel}`}
              >
                <HugeiconsIcon icon={ArrowUpDownIcon} aria-hidden />
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

        </div>
      </div>

      {loadouts.isError ? (
        <p className="text-muted-foreground text-sm">
          {loadouts.error.notConfigured
            ? "Loadout storage isn't configured on this deployment yet — set DATABASE_URL (see .env.example)."
            : `Couldn't load your loadouts — ${loadouts.error.message}`}
        </p>
      ) : loadouts.isPending ? (
        <p className="text-muted-foreground text-sm">
          Loading your loadouts…
        </p>
      ) : all.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No saved loadouts yet. Expand a build in the optimizer and choose
          Save.
        </p>
      ) : shown.length === 0 ? (
        <p className="text-muted-foreground text-sm">No loadouts match.</p>
      ) : (
        <div
          ref={setScrollEl}
          className="d2-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain"
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
                    weaponMap={weaponMap}
                    weapons={armory.weapons}
                    provisional={provisional}
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
                    allTags={hashtags}
                    onSetTag={setLoadoutTag}
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
        weapons={editorWeapons}
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
      <LoadoutEditorDrawer
        open={importOpen}
        onOpenChange={(open) => !open && clearImportParam()}
        formKey={importParam ?? undefined}
        title="Import shared loadout"
        description="Save a copy of this loadout to your account. Items you don't own will show as missing."
        submitLabel="Import"
        initialName={importData?.loadout.name ?? ""}
        initialNotes={importData?.loadout.notes ?? ""}
        subclass={importSubclass}
        busy={create.isPending}
        onSubmit={importLoadout}
      />
    </div>
  );
}
