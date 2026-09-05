"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CaretDown, MagnifyingGlass } from "@phosphor-icons/react";
import { toast } from "@/lib/toast";
import type { Armory } from "@/lib/armory/fetch";
import type { Manifest } from "@/lib/manifest/load";
import { CLASS_NAMES, STAT_HASH_TO_INDEX } from "@/lib/armory/stats";
import {
  balancedTuningIconFromManifest,
  statIconsFromManifest,
} from "@/lib/manifest/stat-icons";
import { loadSelections, saveSelections } from "@/lib/builder/selection-storage";
import { useLoadoutMutations, useLoadouts } from "@/lib/loadouts/use-loadouts";
import {
  collectHashtags,
  duplicateName,
  filterLoadouts,
  LOADOUT_LIST_SORT_OPTIONS,
  sortSavedLoadouts,
  type LoadoutListSortKey,
} from "@/lib/loadouts/list";
import { buildShareUrl, parseShareParam, SHARE_PARAM } from "@/lib/loadouts/share";
import { selectionsForLoadout } from "@/lib/loadouts/load-in-builder";
import {
  LOADOUT_SCHEMA_VERSION,
  type SavedLoadout,
  type SavedLoadoutData,
} from "@/lib/loadouts/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/loadouts/confirm-dialog";
import {
  LoadoutDetailsDialog,
  type LoadoutDetailsValues,
  type ModsSection,
} from "@/components/loadouts/loadout-details-dialog";
import { placementToMods } from "@/components/loadouts/loadout-mods-editor";
import { resolveLoadout } from "@/lib/loadouts/resolve";
import { planLoadoutPlugs } from "@/lib/loadouts/apply-plan";
import { planPiecesFromArmor } from "@/lib/loadouts/plan-pieces";
import { plugInfoFromManifest } from "@/lib/loadouts/plug-info";
import { getModCatalog } from "@/lib/loadouts/mod-options";
import { LoadoutRow } from "@/components/loadouts/loadout-row";
import { cn } from "@/lib/utils";

type DialogState =
  | { kind: "none" }
  | { kind: "edit"; loadout: SavedLoadout; mods?: ModsSection }
  | { kind: "delete"; loadout: SavedLoadout };

