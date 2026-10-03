"use client";

import { useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import {
  WEAPON_SLOTS,
  WEAPON_SLOT_LABELS,
  weaponSlotOfHash,
  type LoadoutWeapon,
  type WeaponSlot,
} from "@/lib/armory/weapons";
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

/** More than this many matches and the list asks for a narrower search instead. */
const MAX_OPTIONS = 60;

function whereLabel(weapon: LoadoutWeapon) {
  if (weapon.postmaster) return "Postmaster";
  if (weapon.location === "vault") return "Vault";
  return weapon.location === "equipped" ? "Equipped" : "On a character";
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
    <div className="flex min-w-0 items-center gap-1">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery("");
        }}
      >
        <PopoverTrigger
          aria-label={pick ? `${label} weapon: ${pickName ?? "Unknown weapon"}` : `Add ${label} weapon`}
          className="d2-hover-ring hover:bg-foreground/6 data-[popup-open]:bg-foreground/8 flex h-10 min-w-0 cursor-pointer items-center gap-2 pr-2 text-left outline-none transition-colors focus-visible:ring-1 focus-visible:ring-outline-strong"
        >
          {pick ? (
            <ArmorThumb
              icon={live?.icon ?? pickDef?.displayProperties.icon}
              watermark={live?.watermark}
              size={40}
              className={cn(!live && "opacity-50")}
            />
          ) : (
            <span className="d2-brackets size-10 shrink-0 bg-black/25" aria-hidden />
          )}
          <span className="flex min-w-0 flex-col">
            <span
              className={cn(
                "truncate text-sm leading-5",
                live?.isExotic && "text-exotic",
                !pick && "text-muted-foreground",
              )}
            >
              {pick ? (pickName ?? "Unknown weapon") : "None"}
            </span>
            <span className="flex items-center gap-2 text-[10px] leading-4">
              <span className="d2-label text-[10px]">{label}</span>
              {pick && !live && <span className="text-warning">Missing</span>}
            </span>
          </span>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 gap-2 p-2">
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
            className="flex max-h-72 flex-col overflow-y-auto overscroll-contain"
          >
            {options.slice(0, MAX_OPTIONS).map((weapon) => {
              const selected = weapon.instanceId === pick?.id;
              const blocked = weapon.isExotic && exoticElsewhere;
              return (
                <button
                  key={weapon.instanceId}
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
                    "hover:bg-foreground/6 focus-visible:bg-foreground/6 flex shrink-0 cursor-pointer items-center gap-2 p-1 text-left outline-none",
                    selected && "bg-foreground/10",
                    blocked && "cursor-not-allowed opacity-40",
                  )}
                >
                  <ArmorThumb icon={weapon.icon} watermark={weapon.watermark} size={32} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className={cn("truncate text-sm leading-5", weapon.isExotic && "text-exotic")}>
                      {weapon.name}
                    </span>
                    <span className="text-muted-foreground flex items-center gap-2 text-xs leading-4">
                      <span className="truncate">{weapon.typeName}</span>
                      <span className="shrink-0">{whereLabel(weapon)}</span>
                    </span>
                  </span>
                  {weapon.power !== undefined && (
                    <PowerValue value={weapon.power} size="xs" tone="gold" className="shrink-0" />
                  )}
                </button>
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
            className="text-muted-foreground hover:text-foreground flex size-6 shrink-0 cursor-pointer items-center justify-center outline-none focus-visible:ring-1 focus-visible:ring-outline-strong"
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
    <section
      aria-label="Weapons"
      className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 px-7 pb-3"
    >
      <span className="d2-label text-[10px]">Weapons</span>
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
