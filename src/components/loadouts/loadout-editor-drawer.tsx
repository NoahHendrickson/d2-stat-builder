"use client";

import {
  useCallback,
  useDeferredValue,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type MutableRefObject,
} from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, Loading03Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import {
  STAT_DISPLAY_ORDER,
  STAT_LABELS,
  STAT_ORDER,
} from "@/lib/armory/stats";
import { StatGlyph } from "@/components/stat-glyph";
import { statIconsFromManifest } from "@/lib/manifest/stat-icons";
import { sumEditorStats } from "@/lib/loadouts/editor-stats";
import type { ModOption } from "@/lib/loadouts/mod-options";
import {
  pieceEnergyUsed,
  placementWithStatMods,
  slotStatMod,
  statModSlotted,
  updateEditorPiece,
  type ModEditorState,
  type ModsSection,
} from "@/lib/loadouts/mod-placement";
import {
  selectedSubclassPlugs,
  subclassOptions,
  subclassSelectionValid,
} from "@/lib/loadouts/subclass";
import { subclassFromItemHash } from "@/lib/dim/subclasses";
import {
  MAX_NAME_LENGTH,
  MAX_NOTES_LENGTH,
  type ModPlacement,
} from "@/lib/loadouts/types";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { TooltipLabel } from "@/components/ui/tooltip";
import {
  EDITOR_COLUMN_CLASS,
  ItemIcon,
  PiecePanel,
  type PieceChosenUpdate,
} from "@/components/loadouts/loadout-piece-editor";
import {
  LoadoutSubclassEditor,
  type SubclassSection,
} from "@/components/loadouts/loadout-subclass-editor";
import {
  LoadoutWeaponsEditor,
  initialWeaponPicks,
  weaponPickRefs,
  type WeaponsSection,
} from "@/components/loadouts/loadout-weapons-editor";
import {
  LoadoutArtifactEditor,
  artifactPickRef,
  initialArtifactPick,
  type ArtifactSection,
} from "@/components/loadouts/loadout-artifact-editor";
import type { DimLoadoutItem } from "@/lib/dim/loadout-link";
import type { EditorTotals } from "@/lib/loadouts/editor-stats";
import { cn } from "@/lib/utils";

export interface LoadoutDetailsValues {
  name: string;
  notes: string;
  /** Present only when a `mods` section was shown. */
  placement?: ModPlacement;
  /** Current wishlist after explicit stat-mod replacements/removals. */
  desiredStatMods?: number[];
  subclass?: DimLoadoutItem | null;
  /** Present only when a `weapons` section was shown; empty means armor-only. */
  weapons?: DimLoadoutItem[];
  /** Present only when an `artifact` section was shown; null means no artifact. */
  artifact?: DimLoadoutItem | null;
  /**
   * Armor + placed mods + fragments as the header showed them. Present only when every
   * piece was known (a `mods` section), so the total is complete.
   */
  stats?: EditorTotals;
}

const NO_FRAGMENTS: number[] = [];
const STAT_COLS = STAT_DISPLAY_ORDER.map((key) => ({
  key,
  i: STAT_ORDER.indexOf(key),
}));

interface EditorProps {
  title: string;
  description?: string;
  submitLabel: string;
  initialName: string;
  initialNotes?: string;
  mods?: ModsSection;
  subclass?: SubclassSection;
  weapons?: WeaponsSection;
  artifact?: ArtifactSection;
  busy?: boolean;
  /** Piece/subclass grids; deferred so the header can paint during the slide. */
  showGrids?: boolean;
  onSubmit: (values: LoadoutDetailsValues) => void;
  onCancel: () => void;
}

/**
 * Optimizer stat-mod chip in the editor header: checked when a copy is on a piece.
 * An unslotted one is a button that slots it (onto the piece with the most energy to
 * spare) when any piece can take it; otherwise the tooltip says what's in the way.
 */
