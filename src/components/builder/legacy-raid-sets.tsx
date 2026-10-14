"use client";

import { memo, useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { ArmorThumb } from "@/components/armor-thumb";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipLabel } from "@/components/ui/tooltip";
import {
  MAX_RAID_PIECES,
  type LegacyRaidInfo,
  type LegacyRaidKey,
  type RaidReqs,
} from "@/lib/armory/legacy-raids";
import { legacyRaidSlotIcons, type SetSlotIcon } from "@/lib/armory/sets";
import { ARMOR_SLOTS, SLOT_LABELS, type ArmorSlot } from "@/lib/armory/stats";
import type { Manifest } from "@/lib/manifest/load";
import { cn } from "@/lib/utils";

const COUNTS = Array.from({ length: MAX_RAID_PIECES + 1 }, (_, n) => n);

type SlotIcons = Partial<Record<ArmorSlot, SetSlotIcon>>;

/**
 * The Set bonuses card's Legacy raid sets block: one row per legacy raid this class owns
 * armor from, each with the slots the player has a piece in and how many of its pieces
 * every build must wear (Off, 1–5). Folded away until opened, unless a requirement is
 * already on.
 */
export const LegacyRaidSets = memo(function LegacyRaidSets({
  raids,
  reqs,
  onCountChange,
  manifest,
  classType,
}: {
  raids: LegacyRaidInfo[];
  reqs: RaidReqs;
  onCountChange: (key: LegacyRaidKey, count: number) => void;
  /** For the icons of the slots no owned piece covers. */
  manifest?: Manifest;
  classType: number | null;
}) {
  const [open, setOpen] = useState(() => Object.keys(reqs).length > 0);
  // The icons for unowned slots scan every item definition: wait for the first open,
  // then keep them while the block folds and unfolds.
  const [opened, setOpened] = useState(open);
  const icons = useMemo(
    () =>
      opened && manifest && classType !== null ? legacyRaidSlotIcons(manifest, classType) : null,
    [opened, manifest, classType],
  );
  const active = raids.filter((r) => reqs[r.key]).length;
  // The divider runs edge to edge: the negative margins cancel the card's padding,
  // which the matching padding gives back to the content.
  return (
    <div className="border-border -mx-3 mt-2 flex flex-col gap-3 border-t px-3 pt-4 normal:-mx-6 normal:px-6 normal:pt-5">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          setOpened(true);
        }}
        aria-expanded={open}
        className="hover:text-foreground focus-visible:ring-outline-strong flex cursor-pointer items-center justify-between gap-2 rounded-none pl-1 text-left text-sm outline-none focus-visible:ring-1 normal:rounded-[6px]"
      >
        <span className="tabular-nums">
          Legacy raid sets ({raids.length})
          {active > 0 && <span className="text-power ml-2">{active} required</span>}
        </span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>
      {open && (
        <LegacyRaidList raids={raids} reqs={reqs} onCountChange={onCountChange} icons={icons} />
      )}
    </div>
  );
});

/** The opened block: the explainer and one row per raid. */
function LegacyRaidList({
  raids,
  reqs,
  onCountChange,
  icons,
}: {
  raids: LegacyRaidInfo[];
  reqs: RaidReqs;
  onCountChange: (key: LegacyRaidKey, count: number) => void;
  icons: Map<LegacyRaidKey, SlotIcons> | null;
}) {
  return (
    <>
      <p className="text-muted-foreground pl-1 text-xs leading-relaxed">
        Armor 2.0 raid armor has no set bonus. Each piece has a raid mod socket instead,
        and those mods only work in that raid. Pick how many pieces every build must wear.
      </p>
      <div className="flex flex-col gap-3">
        {raids.map((r) => (
          <LegacyRaidRow
            key={r.key}
            raid={r}
            icons={icons?.get(r.key)}
            count={reqs[r.key] ?? 0}
            onCountChange={onCountChange}
          />
        ))}
      </div>
    </>
  );
}

function LegacyRaidRow({
  raid,
  icons,
  count,
  onCountChange,
}: {
  raid: LegacyRaidInfo;
  icons: SlotIcons | undefined;
  count: number;
  onCountChange: (key: LegacyRaidKey, count: number) => void;
}) {
  // The name over its slots, the count strip beside them. Phones: name and slots share
  // a line, the strip goes under them.
  return (
    <div className="flex items-center gap-4 pl-1 max-md:flex-col max-md:items-stretch max-md:gap-2">
      <div className="flex min-w-0 flex-1 flex-col gap-1 max-md:flex-row max-md:items-center max-md:justify-between">
        <span className="min-w-0 truncate text-sm">
          {raid.name} ({raid.ownedCount})
        </span>
        <RaidSlots raid={raid} icons={icons} />
      </div>
      <Tabs value={String(count)} onValueChange={(v) => onCountChange(raid.key, Number(v))}>
        <TabsList variant="icon" aria-label={`${raid.name} pieces every build must wear`}>
          {COUNTS.map((n) => (
            <TabsTrigger
              key={n}
              value={String(n)}
              disabled={n > raid.slotCount}
              aria-label={n === 0 ? "Not required" : `At least ${n}`}
            >
              {n === 0 ? "Off" : n}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}

/**
 * Helmet, arms, chest, legs, class item: the slots the player owns a piece of this raid
 * in at full strength, the rest greyed out (drawn with the raid's own icon for that slot).
 */
function RaidSlots({ raid, icons }: { raid: LegacyRaidInfo; icons: SlotIcons | undefined }) {
  return (
    <ul className="flex shrink-0 items-center gap-1" aria-label={`${raid.name} pieces owned`}>
      {ARMOR_SLOTS.map((slot) => {
        const owned = raid.slots[slot];
        const look = owned ?? icons?.[slot];
        const label = `${SLOT_LABELS[slot]}: ${owned ? owned.name : "not owned"}`;
        return (
          <TooltipLabel key={slot} label={label}>
            <li aria-label={label} className="flex">
              <ArmorThumb
                icon={look?.icon}
                watermark={look?.watermark}
                size={24}
                className={cn(!owned && "opacity-30 grayscale")}
              />
            </li>
          </TooltipLabel>
        );
      })}
    </ul>
  );
}
