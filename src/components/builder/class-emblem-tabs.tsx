"use client";

import { useState } from "react";
import Image from "next/image";
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cn } from "@/lib/utils";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import { CLASS_NAMES } from "@/lib/armory/stats";
import type { ArmoryCharacter } from "@/lib/armory/fetch";
import { characterForClass } from "@/lib/armory/character-for-class";

/** Figma 127:9 frame+face recipe — outer tab carries border + lip; inner span is the face. */
const tabFrameBase =
  "relative flex-1 shrink-0 cursor-pointer rounded-md border pb-0.5 text-left outline-none transition-all active:translate-y-0.5 active:pb-px focus-visible:ring-3 focus-visible:ring-ring/50";

const tabFrameInactive =
  "border-[var(--neutral-line)] bg-[var(--neutral-shadow)] opacity-80 hover:opacity-100";

const tabFrameActive =
  "border-brand bg-[var(--brand-shadow)] opacity-100 shadow-[0_0_0_1px_var(--brand),0_0_12px_3px_rgb(67_142_255/0.35)]";

const tabFaceBase =
  "relative -mx-px -mt-px block h-14 overflow-hidden rounded-md border";

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
      className={cn(
        tabFrameBase,
        active ? tabFrameActive : tabFrameInactive,
      )}
    >
      <span
        className={cn(
          tabFaceBase,
          active
            ? "border-brand"
            : "border-[var(--neutral-line)]",
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
            style={
              fallbackColor ? { backgroundColor: fallbackColor } : undefined
            }
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
      <TabsPrimitive.List className="flex gap-2 p-0.5">
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