function StatModChip({
  option,
  slotted,
  blocked,
  onSlot,
}: {
  option: ModOption | undefined;
  slotted: boolean;
  /** Why it can't be slotted right now (unslotted chips only). */
  blocked?: string;
  onSlot: () => void;
}) {
  const name = option?.name ?? "Stat mod";
  const label = slotted
    ? `${name} · slotted`
    : blocked
      ? `${name} · not slotted — ${blocked}`
      : `${name} · not slotted — click to slot it`;
  const disabled = slotted || blocked !== undefined;
  return (
    <TooltipLabel label={label} disabled={disabled}>
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        onClick={onSlot}
        className={cn(
          "relative flex size-9 shrink-0 items-center justify-center border border-foreground/30",
          "outline-none focus-visible:d2-tile-selected",
          slotted
            ? "disabled:cursor-default"
            : blocked
              ? "disabled:cursor-not-allowed"
              : "hover:border-foreground hover:bg-foreground/8",
        )}
      >
        <ItemIcon icon={option?.icon} size={32} className="rounded-none" />
        <span
          className={cn(
            "absolute -top-1 -right-1 flex size-3.5 items-center justify-center rounded-none",
            slotted
              ? "bg-positive text-black"
              : "bg-destructive text-white",
          )}
          aria-hidden
        >
          {slotted ? (
            <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} className="size-2.5" />
          ) : (
            <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-2.5" />
          )}
        </span>
      </button>
    </TooltipLabel>
  );
}

function nameIsValid(name: string) {
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_NAME_LENGTH;
}

function EditorStatsRow({
  total,
  stats,
  statIcons,
}: {
  total: number;
  stats: number[];
  statIcons: ReturnType<typeof statIconsFromManifest>;
}) {
  return (
    <div
      role="group"
      className="flex shrink-0 items-center gap-3 px-1 text-sm leading-5 tabular-nums"
      aria-label="Loadout stats"
    >
      <TooltipLabel label="Total stats">
        <span tabIndex={0} className="font-medium">
          {total}
        </span>
      </TooltipLabel>
      {STAT_COLS.map(({ key, i }) => {
        const value = stats[i];
        return (
          <span key={key} className="flex items-center gap-0.5">
            <StatGlyph
              src={statIcons[key]}
              label={STAT_LABELS[key]}
              className="opacity-65"
            />
            <span className={cn(value === 0 && "text-muted-foreground")}>
              {value}
            </span>
          </span>
        );
      })}
    </div>
  );
}

/** Owns Name/Notes so keystrokes never re-render the piece grids. */
function EditorIdentityFields({
  initialName,
  initialNotes,
  nameId,
  notesId,
  valuesRef,
  onNameValidChange,
}: {
  initialName: string;
  initialNotes: string;
  nameId: string;
  notesId: string;
  valuesRef: MutableRefObject<{ name: string; notes: string }>;
  onNameValidChange: (valid: boolean) => void;
}) {
  const [name, setName] = useState(initialName);
  const [notes, setNotes] = useState(initialNotes);
  const validRef = useRef(nameIsValid(initialName));

  const setNameValue = (next: string) => {
    setName(next);
    valuesRef.current = { name: next, notes: valuesRef.current.notes };
    const valid = nameIsValid(next);
    if (valid !== validRef.current) {
      validRef.current = valid;
      onNameValidChange(valid);
    }
  };
  const setNotesValue = (next: string) => {
    setNotes(next);
    valuesRef.current = { name: valuesRef.current.name, notes: next };
  };

  return (
    <>
      <label htmlFor={nameId} className="sr-only">
        Name
      </label>
      <Input
        id={nameId}
        value={name}
        onChange={(e) => setNameValue(e.target.value)}
        maxLength={MAX_NAME_LENGTH}
        placeholder="Loadout name"
        aria-label="Loadout name"
        className="h-9 w-full bg-transparent text-sm sm:w-64 lg:w-full dark:bg-transparent"
        autoFocus
        onFocus={(e) => e.target.select()}
      />
      <label htmlFor={notesId} className="sr-only">
        Notes
      </label>
      <Input
        id={notesId}
        value={notes}
        onChange={(e) => setNotesValue(e.target.value)}
        maxLength={MAX_NOTES_LENGTH}
        placeholder="Notes (optional — #hashtags become filters)"
        className="h-9 min-w-0 flex-1 bg-transparent text-sm sm:max-w-md sm:min-w-48 lg:max-w-none lg:min-w-0 dark:bg-transparent"
      />
    </>
  );
}