export function LoadoutsList({
  armory,
  manifest,
  onArmoryChanged,
}: {
  armory: Armory;
  manifest: Manifest;
  onArmoryChanged: () => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const loadouts = useLoadouts();
  const { create, update, remove } = useLoadoutMutations();

  const [query, setQuery] = useState("");
  const [classFilter, setClassFilter] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<LoadoutListSortKey>("edited");
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });

  // A share link lands here with ?import=<json>; offer to save a copy.
  const importParam = searchParams.get(SHARE_PARAM);
  const importData = useMemo(() => parseShareParam(importParam), [importParam]);
  const [importDismissed, setImportDismissed] = useState<string | null>(null);
  const importOpen =
    importData !== null && importDismissed !== importParam && dialog.kind === "none";

  const clearImportParam = () => {
    setImportDismissed(importParam);
    router.replace("/loadouts");
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
  const shown = useMemo(
    () => sortSavedLoadouts(filterLoadouts(all, { query, classType: classFilter }), sortKey),
    [all, query, classFilter, sortKey],
  );
  const existingNames = useMemo(() => all.map((l) => l.loadout.name), [all]);

  const onMutationError = (err: { notConfigured: boolean; message: string }) =>
    toast.error(
      err.notConfigured
        ? "Loadout storage isn't configured — set DATABASE_URL"
        : err.message,
    );

  /** Open Edit; the mod picker is available when every piece is still in the armory. */
  const openEdit = (saved: SavedLoadout) => {
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
      mods = { pieces, catalog: getModCatalog(manifest), initial: plan.assigned };
    }
    setDialog({ kind: "edit", loadout: saved, mods });
  };

  const editLoadout = ({ name, notes, placement }: LoadoutDetailsValues) => {
    if (dialog.kind !== "edit") return;
    const { id, loadout, optimizer, builder, modPlacement } = dialog.loadout;
    const mods =
      placement && dialog.mods ? placementToMods(placement, dialog.mods.pieces) : loadout.parameters.mods;
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
      { id, data: next },
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

  const duplicateLoadout = (saved: SavedLoadout) => {
    const data: SavedLoadoutData = {
      version: LOADOUT_SCHEMA_VERSION,
      loadout: { ...saved.loadout, name: duplicateName(saved.loadout.name, existingNames) },
      ...(saved.optimizer ? { optimizer: saved.optimizer } : {}),
      ...(saved.builder ? { builder: saved.builder } : {}),
      ...(saved.modPlacement ? { modPlacement: saved.modPlacement } : {}),
    };
    create.mutate(data, {
      onSuccess: () => toast.success("Loadout duplicated"),
      onError: onMutationError,
    });
  };

  const importLoadout = ({ name, notes }: { name: string; notes: string }) => {
    if (!importData) return;
    const data: SavedLoadoutData = {
      ...importData,
      loadout: { ...importData.loadout, name, ...(notes ? { notes } : { notes: undefined }) },
    };
    create.mutate(data, {
      onSuccess: () => {
        clearImportParam();
        toast.success("Loadout imported");
      },
      onError: onMutationError,
    });
  };

  const shareLoadout = async (saved: SavedLoadout) => {
    const url = buildShareUrl(window.location.origin, saved);
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Share link copied", "Anyone with the link can import a copy");
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  };

  const loadInBuilder = (saved: SavedLoadout) => {
    const exoticName = manifest.def(
      "DestinyInventoryItemDefinition",
      saved.loadout.parameters.exoticArmorHash,
    )?.displayProperties?.name;
    saveSelections(
      selectionsForLoadout(saved, loadSelections(), {
        statHashToIndex: STAT_HASH_TO_INDEX,
        exoticName,
      }),
    );
    router.push("/");
  };

  const sortLabel =
    LOADOUT_LIST_SORT_OPTIONS.find((o) => o.key === sortKey)?.label ?? "Sort";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-medium">Loadouts</h1>
        <span className="text-muted-foreground text-sm tabular-nums" aria-live="polite">
          {loadouts.isPending ? "Loading…" : `${shown.length} / ${all.length}`}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {ownedClasses.length > 1 && (
            <Tabs
              value={classFilter === null ? "all" : String(classFilter)}
              onValueChange={(v) => setClassFilter(v === "all" ? null : Number(v))}
            >
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                {ownedClasses.map((c) => (
                  <TabsTrigger key={c} value={String(c)}>
                    {CLASS_NAMES[c]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="outline" size="sm" />}
              aria-label={`Sort by ${sortLabel}`}
            >
              {sortLabel}
              <CaretDown weight="bold" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {LOADOUT_LIST_SORT_OPTIONS.map((o) => (
                <DropdownMenuItem key={o.key} onClick={() => setSortKey(o.key)}>
                  {o.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="relative">
        <MagnifyingGlass
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 z-10 size-3.5 -translate-y-1/2"
          aria-hidden
        />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search names, notes, or #hashtags"
          aria-label="Search loadouts"
          className="pl-7"
        />
      </div>

      {hashtags.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Hashtag filters">
          {hashtags.map((tag) => {
            const active = query.trim().toLowerCase() === `#${tag}`;
            return (
              <button
                key={tag}
                type="button"
                onClick={() => setQuery(active ? "" : `#${tag}`)}
                aria-pressed={active}
                className="cursor-pointer"
              >
                <Badge
                  variant={active ? "default" : "outline"}
                  className={cn("px-2", !active && "text-muted-foreground")}
                >
                  #{tag}
                </Badge>
              </button>
            );
          })}
        </div>
      )}

      {loadouts.isError ? (
        <p className="text-muted-foreground text-sm">
          {loadouts.error.notConfigured
            ? "Loadout storage isn't configured on this deployment yet — set DATABASE_URL (see .env.example)."
            : `Couldn't load your loadouts — ${loadouts.error.message}`}
        </p>
      ) : loadouts.isPending ? (
        <p className="text-muted-foreground text-sm">Loading your loadouts…</p>
      ) : all.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No saved loadouts yet. Expand a build on the builder and choose Save.
        </p>
      ) : shown.length === 0 ? (
        <p className="text-muted-foreground text-sm">No loadouts match.</p>
      ) : (
        <div className="space-y-1.5">
          {shown.map((saved) => (
            <LoadoutRow
              key={saved.id}
              saved={saved}
              pieceMap={pieceMap}
              manifest={manifest}
              characters={armory.characters}
              statIcons={statIcons}
              balancedTuningIcon={balancedTuningIcon}
              now={now}
              onEdit={() => openEdit(saved)}
              onDuplicate={() => duplicateLoadout(saved)}
              onDelete={() => setDialog({ kind: "delete", loadout: saved })}
              onShare={() => void shareLoadout(saved)}
              onLoadInBuilder={() => loadInBuilder(saved)}
              onArmoryChanged={onArmoryChanged}
            />
          ))}
        </div>
      )}

      <LoadoutDetailsDialog
        open={dialog.kind === "edit"}
        onOpenChange={(open) => !open && setDialog({ kind: "none" })}
        title="Edit loadout"
        description={
          dialog.kind === "edit" && !dialog.mods
            ? "Mods can't be edited while a piece is missing from your inventory."
            : undefined
        }
        submitLabel="Save changes"
        initialName={dialog.kind === "edit" ? dialog.loadout.loadout.name : ""}
        initialNotes={dialog.kind === "edit" ? (dialog.loadout.loadout.notes ?? "") : ""}
        mods={dialog.kind === "edit" ? dialog.mods : undefined}
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
        busy={create.isPending}
        onSubmit={importLoadout}
      />
    </div>
  );
}
