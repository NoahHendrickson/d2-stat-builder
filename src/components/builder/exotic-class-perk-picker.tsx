"use client";

import { TooltipLabel } from "@/components/ui/tooltip";
import type { ReactNode } from "react";
import Image from "next/image";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import { STAT_LABELS, STAT_ORDER, type StatIconMap } from "@/lib/armory/stats";
import type { SpiritPerkInfo } from "@/lib/armory/exotic-class-perks";

const ANY_VALUE = "any";

/**
 * Two-column Spirit perk picker for exotic class items. "Any" leaves that column
 * unconstrained; a concrete pair drives owned-roll filtering + theoretical synthesis.
 * Left options show the Armor 3.0 archetype icon; right options show the tertiary
 * stat icon.
 */
export function ExoticClassPerkPicker({
  left,
  right,
  selected,
  onChange,
  statIcons,
}: {
  left: SpiritPerkInfo[];
  right: SpiritPerkInfo[];
  selected: [number | null, number | null];
  onChange: (next: [number | null, number | null]) => void;
  statIcons: StatIconMap;
}) {
  return (
    <div>
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Exotic class item perks</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <SpiritSelect
            ariaLabel="Left perk"
            options={left}
            value={selected[0]}
            onChange={(v) => onChange([v, selected[1]])}
            affordance="archetype"
          />
          <SpiritSelect
            ariaLabel="Right perk"
            options={right}
            value={selected[1]}
            onChange={(v) => onChange([selected[0], v])}
            affordance="tertiary"
            statIcons={statIcons}
          />
        </div>
      </div>
      <p className="text-muted-foreground mt-3 text-xs">
        Left perk sets the archetype (30/25); right perk sets the tertiary (20).
        Unowned pairs use a theoretical roll.
      </p>
    </div>
  );
}

function SpiritSelect({
  ariaLabel,
  options,
  value,
  onChange,
  affordance,
  statIcons,
}: {
  ariaLabel: string;
  options: SpiritPerkInfo[];
  value: number | null;
  onChange: (next: number | null) => void;
  affordance?: "archetype" | "tertiary";
  statIcons?: StatIconMap;
}) {
  // Base UI Select.Value shows the raw value unless `items` maps it to a label.
  const items: Record<string, ReactNode> = { [ANY_VALUE]: "Any" };
  for (const p of options) {
    items[String(p.hash)] = affordance ? (
      <SpiritLabel perk={p} affordance={affordance} statIcons={statIcons} />
    ) : (
      p.name
    );
  }

  return (
    <Select
      items={items}
      value={value === null ? ANY_VALUE : String(value)}
      onValueChange={(v) => {
        if (v == null || v === ANY_VALUE) onChange(null);
        else onChange(Number(v));
      }}
    >
      <SelectTrigger className="w-full" aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY_VALUE}>Any</SelectItem>
        {options.map((p) => (
          <SelectItem key={p.hash} value={String(p.hash)}>
            {affordance ? (
              <SpiritLabel
                perk={p}
                affordance={affordance}
                statIcons={statIcons}
              />
            ) : (
              p.name
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SpiritLabel({
  perk,
  affordance,
  statIcons,
}: {
  perk: SpiritPerkInfo;
  affordance: "archetype" | "tertiary";
  statIcons?: StatIconMap;
}) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <span className="min-w-0 flex-1 truncate">{perk.name}</span>
      {affordance === "archetype" ? (
        <ArchetypeAffordance perk={perk} />
      ) : (
        <TertiaryAffordance perk={perk} statIcons={statIcons} />
      )}
    </span>
  );
}

function ArchetypeAffordance({ perk }: { perk: SpiritPerkInfo }) {
  if (!perk.archetypeIcon) return null;
  return (
    <TooltipLabel label={perk.archetypeName}>
      <Image
        src={`${BUNGIE_IMAGE_BASE}${perk.archetypeIcon}`}
        alt={perk.archetypeName ?? "Archetype"}
        tabIndex={0}
        width={16}
        height={16}
        className="size-4 shrink-0"
        unoptimized
      />
    </TooltipLabel>
  );
}

function TertiaryAffordance({
  perk,
  statIcons,
}: {
  perk: SpiritPerkInfo;
  statIcons?: StatIconMap;
}) {
  const idx = perk.preferredTertiary;
  if (idx === undefined || !statIcons) return null;
  const key = STAT_ORDER[idx];
  const icon = statIcons[key];
  if (!icon) return null;
  const label = STAT_LABELS[key];
  return (
    <TooltipLabel label={`${label} tertiary`}>
      <Image
        src={`${BUNGIE_IMAGE_BASE}${icon}`}
        alt={label}
        tabIndex={0}
        width={16}
        height={16}
        className="size-4 shrink-0 invert dark:invert-0"
        unoptimized
      />
    </TooltipLabel>
  );
}