function EditorForm({
  title,
  description,
  submitLabel,
  initialName,
  initialNotes = "",
  mods,
  subclass,
  weapons,
  artifact,
  busy = false,
  showGrids = true,
  onSubmit,
  onCancel,
}: EditorProps) {
  const identityRef = useRef({ name: initialName, notes: initialNotes });
  const [nameValid, setNameValid] = useState(() => nameIsValid(initialName));
  const [modEditor, setModEditor] = useState<ModEditorState>(() => ({
    placement: mods ? placementWithStatMods(mods, mods.initial) : {},
    desiredStatMods: mods?.desiredStatMods ?? [],
  }));
  const { placement, desiredStatMods } = modEditor;
  const [subclassItem, setSubclassItem] = useState(subclass?.initial ?? null);
  const [weaponPicks, setWeaponPicks] = useState(() =>
    weapons ? initialWeaponPicks(weapons) : {},
  );
  const [artifactPick, setArtifactPick] = useState(() =>
    artifact ? initialArtifactPick(artifact) : null,
  );
  const nameId = useId();
  const notesId = useId();

  const slotted = useMemo(
    () => (mods ? statModSlotted(desiredStatMods, placement, mods.pieces) : []),
    [mods, desiredStatMods, placement],
  );

  // Loadout mods the planner couldn't place, with its reason. Tuning / artifice cost
  // nothing and picking a different one is fine, so they aren't flagged. Stat mods the
  // loadout wants are shown in the header (checked when slotted), not as piece-grid
  // badges. Keyed by hash and by name (a grid shows one variant per name, so the hash
  // may differ).
  const problems = useMemo(() => {
    const out = new Map<number | string, string>();
    const statMods = new Set(mods?.desiredStatMods);
    for (const { hash, reason } of mods?.unplaced ?? []) {
      if (statMods.has(hash)) continue;
      const option = mods?.catalog.option(hash);
      if (!option || option.cost === 0) continue;
      out.set(hash, reason);
      out.set(option.name, reason);
    }
    return out;
  }, [mods]);

  const catalog = mods?.catalog;
  const costOf = useCallback(
    (hash: number) => catalog?.option(hash)?.cost ?? 0,
    [catalog],
  );

  // Per unslotted header chip: what stops a click from slotting it, if anything.
  const statModBlocked = useMemo(() => {
    if (!mods) return [];
    const pieces = mods.pieces;
    const generalSockets = pieces
      .map((p) => ({ p, g: p.armorSockets?.find((s) => s.kind === "general") }))
      .filter((x) => x.g !== undefined);
    const anyEmptySocket = generalSockets.some(
      ({ p, g }) => placement[p.instanceId]?.[g!.index] === undefined,
    );
    return desiredStatMods.map((hash, i): string | undefined => {
      if (slotted[i]) return undefined;
      if (slotStatMod(pieces, placement, hash, costOf)) return undefined;
      if (generalSockets.length === 0) return "these pieces have no stat-mod socket";
      if (!anyEmptySocket) return "every stat-mod socket is taken";
      return `needs ${costOf(hash)} energy and no piece has that free`;
    });
  }, [mods, desiredStatMods, slotted, placement, costOf]);
  const slotDesiredStatMod = useCallback(
    (hash: number) => {
      if (!mods) return;
      setModEditor((prev) => ({
        ...prev,
        placement: slotStatMod(mods.pieces, prev.placement, hash, costOf) ?? prev.placement,
      }));
    },
    [mods, costOf],
  );
  const updatePieceChosen = useCallback(
    (instanceId: string, update: PieceChosenUpdate) => {
      if (!mods) return;
      setModEditor((prev) =>
        updateEditorPiece(mods, prev, instanceId, update(prev.placement[instanceId])),
      );
    },
    [mods],
  );

  const overEnergy =
    mods !== undefined &&
    mods.pieces.some((p) => {
      const cap = p.energy?.capacity;
      return cap !== undefined && pieceEnergyUsed(p, placement[p.instanceId], costOf) > cap;
    });
  const subclassValid = useMemo(
    () => !subclass || subclassSelectionValid(subclass, subclassItem),
    [subclass, subclassItem],
  );
  const canSubmit = nameValid && !busy && !overEnergy && subclassValid;

  const fragmentHashes = useMemo(() => {
    if (!subclass || !subclassItem) return NO_FRAGMENTS;
    const sc = subclassFromItemHash(subclassItem.hash);
    if (!sc) return NO_FRAGMENTS;
    return selectedSubclassPlugs(
      subclassItem,
      subclassOptions(subclass.manifest, subclass.classType, sc).fragments,
    );
  }, [subclass, subclassItem]);
  const totals = useMemo(() => {
    const pieces = mods?.pieces;
    if (!pieces?.length && fragmentHashes.length === 0 && !subclass) return null;
    return sumEditorStats(
      pieces ?? [],
      placement,
      fragmentHashes,
      subclass?.classType ?? pieces?.[0]?.classType ?? 0,
      (hash) =>
        mods?.catalog.investmentStats(hash) ??
        subclass?.manifest.def("DestinyInventoryItemDefinition", hash)
          ?.investmentStats,
    );
  }, [mods, placement, fragmentHashes, subclass]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = identityRef.current.name.trim();
    if (!canSubmit || !nameIsValid(trimmed)) return;
    onSubmit({
      name: trimmed,
      notes: identityRef.current.notes.trim(),
      ...(mods ? { placement, desiredStatMods } : {}),
      ...(subclass ? { subclass: subclassItem } : {}),
      ...(weapons ? { weapons: weaponPickRefs(weaponPicks) } : {}),
      ...(artifact ? { artifact: artifactPickRef(artifact, artifactPick) } : {}),
      ...(mods && totals ? { stats: totals } : {}),
    });
  };

  const statIcons = useMemo(
    () => statIconsFromManifest(subclass?.manifest),
    [subclass],
  );

  const subclassDef = subclass?.manifest.def(
    "DestinyInventoryItemDefinition",
    subclassItem?.hash,
  );
  const subclassName =
    subclassDef?.displayProperties?.name ??
    (subclassItem ? subclassFromItemHash(subclassItem.hash) : undefined) ??
    "No subclass";

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <DrawerTitle className="sr-only">{title}</DrawerTitle>
      {description && (
        <DrawerDescription className="sr-only">{description}</DrawerDescription>
      )}

      {/* Header: name (Figma "Select Trigger" 22:8019), notes, the build's stat mods and
          stats, and the actions. From `lg` it is one grid row: name and notes give up width
          first, and the mods + stats cluster wraps inside its own cell, so the actions never
          drop to a second line. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 pt-4 pb-3 sm:gap-3 lg:grid lg:grid-cols-[minmax(10rem,0.6fr)_minmax(10rem,1fr)_auto_auto]">
        <EditorIdentityFields
          initialName={initialName}
          initialNotes={initialNotes}
          nameId={nameId}
          notesId={notesId}
          valuesRef={identityRef}
          onNameValidChange={setNameValid}
        />
        <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2">
          {mods && desiredStatMods.length > 0 && (
            <div
              role="group"
              aria-label="Stat mods"
              className="flex flex-wrap items-center gap-0.5"
            >
              {desiredStatMods.map((hash, i) => (
                <StatModChip
                  key={`${hash}-${i}`}
                  option={mods.catalog.option(hash)}
                  slotted={slotted[i] ?? false}
                  blocked={statModBlocked[i]}
                  onSlot={() => slotDesiredStatMod(hash)}
                />
              ))}
            </div>
          )}
          {totals && (
            <EditorStatsRow
              total={totals.total}
              stats={totals.stats}
              statIcons={statIcons}
            />
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {overEnergy && (
            <span className="text-destructive text-xs">
              A piece is over its armor energy.
            </span>
          )}
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="emphatic" disabled={!canSubmit}>
            {busy ? <HugeiconsIcon icon={Loading03Icon} className="animate-spin" aria-hidden /> : null}
            {submitLabel}
          </Button>
        </div>
      </div>

      {/* Body: subclass + pieces side by side, each column with its options. The body
          itself doesn't scroll at a single row; the grid takes the leftover height and
          the subclass column scrolls its own options. */}
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {description && !mods && (
          <p className="text-muted-foreground mb-3 text-xs">{description}</p>
        )}
        {(weapons || artifact) && (
          // One row of equal equipment slots: kinetic, energy, power, artifact.
          <div className="grid shrink-0 grid-cols-1 gap-2 pb-2 sm:grid-cols-2 xl:grid-cols-4">
            {weapons && (
              <LoadoutWeaponsEditor section={weapons} value={weaponPicks} onChange={setWeaponPicks} />
            )}
            {artifact && (
              <LoadoutArtifactEditor
                section={artifact}
                value={artifactPick}
                onChange={setArtifactPick}
              />
            )}
          </div>
        )}
        {/* Subclass first, then the five pieces; at `lg` every column shares the width.
            Gated so the header can paint before ~550 tooltip roots and images mount. */}
        {showGrids && (
          <div
            className="grid min-h-0 flex-1 grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-2 lg:grid-cols-[repeat(var(--editor-cols),minmax(0,1fr))]"
            style={{ "--editor-cols": (mods?.pieces.length ?? 0) + (subclass ? 1 : 0) } as CSSProperties}
          >
            {subclass && (
              <section
                aria-label="Subclass"
                className={EDITOR_COLUMN_CLASS}
              >
                <div className="flex min-w-0 shrink-0 items-center gap-2.5">
                  <ItemIcon icon={subclassDef?.displayProperties?.icon} size={24} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">{subclassName}</span>
                    <span className="d2-label text-[10px]">Subclass</span>
                  </div>
                </div>
                {/* The column scrolls its options; the drawer body stays put. */}
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                  <LoadoutSubclassEditor
                    section={subclass}
                    value={subclassItem}
                    onChange={setSubclassItem}
                    compact
                  />
                </div>
              </section>
            )}
            {mods?.pieces.map((piece) => (
              <PiecePanel
                key={piece.instanceId}
                piece={piece}
                catalog={mods.catalog}
                insertable={mods.insertable}
                placement={placement[piece.instanceId]}
                problems={problems}
                costOf={costOf}
                onChange={updatePieceChosen}
              />
            ))}
          </div>
        )}
      </div>
    </form>
  );
}

