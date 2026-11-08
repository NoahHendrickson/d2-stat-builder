"use client";

import { useMemo, type ReactNode } from "react";
import { ArmorThumb } from "@/components/armor-thumb";
import {
  MutedCell,
  RollIdentity,
  RollThumb,
  StatName,
} from "@/components/builder/roll-card";
import { DetailCard, DetailSection } from "@/components/detail-card";
import type { ArmorSetInfo, SetSlotIcon, SetSlotIcons } from "@/lib/armory/sets";
import { ARMOR_SLOTS, SLOT_LABELS, type StatIconMap } from "@/lib/armory/stats";
import { summarizeTheory, type TheoryArchetypeSummary } from "@/lib/builder/theory-summary";
import type { TheoryRecipe } from "@/lib/optimizer/theory";

/** The stats in one cell, or "Any" when none is common enough to name. */
function StatCell({ stats, icons }: { stats: number[]; icons: StatIconMap }) {
  if (stats.length === 0) return <MutedCell>Any</MutedCell>;
  return (
    // Stacks in a narrow card, where two names side by side would crowd out the archetype.
    <div className="flex gap-x-3 gap-y-1 @max-md:flex-col">
      {stats.map((stat) => (
        <StatName key={stat} stat={stat} icons={icons} />
      ))}
    </div>
  );
}

/** One archetype to farm, in the build cards' columns. */
function ArchetypeRow({ archetype, icons }: { archetype: TheoryArchetypeSummary; icons: StatIconMap }) {
  return (
    <>
      <RollIdentity
        thumb={<RollThumb primary={archetype.primary} icons={icons} />}
        archetype={archetype}
        icons={icons}
      >
        <span className="text-muted-foreground tabular-nums">
          {Math.round(archetype.share * 100)}%
        </span>
      </RollIdentity>
      <StatCell stats={archetype.tertiaries} icons={icons} />
      <StatCell stats={archetype.tuned} icons={icons} />
    </>
  );
}

/** A labelled line under the archetypes, for what applies to the whole list. */
function SummaryLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="col-span-full flex flex-wrap items-center gap-x-4 gap-y-1">
      <span className="d2-label">{label}</span>
      {children}
    </div>
  );
}

/** A slot to farm: the set's own item, or an empty frame (Bungie has no art for a slot alone). */
function SlotPiece({ label, look }: { label: string; look?: SetSlotIcon }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {look ? (
        <ArmorThumb icon={look.icon} watermark={look.watermark} alt="" size={24} />
      ) : (
        <span aria-hidden className="d2-brackets size-6 shrink-0 bg-black/25" />
      )}
      {label}
    </span>
  );
}

/**
 * The gist of the list above the cards: the archetypes most of its pieces to farm are,
 * each with its own tertiary and tuning, then the slots and sets the list has in common.
 * Drawn from the exact builds, or the close ones when none make it.
 */
export function TheorySummaryCard({
  recipes,
  closeOnly,
  setMap,
  getSlotIcons,
  icons,
}: {
  recipes: TheoryRecipe[];
  closeOnly: boolean;
  setMap: Map<number, ArmorSetInfo>;
  getSlotIcons: (setHash: number) => SetSlotIcons;
  icons: StatIconMap;
}) {
  const summary = useMemo(() => summarizeTheory(recipes), [recipes]);
  // With several sets, nothing says which one a slot's piece would come from.
  const looks = useMemo(
    () => (summary?.setHashes.length === 1 ? getSlotIcons(summary.setHashes[0]) : undefined),
    [summary, getSlotIcons],
  );
  if (!summary) return null;
  const sets = summary.setHashes.flatMap((h) => setMap.get(h)?.name ?? []);
  const where =
    summary.builds === 1
      ? `the ${closeOnly ? "close " : ""}build below`
      : `the ${summary.builds} ${closeOnly ? "close " : ""}builds below`;
  return (
    <DetailCard>
      <DetailSection
        title="What to farm"
        description={`Most common among the pieces to farm in ${where}.`}
      >
        <div className="@container">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-6 gap-y-3 @max-md:gap-x-3">
            <div className="d2-label">Armor</div>
            <div className="d2-label">Tertiary</div>
            <div className="d2-label">Tuned</div>
            {summary.archetypes.map((a) => (
              <ArchetypeRow key={a.name} archetype={a} icons={icons} />
            ))}
            {summary.slots.length > 0 && (
              <SummaryLine label={summary.slots.length === 1 ? "Slot left" : "Slots left"}>
                {summary.slots.map((s) => (
                  <SlotPiece key={s} label={SLOT_LABELS[ARMOR_SLOTS[s]]} look={looks?.[ARMOR_SLOTS[s]]} />
                ))}
              </SummaryLine>
            )}
            {sets.length > 0 && (
              <SummaryLine label={sets.length === 1 ? "Set" : "Sets"}>
                {sets.map((name) => (
                  <span key={name}>{name}</span>
                ))}
              </SummaryLine>
            )}
          </div>
        </div>
      </DetailSection>
    </DetailCard>
  );
}
