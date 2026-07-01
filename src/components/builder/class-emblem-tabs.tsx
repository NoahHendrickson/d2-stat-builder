"use client";

import { useState } from "react";
import Image from "next/image";
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cn } from "@/lib/utils";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import { CLASS_NAMES } from "@/lib/armory/stats";
import type { ArmoryCharacter } from "@/lib/armory/fetch";

interface ClassEmblemTabsProps {
  /** All of the player's characters; grouped into one tab per class internally. */
  characters: ArmoryCharacter[];
  /** Selected classType. */
  value: number;
  onChange: (classType: number) => void;
}

/**
 * One emblem per class: the most-recently-played character of each class, in the
 * order the classes first appear. Map insertion order preserves first-appearance
 * (re-`set`ting an existing key keeps its position), matching the app's existing
 * class ordering while letting a later, more-recently-played character win the emblem.
 */
function emblemPerClass(characters: ArmoryCharacter[]): ArmoryCharacter[] {
  const best = new Map<number, ArmoryCharacter>();
  for (const c of characters) {
    if (CLASS_NAMES[c.classType] === undefined) continue;
    const cur = best.get(c.classType);
    if (!cur || c.dateLastPlayed > cur.dateLastPlayed) best.set(c.classType, c);
  }
  return [...best.values()];
}

/** A single class tab, rendered as the character's equipped emblem nameplate. */
function EmblemTab({
  character,
  active,
}: {
  character: ArmoryCharacter;
  active: boolean;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const name = CLASS_NAMES[character.classType];
  const showImage = Boolean(character.emblemBackgroundPath) && !imgFailed;
  const fallbackColor = character.emblemColor
    ? `rgb(${character.emblemColor.red} ${character.emblemColor.green} ${character.emblemColor.blue})`
    : undefined;

  return (
    <TabsPrimitive.Tab
      value={String(character.classType)}
      aria-label={`${name}, Power ${character.light}`}
      className={cn(
        "relative h-14 flex-1 overflow-hidden rounded-md border text-left transition-all",
        "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
        // Option B: all emblems stay full color; the active one gets a bright ring,
        // the inactive ones are only slightly dimmed.
        active
          ? "border-primary ring-primary opacity-100 shadow-sm ring-2"
          : "border-border/60 hover:border-border opacity-80 hover:opacity-100",
      )}
    >
      {showImage ? (
        <Image
          src={`${BUNGIE_IMAGE_BASE}${character.emblemBackgroundPath}`}
          alt=""
          fill
          sizes="200px"
          // Left-anchored so the emblem's icon edge stays visible when cropped.
          className="object-cover object-left"
          onError={() => setImgFailed(true)}
          unoptimized
        />
      ) : (
        <div
          className="bg-muted absolute inset-0"
          style={fallbackColor ? { backgroundColor: fallbackColor } : undefined}
        />
      )}

      {/* Scrim so the class name + Power stay legible over any emblem art. */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent" />

      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-1 px-2 py-1.5">
        <span className="text-xs font-semibold tracking-wide text-white uppercase drop-shadow">
          {name}
        </span>
        <span className="text-[10px] font-medium text-white/90 tabular-nums drop-shadow">
          ✦ {character.light}
        </span>
      </div>
    </TabsPrimitive.Tab>
  );
}

/**
 * Class selector rendered as Destiny emblem nameplates — one per class, pulled from
 * the player's own characters. Built on the Base UI Tabs primitive (matching the app's
 * shadcn Tabs) so keyboard navigation and tablist semantics come for free.
 */
export function ClassEmblemTabs({
  characters,
  value,
  onChange,
}: ClassEmblemTabsProps) {
  const tabs = emblemPerClass(characters);

  return (
    <TabsPrimitive.Root
      value={String(value)}
      onValueChange={(v) => onChange(Number(v))}
    >
      <TabsPrimitive.List className="flex gap-2">
        {tabs.map((character) => (
          <EmblemTab
            key={character.classType}
            character={character}
            active={character.classType === value}
          />
        ))}
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  );
}
