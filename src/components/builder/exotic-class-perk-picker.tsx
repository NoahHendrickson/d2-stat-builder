"use client";

import { TooltipLabel } from "@/components/ui/tooltip";
import { HugeiconsIcon } from "@hugeicons/react";
import { Alert02Icon } from "@hugeicons/core-free-icons";
import { memo, type ReactNode } from "react";
import Image from "next/image";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import { cn } from "@/lib/utils";
import { STAT_LABELS, STAT_ORDER, type StatIconMap } from "@/lib/armory/stats";
import {
  matchesSpiritSelection,
  type SpiritPerkInfo,
} from "@/lib/armory/exotic-class-perks";

const ANY_VALUE = "any";

/**
 * Two-column Spirit perk picker for exotic class items. "Any" leaves that column
 * unconstrained; a concrete pair drives owned-roll filtering + theoretical synthesis.
 * Left options show the Armor 3.0 archetype icon; right options show the tertiary
 * stat icon. Each option counts the owned rolls it would match, and an unowned pair
 * says so plainly: its builds use a roll the player can't equip.
 */
export const ExoticClassPerkPicker = memo(function ExoticClassPerkPicker({
  left,
  right,
  selected,
  onChange,
  statIcons,
  itemName,
  owned,
  legacyExotics,
}: {
  left: SpiritPerkInfo[];
  right: SpiritPerkInfo[];
  selected: [number | null, number | null];
  onChange: (next: [number | null, number | null]) => void;
  statIcons: StatIconMap;
  itemName: string;
  /** Spirit pairs of every owned roll of this class item; `tiered` = has a tuning socket. */
  owned: { perks: [number, number]; tiered: boolean }[];
  /** Whether legacy (untiered) exotics are in the pool. */
  legacyExotics: boolean;
}) {
  const [l, r] = selected;
  const leftCounts = countBy(owned, (o) => (r === null || o.perks[1] === r ? o.perks[0] : null));
  const rightCounts = countBy(owned, (o) => (l === null || o.perks[0] === l ? o.perks[1] : null));
  const matches = l !== null && r !== null ? owned.filter((o) => matchesSpiritSelection(o.perks, selected)) : [];
  const usable = legacyExotics ? matches : matches.filter((o) => o.tiered);

  return (
    <div>
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Exotic class item perks</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <SpiritSelect
            ariaLabel="Left perk"
            options={left}
            counts={leftCounts}
            value={selected[0]}
            onChange={(v) => onChange([v, selected[1]])}
            affordance="archetype"
          />
          <SpiritSelect
            ariaLabel="Right perk"
            options={right}
            counts={rightCounts}
            value={selected[1]}
            onChange={(v) => onChange([selected[0], v])}
            affordance="tertiary"
            statIcons={statIcons}
          />
        </div>
      </div>
      <p className="text-muted-foreground mt-3 text-xs">
        Left perk sets the archetype (30/25); right perk sets the tertiary (20).
      </p>
      {l !== null && r !== null && usable.length === 0 && (
        <p className="text-warning mt-2 flex items-start gap-2 text-xs" role="status">
          <HugeiconsIcon icon={Alert02Icon} className="mt-px size-4 shrink-0" aria-hidden />
          <span>
            {matches.length > 0
              ? `Your ${itemName} with this pair is a legacy roll and Legacy exotics is off.`
              : `You don't own ${itemName} with this pair.`}{" "}
            Builds use a theoretical roll you can&apos;t equip.
          </span>
        </p>
      )}
    </div>
  );
});

/** How many items map to each key; null keys are skipped. */
function countBy<T>(items: T[], key: (item: T) => number | null): Map<number, number> {
  const out = new Map<number, number>();
  for (const item of items) {
    const k = key(item);
    if (k !== null) out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

function SpiritSelect({
  ariaLabel,
  options,
  counts,
  value,
  onChange,
  affordance,
  statIcons,
}: {
  ariaLabel: string;
  options: SpiritPerkInfo[];
  /** Owned rolls each option would match, given the other column. */
  counts: ReadonlyMap<number, number>;
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
                owned={counts.get(p.hash) ?? 0}
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
  owned,
}: {
  perk: SpiritPerkInfo;
  affordance: "archetype" | "tertiary";
  statIcons?: StatIconMap;
  /** Owned rolls this option matches; undefined in the closed trigger. */
  owned?: number;
}) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <span className={cn("min-w-0 flex-1 truncate", owned === 0 && "text-muted-foreground")}>{perk.name}</span>
      {owned !== undefined && (
        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
          {owned > 0 ? `${owned} owned` : "Not owned"}
        </span>
      )}
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
