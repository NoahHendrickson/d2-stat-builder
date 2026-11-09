"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, ArrowDown01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import {
  WEAPON_SLOTS,
  WEAPON_SLOT_LABELS,
  weaponSlotOfHash,
  type LoadoutWeapon,
  type WeaponPerks,
  type WeaponSlot,
} from "@/lib/armory/weapons";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import type { DimLoadoutItem } from "@/lib/dim/loadout-link";
import type { Manifest } from "@/lib/manifest/load";
import { ArmorThumb } from "@/components/armor-thumb";
import { PowerValue } from "@/components/power-value";
import { Input, SearchClearButton } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TooltipLabel } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface WeaponsSection {
  manifest: Manifest;
  /** Every weapon on the account — what the pickers offer. */
  owned: readonly LoadoutWeapon[];
  /** The loadout's weapon refs as saved. */
  initial: DimLoadoutItem[];
}

/** The editor's weapon picks: at most one per slot; an unset slot is left alone on equip. */
export type WeaponPicks = Partial<Record<WeaponSlot, DimLoadoutItem>>;

/** Seed the picks from the saved refs; a ref whose slot can't be told is dropped. */
export function initialWeaponPicks({ manifest, owned, initial }: WeaponsSection): WeaponPicks {
  const picks: WeaponPicks = {};
  for (const ref of initial) {
    const slot =
      owned.find((w) => w.instanceId === ref.id)?.slot ?? weaponSlotOfHash(manifest, ref.hash);
    if (slot && !picks[slot]) picks[slot] = ref;
  }
  return picks;
}

/** The picks as loadout refs, in slot order. */
export function weaponPickRefs(picks: WeaponPicks): DimLoadoutItem[] {
  return WEAPON_SLOTS.flatMap((slot) => (picks[slot] ? [picks[slot]] : []));
}

/**
 * An equipment slot (weapons, artifact): the game's icon well — a faint frame with
 * corner ticks — so the row reads as slots, not loose text. The loadout card shows it
 * as is; the editor's clickable version is LOADOUT_SLOT_CLASS.
 */
export const LOADOUT_SLOT_WELL_CLASS =
  "d2-corner-well flex h-full min-h-16 w-full min-w-0 items-center gap-3 p-2 text-left";

/** An equipment slot in the editor: the well, plus hover and open states. */
export const LOADOUT_SLOT_CLASS = `${LOADOUT_SLOT_WELL_CLASS} d2-hover-ring hover:[--tick-alpha:60%] data-[popup-open]:[--tick-alpha:60%] data-[popup-open]:bg-foreground/8 cursor-pointer outline-none transition-colors focus-visible:ring-1 focus-visible:ring-outline-strong`;

/** An unfilled slot: the empty-socket bracket corners around a plus. */
export function EmptySlotIcon() {
  return (
    <span className="d2-brackets text-muted-foreground flex size-12 shrink-0 items-center justify-center bg-foreground/6" aria-hidden>
      <HugeiconsIcon icon={Add01Icon} strokeWidth={1.5} className="size-4" />
    </span>
  );
}

/** More than this many matches and the list asks for a narrower search instead. */
const MAX_OPTIONS = 60;

/** One perk as the game draws it: a circle, filled blue when it's the one equipped. */
function WeaponPerk({
  hash,
  manifest,
  current,
  focusable,
  frameClass,
  iconClass,
  iconSize,
}: {
  hash: number;
  manifest: Manifest;
  current: boolean;
  /** Off when the perk sits inside a button, which already takes the focus. */
  focusable: boolean;
  frameClass: string;
  iconClass: string;
  iconSize: number;
}) {
  const def = manifest.def("DestinyInventoryItemDefinition", hash)?.displayProperties;
  const name = def?.name ?? "Unknown perk";
  return (
    <TooltipLabel label={current ? `${name} (equipped)` : name}>
      <span
        tabIndex={focusable ? 0 : undefined}
        className={cn(
          "border-foreground/12 flex items-center justify-center rounded-full border outline-none focus-visible:ring-1 focus-visible:ring-outline-strong",
          frameClass,
          current ? "bg-[#305f8e]" : "bg-foreground/4",
        )}
      >
        {def?.icon && (
          <Image
            src={`${BUNGIE_IMAGE_BASE}${def.icon}`}
            alt={name}
            width={iconSize}
            height={iconSize}
            className={iconClass}
            unoptimized
          />
        )}
      </span>
    </TooltipLabel>
  );
}

