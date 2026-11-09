"use client";

import { useState, type ReactElement, type ReactNode } from "react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  Add01Icon,
  ArrowDataTransferHorizontalIcon,
  Cancel01Icon,
  Copy01Icon,
  Delete02Icon,
  FloppyDiskIcon,
  PaintBrush01Icon,
  PencilEdit02Icon,
} from "@hugeicons/core-free-icons";
import type { ArmorPiece } from "@/lib/armory/normalize";
import type { LoadoutWeapon } from "@/lib/armory/weapons";
import {
  slotAppearanceInSet,
  type InGameLoadoutIdentifiers,
  type InGameLoadoutSlot,
  type SlotIdentifiers,
} from "@/lib/bungie/ingame-loadouts";
import type { Manifest } from "@/lib/manifest/load";
import { statIconsFromManifest } from "@/lib/manifest/stat-icons";
import { inGameSlotAsLoadout } from "@/lib/loadouts/ingame-import";
import { resolveLoadout } from "@/lib/loadouts/resolve";
import { transientLoadout, type SavedLoadout, type SavedLoadoutData } from "@/lib/loadouts/types";
import { LoadoutPickList } from "@/components/loadouts/activity-set-panel";
import { Emblem } from "@/components/loadouts/ingame-save-dialog";
import { inGameSlotName } from "@/components/loadouts/ingame-slot-grid";
import { LoadoutCardBodyArmorFirst } from "@/components/loadouts/loadout-card-body";
import { LoadoutStatLine } from "@/components/loadouts/loadout-stat-line";
import { EmptySlotIcon, LOADOUT_SLOT_CLASS } from "@/components/loadouts/loadout-weapons-editor";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TooltipLabel } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface GearLookups {
  pieceMap: ReadonlyMap<string, ArmorPiece>;
  weaponMap: ReadonlyMap<string, LoadoutWeapon>;
  manifest: Manifest;
}

const ACTION_CLASS = "h-8 gap-1.5 px-3";
const SLOT_CTA_CLASS = cn(
  LOADOUT_SLOT_CLASS,
  "min-h-24 p-4 disabled:cursor-not-allowed disabled:opacity-50",
);

