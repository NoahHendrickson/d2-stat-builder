"use client";

import {
  memo,
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
import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import Image from "next/image";
import { CircleNotch, Check, X } from "@phosphor-icons/react";
import type { ArmorPiece, ArmorSocket } from "@/lib/armory/normalize";
import { SLOT_LABELS } from "@/lib/armory/stats";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import type { ModOption, ModOptionCatalog } from "@/lib/loadouts/mod-options";
import {
  chosenCount,
  cycleModStack,
  toggleExclusiveMod,
  pieceEnergyUsed,
  placementWithStatMods,
  statModSlotted,
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
import {
  TooltipContent,
  TooltipLabel,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { KIND_LABEL } from "@/components/loadouts/loadout-mods-editor";
import {
  LoadoutSubclassEditor,
  type SubclassSection,
} from "@/components/loadouts/loadout-subclass-editor";
import type { LoadoutDetailsValues } from "@/components/loadouts/loadout-details-dialog";
import { cn } from "@/lib/utils";

const EMPTY_STAT_MODS: number[] = [];

interface EditorProps {
  title: string;
  description?: string;
  submitLabel: string;
  initialName: string;
  initialNotes?: string;
  mods?: ModsSection;
  subclass?: SubclassSection;
  busy?: boolean;
  /** Piece/subclass grids; deferred so the header can paint during the slide. */
  showGrids?: boolean;
  onSubmit: (values: LoadoutDetailsValues) => void;
  onCancel: () => void;
}

/** A Bungie icon, or a muted square when the item has none. */
function ItemIcon({
  icon,
  watermark,
  className,
  size = 32,
}: {
  icon?: string;
  watermark?: string;
  className?: string;
  size?: 24 | 32 | 40 | 48 | 64;
}) {
  const sizeClass =
    size === 64
      ? "size-16"
      : size === 48
        ? "size-12"
        : size === 40
          ? "size-10"
          : size === 24
            ? "size-6"
            : "size-8";
  return (
    <span
      className={cn(
        "relative inline-block shrink-0 overflow-hidden rounded-sm",
        sizeClass,
        className,
      )}
    >
      {icon ? (
        <Image
          src={`${BUNGIE_IMAGE_BASE}${icon}`}
          alt=""
          width={size}
          height={size}
          className="size-full"
          unoptimized
        />
      ) : (
        <span className="bg-muted block size-full" aria-hidden />
      )}
      {watermark && (
        <Image
          src={`${BUNGIE_IMAGE_BASE}${watermark}`}
          alt=""
          width={size}
          height={size}
          className="absolute inset-0 size-full"
          unoptimized
        />
      )}
    </span>
  );
}

/** Optimizer stat-mod chip in the editor header: checked when a copy is on a piece. */
function StatModChip({
  option,
  slotted,
}: {
  option: ModOption | undefined;
  slotted: boolean;
}) {
  const name = option?.name ?? "Stat mod";
  const label = slotted ? `${name} · slotted` : `${name} · not slotted`;
  return (
    <TooltipLabel label={label} disabled>
      <span
        role="listitem"
        aria-label={label}
        className="relative flex size-9 shrink-0 items-center justify-center border border-input"
      >
        <ItemIcon icon={option?.icon} size={32} className="rounded-none" />
        <span
          className={cn(
            "absolute -top-1 -right-1 flex size-3.5 items-center justify-center rounded-full",
            slotted
              ? "bg-emphatic text-emphatic-foreground"
              : "bg-destructive text-white",
          )}
          aria-hidden
        >
          {slotted ? (
            <Check weight="bold" className="size-2.5" />
          ) : (
            <X weight="bold" className="size-2.5" />
          )}
        </span>
      </span>
    </TooltipLabel>
  );
}

/** Square piece art: Figma 25:8440 — 2px gold stroke, inset glow, T5 rail + pips. */
function PieceThumb({ piece }: { piece: ArmorPiece }) {
  const tier5 = piece.tunedStat !== undefined;
  return (
    <span className="relative size-16 shrink-0 overflow-hidden">
      <ItemIcon
        icon={piece.icon}
        watermark={piece.watermark}
        size={64}
        className="rounded-none"
      />
      {tier5 && (
        <img
          src="/loadout/tier-5-pips.svg"
          alt=""
          width={7}
          height={38}
          className="pointer-events-none absolute top-[21px] left-1.5 h-[38px] w-[7.14px]"
        />
      )}
      <span
        className="pointer-events-none absolute inset-0 border-2 border-[#e8c411] shadow-[inset_0_0_12px_rgba(255,240,107,0.5)]"
        aria-hidden
      />
    </span>
  );
}

/**
 * One 56px mod cell with a 48px icon (Figma 22:8202): chosen = emphatic outline on a
 * 6% emphatic fill; blocked (no socket or energy left for it) = 40% and not clickable.
 * `count` > 1 shows how many copies are stacked on the piece.: chosen = emphatic outline on a 6% emphatic fill.
 * Once something in the group is chosen the other mods drop to 40% so the picks stand
 * out; an untouched group stays at full strength. `count` > 1 shows how many copies
 * are stacked on the piece. `problem` marks a loadout mod the planner couldn't place
 * (red badge).
 */
const ModCell = memo(function ModCell({
  option,
  count,
  blocked,
  problem,
  onPick,
  tooltipHandle,
}: {
  option: ModOption;
  count: number;
  /** No socket or energy left for this mod (clicking a chosen one still clears it). */
  blocked: boolean;
  problem?: string;
  onPick: (option: ModOption) => void;
  tooltipHandle: BaseTooltip.Handle<string>;
}) {
  const chosen = count > 0;
  const cost = option.cost > 0 ? `${option.cost} energy` : undefined;
  const state = chosen
    ? count > 1
      ? `${count} equipped`
      : "equipped"
    : blocked && !problem
      ? "won't fit"
      : undefined;
  const label = [option.name, cost, state, problem && `not placed: ${problem}`]
    .filter(Boolean)
    .join(" · ");
  return (
    <TooltipTrigger
      handle={tooltipHandle}
      payload={option.name}
      render={
        <button
          type="button"
          aria-pressed={chosen}
          aria-label={label}
          aria-disabled={!chosen && blocked}
          onClick={() => onPick(option)}
          className={cn(
            "focus-visible:ring-ring relative flex size-14 shrink-0 items-center justify-center rounded-none border p-1 transition-[opacity,border-color,background-color] outline-none focus-visible:ring-2",
            chosen
              ? "border-emphatic bg-emphatic/6 cursor-pointer"
              : blocked
                ? // Flagged mods stay at full strength so the badge reads.
                  cn("cursor-not-allowed border-input", !problem && "opacity-40")
                : "hover:bg-foreground/6 focus-visible:bg-foreground/6 cursor-pointer border-input",
          )}
        >
          <ItemIcon icon={option.icon} size={48} className="rounded-none" />
          {count > 1 && (
            <span className="bg-emphatic text-emphatic-foreground absolute -top-1 -right-1 rounded-full px-1 text-[9px] leading-3 font-medium tabular-nums">
              ×{count}
            </span>
          )}
          {problem && (
            <span
              className="bg-destructive absolute -top-1 -left-1 flex size-3.5 items-center justify-center rounded-full text-[9px] leading-none font-bold text-white"
              aria-hidden
            >
              !
            </span>
          )}
        </button>
      }
    />
  );
});

/**
 * One grid for every socket of a kind on the piece ("Armor mods" = the three helmet
 * sockets). Armor mods stack another copy into the next free socket; at the limit the
 * click clears that mod. Stat and tuning are exclusive — clicking a different option
 * replaces the current pick. Options are those the sockets' plug set lists, so only
 * mods that fit this slot appear.
 */
function KindGrid({
  piece,
  sockets,
  catalog,
  insertable,
  chosen,
  energyLeft,
  costOf,
  problems,
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
  /** Mod name → why the planner couldn't place it (see `unplacedProblems`). */
  problems: ReadonlyMap<number | string, string>;
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
  const used = sockets.filter((s) => chosen?.[s.index] !== undefined).length;
  const full = used >= sockets.length;
  // Stat / tuning: one pick per group; a new click replaces it. Armor mods stack.
  const exclusive = kind === "general" || kind === "tuning";
  // Replacing an exclusive pick frees its loadout cost. Stacking fills an empty
  // socket, so vault plugs don't credit anything.
  const occupied = sockets.find((s) => chosen?.[s.index] !== undefined);
  const outgoing = exclusive && occupied ? chosen?.[occupied.index] : undefined;
  const credit = outgoing ? costOf(outgoing) : 0;
  const fits = (o: ModOption) =>
    (exclusive || !full) && (energyLeft === undefined || o.cost <= energyLeft + credit);
  const heading = sockets.length > 1 ? `${KIND_LABEL[kind]}s` : KIND_LABEL[kind];
  // Sockets nothing was chosen for keep their current plug on apply.
  const keeping = sockets.filter(
    (s) => chosen?.[s.index] === undefined && s.plugHash && s.plugHash !== s.emptyPlugHash,
  ).length;

  const tooltipHandle = useMemo(() => BaseTooltip.createHandle<string>(), []);

  const onPick = useCallback(
    (o: ModOption) => {
      const count = chosenCount(chosen, sockets, o.hash);
      const canAdd =
        (exclusive || !full) &&
        (energyLeft === undefined || o.cost <= energyLeft + credit);
      if (count === 0 && !canAdd) return;
      if (exclusive) {
        onChange((prev) => toggleExclusiveMod(prev, sockets, o.hash));
        return;
      }
      // No room for another copy → the click clears instead.
      const limit = canAdd ? (o.stackable ? sockets.length : 1) : count;
      onChange((prev) => cycleModStack(prev, sockets, o.hash, limit));
    },
    [chosen, credit, energyLeft, exclusive, full, onChange, sockets],
  );

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
      <div className="flex flex-wrap gap-0.5">
        {options.map((o) => {
          const count = chosenCount(chosen, sockets, o.hash);
          const canAdd = fits(o);
          return (
            <ModCell
              key={o.hash}
              option={o}
              count={count}
              blocked={count === 0 && !canAdd}
              problem={problems.get(o.hash) ?? problems.get(o.name)}
              onPick={onPick}
              tooltipHandle={tooltipHandle}
            />
          );
        })}
      </div>
      <BaseTooltip.Root handle={tooltipHandle} disableHoverablePopup>
        {({ payload }) =>
          payload !== undefined ? <TooltipContent>{payload}</TooltipContent> : null
        }
      </BaseTooltip.Root>
    </section>
  );
}

type PieceChosenUpdate = (
  chosen: Record<number, number> | undefined,
) => Record<number, number>;

/** One armor piece: compact header (icon, name, slot, energy) and a group per socket kind. */
const PiecePanel = memo(function PiecePanel({
  piece,
  catalog,
  insertable,
  placement,
  problems,
  costOf,
  onChange,
}: {
  piece: ArmorPiece;
  catalog: ModOptionCatalog;
  insertable?: ReadonlySet<number>;
  placement: Record<number, number> | undefined;
  problems: ReadonlyMap<number | string, string>;
  costOf: (hash: number) => number;
  onChange: (instanceId: string, update: PieceChosenUpdate) => void;
}) {
  const handleChange = useCallback(
    (update: PieceChosenUpdate) => onChange(piece.instanceId, update),
    [onChange, piece.instanceId],
  );
  const used = pieceEnergyUsed(piece, placement, costOf);
  const usedWithoutStat = pieceEnergyUsed(piece, placement, costOf, "general");
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
      className="flex min-h-0 min-w-0 flex-col gap-3 px-7 py-2.5"
    >
      <div className="flex min-w-0 shrink-0 items-center gap-2.5">
        <PieceThumb piece={piece} />
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
      {/* Mods scroll inside the column, not the drawer. */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain">
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
              energyLeft={
                capacity === undefined
                  ? undefined
                  : capacity - (group[0].kind === "other" ? usedWithoutStat : used)
              }
              costOf={costOf}
              problems={problems}
              onChange={handleChange}
            />
          ))
        )}
      </div>
    </section>
  );
});