/**
 * Bottom-drawer loadout editor (Figma 22:8018) over the content column, shared by Save
 * (from a build) and Edit:
 * name + notes across the top, then a subclass column and one column per armor piece
 * with a grid of mods per socket kind. The caller owns the mutation;
 * this only collects the fields and reports busy/disabled state. The form mounts fresh
 * each time the drawer opens, so its fields re-seed from props without an effect.
 */
export function LoadoutEditorDrawer({
  open,
  onOpenChange,
  formKey,
  ...form
}: Omit<EditorProps, "onCancel" | "showGrids"> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Identity of what is being edited. The form seeds its name, notes, and mod
   * placement from props once, on mount — so when the drawer is already open and the
   * caller switches to a different loadout, a new key remounts it with the new values.
   */
  formKey?: string | number;
}) {
  // Stay on the mounted parent: EditorForm only exists while `open`, so a deferred
  // value inside it would start true and never delay the grids.
  const showGrids = useDeferredValue(open);
  return (
    // Non-modal: no backdrop, the sidebar stays usable, and only Cancel / Save /
    // Escape close it (a stray click outside must not throw the edits away).
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      swipeDirection="down"
      modal={false}
      disablePointerDismissal
    >
      <DrawerContent
        aria-label={form.title}
        // No left edge: the sidebar's own border-r already draws that line.
        className="d2-sidebar d2-line bg-glass rounded-none border border-transparent border-l-0! shadow-none data-[swipe-axis=y]:[--drawer-content-max-height:min(80dvh,60rem)] [--bleed:0px] [--drawer-bleed-background:var(--glass)]"
        // Over the main column only — past the sidebar. `--app-sidebar-width` is 0 below `lg`.
        style={{
          left: "var(--app-sidebar-width, 0px)",
        }}
      >
        {open && (
          <EditorForm
            key={formKey}
            {...form}
            showGrids={showGrids}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DrawerContent>
    </Drawer>
  );
}