/** The selected slot's card: emblem, title, stats and actions, then what's in it. */
function SlotDetailFrame({
  slot,
  identifiers,
  title,
  label = title,
  titleClassName,
  titleAction,
  subtitle,
  data,
  manifest,
  actions,
  children,
}: {
  slot: InGameLoadoutSlot;
  identifiers: InGameLoadoutIdentifiers;
  title: string;
  /** The card's accessible name, when the title alone doesn't identify the slot. */
  label?: string;
  titleClassName?: string;
  /** A small control right after the title. */
  titleAction?: ReactNode;
  subtitle: string;
  /** The loadout on show; its stats go in the header. */
  data?: SavedLoadoutData;
  manifest: Manifest;
  actions: ReactNode;
  children: ReactNode;
}) {
  const statIcons = statIconsFromManifest(manifest);
  return (
    <article
      aria-label={label}
      className="@container d2-card-frame flex min-w-0 flex-col gap-4 p-4"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-48 items-center gap-3">
          {slot.empty ? (
            <EmptySlotIcon />
          ) : (
            <span aria-hidden className="relative size-12 shrink-0 overflow-hidden">
              <Emblem
                identifiers={identifiers}
                iconHash={slot.iconHash}
                colorHash={slot.colorHash}
                size={48}
              />
            </span>
          )}
          <div className="flex min-w-0 flex-col">
            <div className="flex min-w-0 items-center gap-1">
              <h3 className={cn("truncate text-base leading-6 font-medium", titleClassName)}>{title}</h3>
              {titleAction}
            </div>
            <p className="text-muted-foreground truncate text-xs leading-4">{subtitle}</p>
          </div>
        </div>
        {data?.optimizer && (
          <div className="flex items-center gap-4 text-sm leading-5 tabular-nums max-md:w-full max-md:justify-between max-md:gap-1">
            <LoadoutStatLine optimizer={data.optimizer} statIcons={statIcons} />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </div>
      {children}
    </article>
  );
}

/** A slot's gear as a loadout, for showing it. */
function slotAsLoadout(
  slot: InGameLoadoutSlot,
  identifiers: InGameLoadoutIdentifiers,
  classType: number,
  { pieceMap, weaponMap, manifest }: GearLookups,
) {
  const data = inGameSlotAsLoadout(slot, identifiers.names, { classType, pieceMap, weaponMap, manifest });
  return {
    data,
    shown: transientLoadout(`slot-${slot.index}`, data),
    resolved: resolveLoadout(data.loadout, pieceMap, manifest, weaponMap),
  };
}

/** Read-only: what the game holds in a slot right now, seen from an activity set. */
function SlotPeek({
  slot,
  identifiers,
  classType,
  ...lookups
}: GearLookups & {
  slot: InGameLoadoutSlot;
  identifiers: InGameLoadoutIdentifiers;
  classType: number;
}) {
  const { shown, resolved } = slotAsLoadout(slot, identifiers, classType, lookups);
  return (
    <section aria-label="This slot's current loadout" className="flex flex-col gap-2">
      <h4 className="d2-label">This slot&apos;s current loadout</h4>
      <LoadoutCardBodyArmorFirst saved={shown} resolved={resolved} manifest={lookups.manifest} />
    </section>
  );
}

/** A filled-or-empty slot as the game holds it now, and what can be done to it. */
export function CurrentSlotDetail({
  slot,
  identifiers,
  classType,
  disabled,
  onEdit,
  onCustomize,
  onReplace,
  onCopy,
  onDelete,
  ...lookups
}: GearLookups & {
  slot: InGameLoadoutSlot;
  identifiers: InGameLoadoutIdentifiers;
  classType: number;
  /** Gear is provisional, or something is already equipping. */
  disabled: boolean;
  onEdit: () => void;
  onCustomize: () => void;
  onReplace: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const { manifest } = lookups;
  const name = inGameSlotName(slot, identifiers);
  const frame = {
    slot,
    identifiers,
    title: name,
    label: `Slot ${slot.index + 1}, ${name}`,
    subtitle: `Slot ${slot.index + 1}`,
    manifest,
  };

  if (slot.empty) {
    return (
      <SlotDetailFrame
        {...frame}
        actions={
          <Button className={ACTION_CLASS} size="xs" onClick={onReplace} disabled={disabled}>
            <HugeiconsIcon icon={FloppyDiskIcon} aria-hidden />
            Save a loadout here
          </Button>
        }
      >
        <p className="text-muted-foreground text-sm">Nothing is saved in this slot.</p>
      </SlotDetailFrame>
    );
  }

  const { data, shown, resolved } = slotAsLoadout(slot, identifiers, classType, lookups);

  return (
    <SlotDetailFrame
      {...frame}
      data={data}
      titleAction={
        <TooltipLabel label="Change name, icon and color">
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-6 shrink-0"
            aria-label={`Customize ${name}`}
            onClick={onCustomize}
            disabled={disabled}
          >
            <HugeiconsIcon icon={PencilEdit02Icon} className="size-3.5" aria-hidden />
          </Button>
        </TooltipLabel>
      }
      actions={
        <>
          <Button className={ACTION_CLASS} size="xs" onClick={onEdit} disabled={disabled}>
            <HugeiconsIcon icon={PencilEdit02Icon} aria-hidden />
            Edit
          </Button>
          <Button className={ACTION_CLASS} size="xs" onClick={onReplace} disabled={disabled}>
            <HugeiconsIcon icon={ArrowDataTransferHorizontalIcon} aria-hidden />
            Replace
          </Button>
          <Button className={ACTION_CLASS} size="xs" onClick={onCopy} disabled={disabled}>
            <HugeiconsIcon icon={Copy01Icon} aria-hidden />
            Copy to Conflux
          </Button>
          <TooltipLabel label="Delete from the game">
            <Button
              size="icon"
              aria-label={`Delete ${name} from the game`}
              onClick={onDelete}
              disabled={disabled}
            >
              <HugeiconsIcon icon={Delete02Icon} aria-hidden />
            </Button>
          </TooltipLabel>
        </>
      }
    >
      <LoadoutCardBodyArmorFirst saved={shown} resolved={resolved} manifest={manifest} />
    </SlotDetailFrame>
  );
}

/** What's inside a large slot action: an icon, what it does, and a line of detail. */
function SlotCtaContent({
  icon,
  title,
  description,
}: {
  icon: IconSvgElement;
  title: string;
  description: string;
}) {
  return (
    <>
      <HugeiconsIcon icon={icon} className="text-muted-foreground size-5 shrink-0" aria-hidden />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm leading-5 font-medium">{title}</span>
        <span className="text-muted-foreground text-xs leading-4">{description}</span>
      </span>
    </>
  );
}

/** Picks a loadout from a popover anchored on `trigger`. */
function LoadoutPickPopover({
  trigger,
  align = "end",
  slotNumber,
  options,
  selectedId,
  manifest,
  onPick,
  children,
}: {
  trigger: ReactElement;
  align?: "start" | "end";
  slotNumber: number;
  options: readonly SavedLoadout[];
  selectedId?: string;
  manifest: Manifest;
  onPick: (saved: SavedLoadout) => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger}>{children}</PopoverTrigger>
      <PopoverContent align={align} className="d2-frost w-80 gap-2 p-2">
        <LoadoutPickList
          options={options}
          manifest={manifest}
          selectedId={selectedId}
          listLabel={`Loadouts for slot ${slotNumber}`}
          onPick={(saved) => {
            setOpen(false);
            onPick(saved);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * A slot within an activity set: the loadout assigned to it and what can be done to it,
 * or a list to assign one. `loadoutId` may point at a loadout that's since been deleted.
 */
export function SetSlotDetail({
  slot,
  identifiers,
  loadoutId,
  loadouts,
  labels,
  classType,
  peek,
  onPeekChange,
  canPeek,
  loadoutsLoaded,
  options,
  disabled,
  copyDisabled,
  onAssign,
  onCopySlot,
  onCustomize,
  onEditLoadout,
  ...lookups
}: GearLookups & {
  slot: InGameLoadoutSlot;
  identifiers: InGameLoadoutIdentifiers;
  loadoutId: string | undefined;
  /** The name, icon and colour the set chose for this slot, if any. */
  labels: SlotIdentifiers | undefined;
  classType: number;
  /** Also show what the game holds in this slot now, if the set leaves it alone. */
  peek: boolean;
  onPeekChange: (peek: boolean) => void;
  /** False when the game holds nothing in any slot. */
  canPeek: boolean;
  /** Every loadout, the set's private copies included. */
  loadouts: readonly SavedLoadout[];
  /** Until they're in, a loadout that can't be found may just not have loaded. */
  loadoutsLoaded: boolean;
  /** The player's own loadouts this set's character can wear. */
  options: readonly SavedLoadout[];
  /** The set is being saved in-game. */
  disabled: boolean;
  /** Gear is still provisional, so a copy made now could lose its mods. */
  copyDisabled: boolean;
  onAssign: (loadoutId: string | undefined) => void;
  onCopySlot: () => void;
  /** Called with the slot as the set will leave it. */
  onCustomize: (shown: InGameLoadoutSlot) => void;
  onEditLoadout: (saved: SavedLoadout) => void;
}) {
  const { pieceMap, weaponMap, manifest } = lookups;
  const name = inGameSlotName(slot, identifiers);
  const shown = slotAppearanceInSet(slot, !!loadoutId, identifiers, labels);
  const subtitle = `Slot ${slot.index + 1}, ${loadoutId ? inGameSlotName(shown, identifiers) : name}`;
  const saved = loadoutId ? loadouts.find((l) => l.id === loadoutId) : undefined;
  const frame = { slot: shown, identifiers, manifest };

  if (!loadoutId) {
    return (
      <SlotDetailFrame
        {...frame}
        title={subtitle}
        subtitle="Not in this set, so applying it leaves this slot alone"
        actions={null}
      >
        <div className="grid grid-cols-1 gap-3 @lg:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              className={cn(SLOT_CTA_CLASS, "flex-1")}
              onClick={onCopySlot}
              disabled={disabled || copyDisabled || slot.empty}
            >
              <SlotCtaContent
                icon={Copy01Icon}
                title="Copy what's in this slot"
                description={
                  slot.empty ? "Nothing is saved here in-game" : `Keep a copy of ${name} in this set`
                }
              />
            </button>
            <label
              className={cn(
                "border-foreground/10 bg-foreground/5 text-muted-foreground flex h-9 shrink-0 items-center gap-2 border px-3 text-xs transition-colors",
                canPeek ? "hover:text-foreground cursor-pointer" : "cursor-not-allowed opacity-50",
              )}
            >
              <Checkbox
                checked={peek}
                onCheckedChange={(checked) => onPeekChange(checked === true)}
                disabled={!canPeek}
              />
              Preview the slot in-game
            </label>
          </div>
          <LoadoutPickPopover
            trigger={<button type="button" className={SLOT_CTA_CLASS} disabled={disabled} />}
            align="start"
            slotNumber={slot.index + 1}
            options={options}
            manifest={manifest}
            onPick={(pick) => onAssign(pick.id)}
          >
            <SlotCtaContent
              icon={Add01Icon}
              title="Assign a loadout from Conflux"
              description={
                disabled ? "Wait for the set to finish applying" : "Choose one of your saved loadouts"
              }
            />
          </LoadoutPickPopover>
        </div>
        {peek && !slot.empty && (
          <SlotPeek slot={slot} identifiers={identifiers} classType={classType} {...lookups} />
        )}
      </SlotDetailFrame>
    );
  }

  const remove = (
    <TooltipLabel label="Remove from set">
      <Button
        size="icon"
        aria-label={`Remove slot ${slot.index + 1} from the set`}
        onClick={() => onAssign(undefined)}
        disabled={disabled}
      >
        <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} aria-hidden />
      </Button>
    </TooltipLabel>
  );
  const change = (
    <LoadoutPickPopover
      trigger={<Button className={ACTION_CLASS} size="xs" disabled={disabled} />}
      slotNumber={slot.index + 1}
      options={options}
      selectedId={loadoutId}
      manifest={manifest}
      onPick={(pick) => onAssign(pick.id)}
    >
      <HugeiconsIcon icon={ArrowDataTransferHorizontalIcon} aria-hidden />
      Change
    </LoadoutPickPopover>
  );

  if (!saved && !loadoutsLoaded) {
    return (
      <SlotDetailFrame {...frame} title="Loadout not loaded" subtitle={subtitle} actions={null}>
        <p className="text-muted-foreground text-sm">
          Your saved loadouts haven&apos;t loaded yet, so this slot can&apos;t be shown.
        </p>
      </SlotDetailFrame>
    );
  }

  if (!saved) {
    return (
      <SlotDetailFrame
        {...frame}
        title="Deleted loadout"
        titleClassName="text-warning"
        subtitle={subtitle}
        actions={
          <>
            {change}
            {remove}
          </>
        }
      >
        <p className="text-muted-foreground text-sm">
          The loadout assigned here has been deleted, so applying the set skips this slot.
        </p>
      </SlotDetailFrame>
    );
  }

  const resolved = resolveLoadout(saved.loadout, pieceMap, manifest, weaponMap);
  return (
    <SlotDetailFrame
      {...frame}
      title={saved.loadout.name}
      subtitle={subtitle}
      data={saved}
      actions={
        <>
          <TooltipLabel label="Change this slot's name, icon and color in the game">
            <Button
              className={ACTION_CLASS}
              size="xs"
              aria-label={`Customize slot ${slot.index + 1}`}
              onClick={() => onCustomize(shown)}
              disabled={disabled}
            >
              <HugeiconsIcon icon={PaintBrush01Icon} aria-hidden />
              Customize
            </Button>
          </TooltipLabel>
          {change}
          <Button
            className={ACTION_CLASS}
            size="xs"
            onClick={() => onEditLoadout(saved)}
            disabled={disabled}
          >
            <HugeiconsIcon icon={PencilEdit02Icon} aria-hidden />
            Edit
          </Button>
          {remove}
        </>
      }
    >
      <LoadoutCardBodyArmorFirst saved={saved} resolved={resolved} manifest={manifest} />
    </SlotDetailFrame>
  );
}