function nameIsValid(name: string) {
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_NAME_LENGTH;
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
        className="h-9 w-full bg-transparent text-sm sm:w-80 dark:bg-transparent"
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
        className="h-9 min-w-0 flex-1 bg-transparent text-sm sm:max-w-md sm:min-w-60 dark:bg-transparent"
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
  busy = false,
  showGrids = true,
  onSubmit,
  onCancel,
}: EditorProps) {
  const identityRef = useRef({ name: initialName, notes: initialNotes });
  const [nameValid, setNameValid] = useState(() => nameIsValid(initialName));
  const [placement, setPlacement] = useState<ModPlacement>(() =>
    mods ? placementWithStatMods(mods, mods.initial) : {},
  );
  const [subclassItem, setSubclassItem] = useState(subclass?.initial ?? null);
  const nameId = useId();
  const notesId = useId();

  const desiredStatMods = mods?.desiredStatMods ?? EMPTY_STAT_MODS;
  const slotted = useMemo(
    () => (mods ? statModSlotted(desiredStatMods, placement, mods.pieces) : []),
    [mods, desiredStatMods, placement],
  );

  // Loadout mods the planner couldn't place for lack of armor energy, with the reason
  // peeled off the planner's "Name: reason" line. Tuning / artifice cost nothing and
  // picking a different one is fine, so they aren't flagged. Stat mods the loadout
  // wants are shown in the header (checked when slotted), not as piece-grid badges.
  // Keyed by hash and by name (a grid shows one variant per name, so the hash may
  // differ). Editor plans carry no subclass, so `skipped` and `unplaced` pair up.
  const problems = useMemo(() => {
    const out = new Map<number | string, string>();
    const wanted = new Set(desiredStatMods);
    mods?.unplaced.forEach((hash, i) => {
      if (wanted.has(hash)) return;
      const option = mods.catalog.option(hash);
      if (!option || option.cost === 0) return;
      const message = mods.skipped[i] ?? "";
      const prefix = `${option.name}: `;
      const reason = message.startsWith(prefix)
        ? message.slice(prefix.length)
        : "not enough armor energy";
      out.set(hash, reason);
      out.set(option.name, reason);
    });
    return out;
  }, [mods, desiredStatMods]);

  const catalog = mods?.catalog;
  const costOf = useCallback(
    (hash: number) => catalog?.option(hash)?.cost ?? 0,
    [catalog],
  );
  const updatePieceChosen = useCallback(
    (instanceId: string, update: PieceChosenUpdate) => {
      setPlacement((prev) => {
        const before = prev[instanceId];
        const chosen = update(before);
        const next: ModPlacement = { ...prev };
        if (Object.keys(chosen).length === 0) delete next[instanceId];
        else next[instanceId] = chosen;
        if (!mods || desiredStatMods.length === 0) return next;
        const general = new Set(
          (mods.pieces.find((p) => p.instanceId === instanceId)?.armorSockets ?? [])
            .filter((s) => s.kind === "general")
            .map((s) => s.index),
        );
        const generalUnchanged = [...general].every((i) => before?.[i] === chosen[i]);
        return generalUnchanged ? placementWithStatMods(mods, next) : next;
      });
    },
    [desiredStatMods, mods],
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

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = identityRef.current.name.trim();
    if (!canSubmit || !nameIsValid(trimmed)) return;
    onSubmit({
      name: trimmed,
      notes: identityRef.current.notes.trim(),
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
        <EditorIdentityFields
          initialName={initialName}
          initialNotes={initialNotes}
          nameId={nameId}
          notesId={notesId}
          valuesRef={identityRef}
          onNameValidChange={setNameValid}
        />
        {mods && desiredStatMods.length > 0 && (
          <div
            role="list"
            aria-label="Stat mods"
            className="flex flex-wrap items-center gap-0.5"
          >
            {desiredStatMods.map((hash, i) => (
              <StatModChip
                key={`${hash}-${i}`}
                option={mods.catalog.option(hash)}
                slotted={slotted[i] ?? false}
              />
            ))}
          </div>
        )}
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

      {/* Body: subclass + pieces side by side, each column with its options. The body
          itself doesn't scroll at a single row; the grid takes the leftover height and
          the subclass column scrolls its own options. */}
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {description && !mods && (
          <p className="text-muted-foreground mb-3 text-xs">{description}</p>
        )}
        {/* Subclass first, then the five pieces; at `lg` every column shares the width.
            Gated so the header can paint before ~550 tooltip roots and images mount. */}
        {showGrids && (
          <div
            className="divide-border grid min-h-0 flex-1 grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] divide-x lg:grid-cols-[repeat(var(--editor-cols),minmax(0,1fr))]"
            style={{ "--editor-cols": (mods?.pieces.length ?? 0) + (subclass ? 1 : 0) } as CSSProperties}
          >
            {subclass && (
              <section
                aria-label="Subclass"
                className="flex min-h-0 min-w-0 flex-col gap-3 px-7 py-2.5"
              >
                <div className="flex min-w-0 shrink-0 items-center gap-2.5">
                  <ItemIcon icon={subclassDef?.displayProperties?.icon} size={24} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">{subclassName}</span>
                    <span className="text-muted-foreground text-xs">Subclass</span>
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
  ...form
}: Omit<EditorProps, "onCancel" | "showGrids"> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
        className="rounded-none bg-[color-mix(in_oklab,var(--color-sidebar),var(--color-foreground)_6%)] shadow-[0_-8px_32px_rgba(0,0,0,0.13)] data-[swipe-direction=down]:rounded-none data-[swipe-axis=y]:[--drawer-content-max-height:min(80dvh,60rem)] [--drawer-bleed-background:color-mix(in_oklab,var(--color-sidebar),var(--color-foreground)_6%)]"
        // Sits over the content column only — `--app-sidebar-width` is the live
        // sidebar width (0 below `lg`, where the sidebar is itself a drawer).
        style={{ left: "var(--app-sidebar-width, 0px)" }}
      >
        {open && (
          <EditorForm
            {...form}
            showGrids={showGrids}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DrawerContent>
    </Drawer>
  );
}
