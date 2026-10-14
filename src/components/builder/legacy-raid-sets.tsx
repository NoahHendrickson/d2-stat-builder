"use client";

import { memo, useMemo } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { ArmorThumb } from "@/components/armor-thumb";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipLabel } from "@/components/ui/tooltip";
import {
  MAX_RAID_PIECES,
  legacyRaidName,
  raidCountConflict,
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
 * every build must wear (Off, 1–5). The fold state is the caller's, so it outlives the
 * search and the tab switches; the header counts every requirement, shown or not.
 */
export const LegacyRaidSets = memo(function LegacyRaidSets({
  raids,
  allRaids,
  query,
  reqs,
  reserved,
  onCountChange,
  open,
  onOpenChange,
  manifest,
  classType,
}: {
  /** The raids the set search leaves. */
  raids: LegacyRaidInfo[];
  /** Every raid this class owns armor from, before the search: what has to fit. */
  allRaids: LegacyRaidInfo[];
  query: string;
  reqs: RaidReqs;
  /**
   * Armor pieces promised elsewhere: set bonus pieces, the exotic, a pinned class item.
   * A count that couldn't fit beside them and the other raids is disabled.
   */
  reserved: number;
  onCountChange: (key: LegacyRaidKey, count: number) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** For the icons of the slots no owned piece covers. */
  manifest?: Manifest;
  classType: number | null;
}) {
  // A full item-table scan the first time, then cached for the session (sets.ts).
  const icons = useMemo(
    () => (open && manifest && classType !== null ? legacyRaidSlotIcons(manifest, classType) : null),
    [open, manifest, classType],
  );
  const active = Object.keys(reqs).length;
  const conflict = raidCountConflict(reqs, allRaids, reserved);
  // The divider runs edge to edge: the negative margins cancel the card's padding,
  // which the matching padding gives back to the content.
  return (
    <div className="border-border -mx-3 mt-2 flex flex-col gap-3 border-t px-3 pt-4 normal:-mx-6 normal:px-6 normal:pt-5">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        className="hover:text-foreground focus-visible:ring-outline-strong flex cursor-pointer items-center justify-between gap-2 rounded-none pl-1 text-left text-sm outline-none focus-visible:ring-1 normal:rounded-[6px]"
      >
        <span className="tabular-nums">
          Legacy raid sets ({allRaids.length})
          {active > 0 && <span className="text-power ml-2">{active} required</span>}
        </span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>
      {open && (
        <>
          <p className="text-muted-foreground pl-1 text-xs leading-relaxed">
            Armor 2.0 raid armor has no set bonus. Each piece has a raid mod socket instead,
            and those mods only work in that raid. Pick how many pieces every build must
            wear.
          </p>
          {conflict && (
            <p className="text-warning pl-1 text-xs leading-relaxed" role="status">
              {conflict.kind === "total"
                ? `These raid pieces, set bonuses and exotic need ${conflict.pieces} armor pieces, but a build wears ${ARMOR_SLOTS.length}, so no build can match.`
                : `Your ${listRaids(conflict.raids)} pieces only cover ${coveredSlots(conflict.raids, allRaids)} armor slots${conflict.raids.length > 1 ? " between them" : ""}, too few for these counts, so no build can match.`}{" "}
              Lower a count.
            </p>
          )}
          {raids.length === 0 ? (
            <p className="text-muted-foreground pl-1 text-xs">
              No legacy raids match &quot;{query.trim()}&quot;.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {raids.map((r) => {
                const count = reqs[r.key] ?? 0;
                return (
                  <LegacyRaidRow
                    key={r.key}
                    raid={r}
                    icons={icons?.get(r.key)}
                    count={count}
                    // A count is offered only if one build could still wear it beside
                    // every other requirement, in slots of their own.
                    fits={(n) => !raidCountConflict({ ...reqs, [r.key]: n }, allRaids, reserved)}
                    onCountChange={onCountChange}
                  />
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
});

function LegacyRaidRow({
  raid,
  icons,
  count,
  fits,
  onCountChange,
}: {
  raid: LegacyRaidInfo;
  icons: SlotIcons | undefined;
  count: number;
  /** Whether this raid at count `n` still fits; the current count stays pickable regardless. */
  fits: (n: number) => boolean;
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
              disabled={n !== count && n > 0 && !fits(n)}
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

/** "Deep Stone Crypt", "Deep Stone Crypt and Vow of the Disciple", "A, B and C". */
function listRaids(keys: LegacyRaidKey[]): string {
  const names = keys.map(legacyRaidName);
  return names.length < 2
    ? names.join("")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** How many distinct armor slots these raids' owned pieces cover. */
function coveredSlots(keys: LegacyRaidKey[], raids: LegacyRaidInfo[]): number {
  const slots = new Set<string>();
  for (const r of raids) if (keys.includes(r.key)) for (const s of Object.keys(r.slots)) slots.add(s);
  return slots.size;
}
