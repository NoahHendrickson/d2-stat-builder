"use client";

import { useId, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import Image from "next/image";
import { CircleNotch, MagnifyingGlass } from "@phosphor-icons/react";
import type { ArmorPiece, ArmorSocket } from "@/lib/armory/normalize";
import { SLOT_LABELS } from "@/lib/armory/stats";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import type { ModOption, ModOptionCatalog } from "@/lib/loadouts/mod-options";
import {
  chosenCount,
  cycleModStack,
  pieceEnergyUsed,
  type ModsSection,
} from "@/lib/loadouts/mod-placement";
import { subclassSelectionValid } from "@/lib/loadouts/subclass";
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
import { KIND_LABEL } from "@/components/loadouts/loadout-mods-editor";
import {
  LoadoutSubclassEditor,
  type SubclassSection,
} from "@/components/loadouts/loadout-subclass-editor";
import type { LoadoutDetailsValues } from "@/components/loadouts/loadout-details-dialog";
import { cn } from "@/lib/utils";

interface EditorProps {
  title: string;
  description?: string;
  submitLabel: string;
  initialName: string;
  initialNotes?: string;
  mods?: ModsSection;
  subclass?: SubclassSection;
  busy?: boolean;
  onSubmit: (values: LoadoutDetailsValues) => void;
  onCancel: () => void;
}

/** A Bungie icon, or a muted square when the item has none. */
function ItemIcon({
  icon,
  className,
  size = 32,
}: {
  icon?: string;
  className?: string;
  size?: 24 | 32 | 40 | 48;
}) {
  const sizeClass =
    size === 48 ? "size-12" : size === 40 ? "size-10" : size === 24 ? "size-6" : "size-8";
  return icon ? (
    <Image
      src={`${BUNGIE_IMAGE_BASE}${icon}`}
      alt=""
      width={size}
      height={size}
      className={cn(sizeClass, "shrink-0 rounded-sm", className)}
      unoptimized
    />
  ) : (
    <span
      className={cn("bg-muted shrink-0 rounded-sm", sizeClass, className)}
      aria-hidden
    />
  );
}

/**
 * One 56px mod cell with a 48px icon (Figma 22:8202): chosen = emphatic outline on a
 * 6% emphatic fill; blocked (no socket or energy left for it) = 40% and not clickable.
 * `count` > 1 shows how many copies are stacked on the piece.: chosen = emphatic outline on a 6% emphatic fill.
 * Once something in the group is chosen the other mods drop to 40% so the picks stand
 * out; an untouched group stays at full strength. `count` > 1 shows how many copies
 * are stacked on the piece.
 */
function ModCell({
  option,
  count,
  blocked,
  onClick,
}: {
  option: ModOption;
  count: number;
  /** No socket or energy left for this mod (clicking a chosen one still clears it). */
  blocked: boolean;
  onClick: () => void;
}) {
  const chosen = count > 0;
  const cost = option.cost > 0 ? `${option.cost} energy` : undefined;
  const state = chosen
    ? count > 1
      ? `${count} equipped`
      : "equipped"
    : blocked
      ? "won't fit"
      : undefined;
  const label = [option.name, cost, state].filter(Boolean).join(" · ");
  return (
    <TooltipLabel label={option.description ? `${label} — ${option.description}` : label}>
      <button
        type="button"
        aria-pressed={chosen}
        aria-label={label}
        aria-disabled={!chosen && blocked}
        onClick={onClick}
        className={cn(
          "focus-visible:ring-ring relative flex size-14 shrink-0 items-center justify-center rounded-[4px] border p-1 transition-[opacity,border-color,background-color] outline-none focus-visible:ring-2",
          chosen
            ? "border-emphatic bg-emphatic/6 cursor-pointer"
            : blocked
              ? "cursor-not-allowed border-transparent opacity-40"
              : "hover:bg-foreground/6 focus-visible:bg-foreground/6 cursor-pointer border-transparent",
        )}
      >
        <ItemIcon icon={option.icon} size={48} />
        {count > 1 && (
          <span className="bg-emphatic text-emphatic-foreground absolute -top-1 -right-1 rounded-full px-1 text-[9px] leading-3 font-medium tabular-nums">
            ×{count}
          </span>
        )}
      </button>
    </TooltipLabel>
  );
}

/**
 * One grid for every socket of a kind on the piece ("Armor mods" = the three helmet
 * sockets). Clicking a mod stacks another copy into the next free socket; at the limit
 * the click clears it. Options are those the sockets' plug set lists, so only mods
 * that fit this slot appear.
 */
function KindGrid({
  piece,
  sockets,
  catalog,
  insertable,
  chosen,
  energyLeft,
  costOf,
  query,
  onChange,
}: {
  piece: ArmorPiece;
  sockets: ArmorSocket[];
  catalog: ModOptionCatalog;
  insertable?: ReadonlySet<number>;
  chosen: Record<number, number> | undefined;
  /** Armor energy the piece has left with the current choices (undefined = unknown). */
  energyLeft: number | undefined;
  costOf: (hash: number) => number;
  query: string;
  /** Functional so back-to-back clicks each build on the latest choices. */
  onChange: (update: (chosen: Record<number, number> | undefined) => Record<number, number>) => void;
}) {
  const kind = sockets[0].kind;
  const options = useMemo(() => {
    // Same-kind sockets share a plug set; merge anyway in case one differs.
    const seen = new Set<number>();
    const out: ModOption[] = [];
    for (const socket of sockets) {
      for (const o of catalog.optionsFor(piece, socket, insertable)) {
        if (seen.has(o.hash)) continue;
        seen.add(o.hash);
        out.push(o);
      }
    }
    return out.sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));
  }, [catalog, piece, sockets, insertable]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.name.toLowerCase().includes(q)) : options;
  }, [options, query]);
  const used = sockets.filter((s) => chosen?.[s.index] !== undefined).length;
  const full = used >= sockets.length;
  // A new mod goes in the first socket without a choice; whatever is socketed there
  // now gets replaced, so its cost comes back.
  const nextFree = sockets.find((s) => chosen?.[s.index] === undefined);
  const credit = nextFree?.plugHash ? costOf(nextFree.plugHash) : 0;
  const fits = (o: ModOption) =>
    !full && (energyLeft === undefined || o.cost <= energyLeft + credit);
  const heading = sockets.length > 1 ? `${KIND_LABEL[kind]}s` : KIND_LABEL[kind];
  // Sockets nothing was chosen for keep their current plug on apply.
  const keeping = sockets.filter(
    (s) => chosen?.[s.index] === undefined && s.plugHash && s.plugHash !== s.emptyPlugHash,
  ).length;

  return (
    <section
      aria-label={`${heading} on ${piece.name}`}
      className="space-y-1 text-xs"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <span className="font-medium">{heading}</span>
        <span className="text-muted-foreground flex items-baseline gap-1.5 tabular-nums">
          {sockets.length > 1 ? `${used}/${sockets.length} sockets` : used ? "1/1" : "Keeps current"}
          {keeping > 0 && sockets.length > 1 && ` · ${keeping} kept`}
          {used > 0 && (
            <button
              type="button"
              onClick={() =>
                onChange((prev) => {
                  const next = { ...(prev ?? {}) };
                  for (const s of sockets) delete next[s.index];
                  return next;
                })
              }
              className="text-foreground/70 hover:text-foreground cursor-pointer underline-offset-2 hover:underline"
            >
              Clear
            </button>
          )}
        </span>
      </div>
      {shown.length === 0 ? (
        <p className="text-muted-foreground text-xs">No mods match.</p>
      ) : (
        <div className="flex flex-wrap gap-0.5">
          {shown.map((o) => {
            const count = chosenCount(chosen, sockets, o.hash);
            const canAdd = fits(o);
            return (
              <ModCell
                key={o.hash}
                option={o}
                count={count}
                blocked={count === 0 && !canAdd}
                onClick={() => {
                  if (count === 0 && !canAdd) return;
                  // No room for another copy → the click clears instead.
                  const limit = canAdd ? (o.stackable ? sockets.length : 1) : count;
                  onChange((prev) => cycleModStack(prev, sockets, o.hash, limit));
                }}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

/** One armor piece: compact header (icon, name, slot, energy) and a group per socket kind. */
function PiecePanel({
  piece,
  catalog,
  insertable,
  placement,
  query,
  onChange,
}: {
  piece: ArmorPiece;
  catalog: ModOptionCatalog;
  insertable?: ReadonlySet<number>;
  placement: Record<number, number> | undefined;
  query: string;
  onChange: (update: (chosen: Record<number, number> | undefined) => Record<number, number>) => void;
}) {
  const costOf = (h: number) => catalog.option(h)?.cost ?? 0;
  const used = pieceEnergyUsed(piece, placement, costOf);
  const capacity = piece.energy?.capacity;
  const over = capacity !== undefined && used > capacity;
  // One group per socket kind, in first-socket order (stat mod, armor mods, tuning…).
  const groups = useMemo(() => {
    const byKind = new Map<ArmorSocket["kind"], ArmorSocket[]>();
    for (const s of piece.armorSockets ?? []) byKind.set(s.kind, [...(byKind.get(s.kind) ?? []), s]);
    return [...byKind.values()];
  }, [piece.armorSockets]);

  return (
    <section
      aria-label={piece.name}
      className="bg-foreground/6 flex min-w-0 flex-col gap-3 rounded-md px-3 py-2.5"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <ItemIcon icon={piece.icon} size={24} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{piece.name}</span>
          <span className="text-muted-foreground text-xs">
            {SLOT_LABELS[piece.slot]}
            {capacity !== undefined && (
              <>
                {" · "}
                <span
                  className={cn("tabular-nums", over && "text-destructive font-medium")}
                >
                  {used}/{capacity} energy
                </span>
              </>
            )}
          </span>
        </div>
      </div>
      {groups.length === 0 ? (
        <p className="text-muted-foreground text-xs">No mod sockets.</p>
      ) : (
        groups.map((group) => (
          <KindGrid
            key={group[0].kind}
            piece={piece}
            sockets={group}
            catalog={catalog}
            insertable={insertable}
            chosen={placement}
            energyLeft={capacity === undefined ? undefined : capacity - used}
            costOf={costOf}
            query={query}
            onChange={onChange}
          />
        ))
      )}
    </section>
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
  busy = false,
  onSubmit,
  onCancel,
}: EditorProps) {
  const [name, setName] = useState(initialName);
  const [notes, setNotes] = useState(initialNotes);
  const [placement, setPlacement] = useState<ModPlacement>(mods?.initial ?? {});
  const [subclassItem, setSubclassItem] = useState(subclass?.initial ?? null);
  const [query, setQuery] = useState("");
  const searchable =
    mods?.pieces.some((p) =>
      (p.armorSockets ?? []).some(
        (s) => mods.catalog.optionsFor(p, s, mods.insertable).length > 8,
      ),
    ) ?? false;
  const nameId = useId();
  const notesId = useId();

  const costOf = (hash: number) => mods?.catalog.option(hash)?.cost ?? 0;
  const updatePieceChosen = (
    instanceId: string,
    update: (chosen: Record<number, number> | undefined) => Record<number, number>,
  ) => {
    setPlacement((prev) => {
      const chosen = update(prev[instanceId]);
      const next: ModPlacement = { ...prev };
      if (Object.keys(chosen).length === 0) delete next[instanceId];
      else next[instanceId] = chosen;
      return next;
    });
  };

  const trimmed = name.trim();
  const overEnergy =
    mods !== undefined &&
    mods.pieces.some((p) => {
      const cap = p.energy?.capacity;
      return cap !== undefined && pieceEnergyUsed(p, placement[p.instanceId], costOf) > cap;
    });
  const canSubmit =
    trimmed.length > 0 &&
    trimmed.length <= MAX_NAME_LENGTH &&
    !busy &&
    !overEnergy &&
    (!subclass || subclassSelectionValid(subclass, subclassItem));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      name: trimmed,
      notes: notes.trim(),
      ...(mods ? { placement } : {}),
      ...(subclass ? { subclass: subclassItem } : {}),
    });
  };

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

      {/* Header: name (Figma "Select Trigger" 22:8019), notes, and the actions. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 pt-4 pb-3 sm:gap-3">
        <label htmlFor={nameId} className="sr-only">
          Name
        </label>
        <Input
          id={nameId}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={MAX_NAME_LENGTH}
          placeholder="Loadout name"
          aria-label="Loadout name"
          className="bg-sidebar h-8 w-full text-sm sm:w-80 dark:bg-sidebar"
          autoFocus
          onFocus={(e) => e.target.select()}
        />
        <label htmlFor={notesId} className="sr-only">
          Notes
        </label>
        <Input
          id={notesId}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={MAX_NOTES_LENGTH}
          placeholder="Notes (optional — #hashtags become filters)"
          className="bg-sidebar h-8 min-w-0 flex-1 text-sm sm:max-w-md sm:min-w-60 dark:bg-sidebar"
        />
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
            {busy ? <CircleNotch className="animate-spin" aria-hidden /> : null}
            {submitLabel}
          </Button>
        </div>
      </div>

      {/* Body: subclass + pieces side by side, each column with its options. */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {description && !mods && (
          <p className="text-muted-foreground mb-3 text-xs">{description}</p>
        )}
        {mods && searchable && (
          <div className="relative mb-2 w-full sm:w-64">
            <MagnifyingGlass
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2"
              aria-hidden
            />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search mods"
              aria-label="Search mods"
              className="h-7 pl-7 text-xs"
            />
          </div>
        )}
        {/* Subclass first, then the five pieces; at `lg` every column shares the width. */}
        <div
          className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-2 lg:grid-cols-[repeat(var(--editor-cols),minmax(0,1fr))]"
          style={{ "--editor-cols": (mods?.pieces.length ?? 0) + (subclass ? 1 : 0) } as CSSProperties}
        >
          {subclass && (
            <section
              aria-label="Subclass"
              className="bg-foreground/6 flex min-w-0 flex-col gap-3 rounded-md px-3 py-2.5"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <ItemIcon icon={subclassDef?.displayProperties?.icon} size={24} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">{subclassName}</span>
                  <span className="text-muted-foreground text-xs">Subclass</span>
                </div>
              </div>
              <LoadoutSubclassEditor
                section={subclass}
                value={subclassItem}
                onChange={setSubclassItem}
                compact
              />
            </section>
          )}
          {mods?.pieces.map((piece) => (
            <PiecePanel
              key={piece.instanceId}
              piece={piece}
              catalog={mods.catalog}
              insertable={mods.insertable}
              placement={placement[piece.instanceId]}
              query={query}
              onChange={(update) => updatePieceChosen(piece.instanceId, update)}
            />
          ))}
        </div>
        {mods && mods.skipped.length > 0 && (
          <div className="border-border/60 bg-muted/40 mt-3 rounded-lg border px-3 py-2 text-xs">
            <p className="font-medium">
              {mods.skipped.length === 1
                ? "1 mod doesn't fit your current armor"
                : `${mods.skipped.length} mods don't fit your current armor`}
            </p>
            <p className="text-muted-foreground mt-0.5">
              They stay in the loadout and will be socketed when the armor can take them
              (or place them by hand above).
            </p>
            <ul className="text-muted-foreground mt-1 list-disc space-y-0.5 pl-4">
              {mods.skipped.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        )}
        {mods && (
          <p className="text-muted-foreground mt-3 text-xs">
            Outlined mods are part of the loadout. Click a mod again to stack another
            copy; at the limit it clears. Sockets with nothing chosen keep whatever is
            socketed when you apply, and energy counts both.
          </p>
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
  ...form
}: Omit<EditorProps, "onCancel"> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
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
        className="bg-sidebar shadow-[0_-8px_32px_rgba(0,0,0,0.13)] data-[swipe-axis=y]:[--drawer-content-max-height:min(80dvh,60rem)]"
        // Sits over the content column only — `--app-sidebar-width` is the live
        // sidebar width (0 below `lg`, where the sidebar is itself a drawer).
        style={{ left: "var(--app-sidebar-width, 0px)" }}
      >
        {open && <EditorForm {...form} onCancel={() => onOpenChange(false)} />}
      </DrawerContent>
    </Drawer>
  );
}
