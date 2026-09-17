"use client";

import { useState } from "react";
import Image from "next/image";
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cn } from "@/lib/utils";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import { CLASS_NAMES } from "@/lib/armory/stats";
import type { ArmoryCharacter } from "@/lib/armory/fetch";
import { characterForClass } from "@/lib/armory/character-for-class";
import { PowerValue } from "@/components/power-value";

/**
 * Square nameplates with a 1px frame. The selected one gets the game's white
 * outline + glow (an outside box-shadow, so the row never changes size);
 * the others sit dimmed until hovered.
 */
const tabBase =
  "relative flex-1 shrink-0 cursor-pointer overflow-hidden rounded-[7px] border text-left outline-none transition-[opacity,box-shadow,border-color] classic:focus-visible:ring-3 classic:focus-visible:ring-ring/50 focus-visible:d2-tile-selected d2:rounded-md";

const tabInactive =
  "border-[var(--neutral-line)] opacity-80 hover:opacity-100 d2:border-foreground/15 d2:opacity-75 d2:saturate-[0.85] d2:hover:opacity-100 d2:hover:saturate-100 d2:hover:border-foreground/40";

const tabSelected =
  "d2-tile-selected border-background opacity-100 classic:shadow-[0_0_0_2px_var(--background),0_0_0_4px_var(--emphatic)] d2:border-foreground";

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
  const classTypes = [
    ...new Set(characters.map((c) => c.classType)),
  ].filter((ct) => CLASS_NAMES[ct] !== undefined);
  return classTypes.map((ct) => characterForClass(characters, ct)!);
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
      className={cn(tabBase, active ? tabSelected : tabInactive)}
    >
      <span className="relative block h-14 overflow-hidden rounded-[6px] d2:rounded-none">
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
            style={
              fallbackColor ? { backgroundColor: fallbackColor } : undefined
            }
          />
        )}

        {/* Scrim so the class name + Power stay legible over any emblem art. */}
        <div className="absolute inset-0 bg-gradient-to-r from-black/10 via-black/45 to-black/75" />

        {/* The nameplate text block: class in bold, "// POWER" beneath. */}
        <div className="absolute inset-y-0 right-0 flex flex-col items-end justify-center gap-0.5 px-2.5 text-right">
          <span className="d2-heading text-xs leading-none text-white uppercase drop-shadow classic:font-semibold classic:tracking-wide">
            {name}
          </span>
          <span className="flex items-baseline gap-1 text-[10px] leading-none text-white/90 d2:text-white/70">
            <span aria-hidden className="hidden d2:inline">{"//"}</span>
            <PowerValue value={character.light} size="xs" className="drop-shadow" />
          </span>
        </div>
      </span>
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
      <TabsPrimitive.List className="flex gap-2 p-1.5 d2:gap-3 d2:p-1">
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