/** The perks a weapon has in each socket, in one line under its name. */
function EquippedPerks({ perks, manifest }: { perks: WeaponPerks; manifest: Manifest }) {
  return (
    <span className="flex items-center gap-1" aria-label="Equipped perks">
      {perks.columns.map((column, i) => (
        <WeaponPerk
          key={i}
          hash={column.current}
          manifest={manifest}
          current
          focusable={false}
          frameClass="size-6"
          iconClass="size-4"
          iconSize={16}
        />
      ))}
    </span>
  );
}

/**
 * A weapon's whole roll under its row in the picker, like the Manager's perk grid but
 * smaller: one column per perk socket, with the perk it has filled blue.
 */
function WeaponPerkGrid({ perks, manifest }: { perks: WeaponPerks; manifest: Manifest }) {
  return (
    <div className="d2-reveal flex gap-1 pt-1 pr-1 pb-2 pl-15" aria-label="Perks">
      {perks.columns.map((column, i) => (
        <div key={i} className="flex flex-col gap-1">
          {column.options.map((hash) => (
            <WeaponPerk
              key={hash}
              hash={hash}
              manifest={manifest}
              current={hash === column.current}
              focusable
              frameClass="size-7"
              iconClass="size-5"
              iconSize={20}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function SlotPicker({
  slot,
  section,
  pick,
  exoticElsewhere,
  onPick,
}: {
  slot: WeaponSlot;
  section: WeaponsSection;
  pick: DimLoadoutItem | undefined;
  /** Another slot already holds an exotic, so this one can't take one. */
  exoticElsewhere: boolean;
  onPick: (ref: DimLoadoutItem | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  /** The one weapon row opened to show its perks. */
  const [expanded, setExpanded] = useState<string | null>(null);
  const label = WEAPON_SLOT_LABELS[slot];

  const live = pick ? section.owned.find((w) => w.instanceId === pick.id) : undefined;
  const pickDef = pick
    ? section.manifest.def("DestinyInventoryItemDefinition", pick.hash)
    : undefined;
  const pickName = live?.name ?? pickDef?.displayProperties.name;

  const options = useMemo(() => {
    if (!open) return [];
    const q = query.trim().toLowerCase();
    return section.owned
      .filter(
        (w) =>
          w.slot === slot &&
          (!q || w.name.toLowerCase().includes(q) || w.typeName.toLowerCase().includes(q)),
      )
      .sort((a, b) => (b.power ?? 0) - (a.power ?? 0) || a.name.localeCompare(b.name));
  }, [open, query, section.owned, slot]);

  return (
    <div className="relative min-w-0">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setQuery("");
            setExpanded(null);
          }
        }}
      >
        <PopoverTrigger
          aria-label={pick ? `${label} weapon: ${pickName ?? "Unknown weapon"}` : `Add ${label} weapon`}
          className={cn(LOADOUT_SLOT_CLASS, pick && "pr-8")}
        >
          {pick ? (
            <ArmorThumb
              icon={live?.icon ?? pickDef?.displayProperties.icon}
              watermark={live?.watermark}
              size={48}
              masterworked={live?.masterworked}
              gearTier={live?.gearTier}
              className={cn(!live && "opacity-50")}
            />
          ) : (
            <EmptySlotIcon />
          )}
          <span className="flex min-w-0 flex-col">
            <span className="d2-label text-[10px] leading-4">{label}</span>
            <span
              className={cn(
                "truncate text-sm leading-5",
                live?.isExotic && "text-exotic",
                !pick && "text-muted-foreground",
              )}
            >
              {pick ? (pickName ?? "Unknown weapon") : "Add weapon"}
            </span>
            {pick && (
              <span className="text-muted-foreground truncate text-xs leading-4">
                {live ? live.typeName : <span className="text-warning">Missing</span>}
              </span>
            )}
          </span>
        </PopoverTrigger>
        <PopoverContent align="start" className="d2-frost w-(--anchor-width) min-w-80 gap-2 p-2">
          <div className="relative">
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${label.toLowerCase()} weapons`}
              aria-label={`Search ${label.toLowerCase()} weapons`}
              autoFocus
              className="pr-8"
            />
            {query.length > 0 && <SearchClearButton onClick={() => setQuery("")} />}
          </div>
          <div
            role="listbox"
            aria-label={`${label} weapons`}
            // pr-2.5: macOS overlay scrollbars ignore the gutter; keep the thumb off the chevrons.
            className="d2-scroll flex max-h-96 flex-col overflow-y-auto overscroll-contain pr-2.5"
          >
            {options.slice(0, MAX_OPTIONS).map((weapon) => {
              const selected = weapon.instanceId === pick?.id;
              const blocked = weapon.isExotic && exoticElsewhere;
              const isExpanded = expanded === weapon.instanceId;
              return (
                <div
                  key={weapon.instanceId}
                  role="none"
                  className={cn("flex shrink-0 flex-col", selected && "bg-foreground/10")}
                >
                  <div role="none" className="flex items-center">
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      aria-disabled={blocked || undefined}
                      title={blocked ? "Only one exotic weapon can be equipped" : undefined}
                      onClick={() => {
                        if (blocked) return;
                        onPick({ id: weapon.instanceId, hash: weapon.itemHash });
                        setOpen(false);
                        setQuery("");
                      }}
                      className={cn(
                        "hover:bg-foreground/6 focus-visible:bg-foreground/6 flex min-w-0 flex-1 cursor-pointer items-center gap-2 p-1 text-left outline-none",
                        blocked && "cursor-not-allowed opacity-40",
                      )}
                    >
                      <ArmorThumb
                        icon={weapon.icon}
                        watermark={weapon.watermark}
                        size={48}
                        masterworked={weapon.masterworked}
                        gearTier={weapon.gearTier}
                      />
                      <span className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="flex min-w-0 items-center gap-2">
                          <span
                            className={cn("min-w-0 flex-1 truncate text-sm leading-5", weapon.isExotic && "text-exotic")}
                          >
                            {weapon.name}
                            {weapon.masterworked && <span className="sr-only"> (masterworked)</span>}
                          </span>
                          {weapon.power !== undefined && (
                            <PowerValue value={weapon.power} size="xs" tone="gold" className="shrink-0" />
                          )}
                        </span>
                        {weapon.perks && (
                          <EquippedPerks perks={weapon.perks} manifest={section.manifest} />
                        )}
                      </span>
                    </button>
                    {weapon.perks && (
                      <button
                        type="button"
                        aria-expanded={isExpanded}
                        aria-label={`${isExpanded ? "Hide" : "Show"} ${weapon.name} perks`}
                        onClick={() => setExpanded(isExpanded ? null : weapon.instanceId)}
                        className="text-muted-foreground hover:text-foreground hover:bg-foreground/6 focus-visible:bg-foreground/6 flex w-8 shrink-0 cursor-pointer items-center justify-center self-stretch outline-none"
                      >
                        <HugeiconsIcon
                          icon={ArrowDown01Icon}
                          strokeWidth={2}
                          className={cn("size-4 transition-transform", isExpanded && "rotate-180")}
                          aria-hidden
                        />
                      </button>
                    )}
                  </div>
                  {isExpanded && weapon.perks && (
                    <WeaponPerkGrid perks={weapon.perks} manifest={section.manifest} />
                  )}
                </div>
              );
            })}
            {options.length === 0 && (
              <p className="text-muted-foreground p-2 text-xs">
                {query ? "No weapons match." : `You have no ${label.toLowerCase()} weapons.`}
              </p>
            )}
            {options.length > MAX_OPTIONS && (
              <p className="text-muted-foreground p-2 text-xs">
                Showing {MAX_OPTIONS} of {options.length}. Search to narrow it down.
              </p>
            )}
          </div>
        </PopoverContent>
      </Popover>
      {pick && (
        <TooltipLabel label={`Remove ${label.toLowerCase()} weapon`}>
          <button
            type="button"
            aria-label={`Remove ${label.toLowerCase()} weapon`}
            onClick={() => onPick(undefined)}
            className="text-muted-foreground hover:text-foreground absolute top-1.5 right-1.5 flex size-6 cursor-pointer items-center justify-center outline-none focus-visible:ring-1 focus-visible:ring-outline-strong"
          >
            <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-3.5" aria-hidden />
          </button>
        </TooltipLabel>
      )}
    </div>
  );
}

/**
 * The loadout's weapons: one optional pick per slot. A slot left at "None" isn't touched
 * when the loadout is equipped, so clearing all three keeps the loadout armor-only.
 */
export function LoadoutWeaponsEditor({
  section,
  value,
  onChange,
}: {
  section: WeaponsSection;
  value: WeaponPicks;
  onChange: (next: WeaponPicks) => void;
}) {
  const exoticSlot = WEAPON_SLOTS.find((slot) => {
    const id = value[slot]?.id;
    return id !== undefined && section.owned.find((w) => w.instanceId === id)?.isExotic;
  });
  return (
    // `contents`: the three slots sit straight in the editor's slot grid.
    <section aria-label="Weapons" className="contents">
      {WEAPON_SLOTS.map((slot) => (
        <SlotPicker
          key={slot}
          slot={slot}
          section={section}
          pick={value[slot]}
          exoticElsewhere={exoticSlot !== undefined && exoticSlot !== slot}
          onPick={(ref) => {
            const next = { ...value };
            if (ref) next[slot] = ref;
            else delete next[slot];
            onChange(next);
          }}
        />
      ))}
    </section>
  );
}
