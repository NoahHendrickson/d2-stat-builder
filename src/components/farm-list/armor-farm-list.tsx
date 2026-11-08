"use client";

import { useMemo } from "react";
import { ArmorThumb } from "@/components/armor-thumb";
import { FarmCard, FarmField, FarmPanel, farmDate } from "@/components/farm-list/farm-list-card";
import { ObtainedActions, RemoveButton } from "@/components/farm-list/farm-list-actions";
import { StatGlyph } from "@/components/stat-glyph";
import { isFullyMasterworked } from "@/lib/armory/masterwork";
import { armorPipTier, type ArmorPiece } from "@/lib/armory/normalize";
import { setIcon, setSlotIcons } from "@/lib/armory/sets";
import { CLASS_NAMES, STAT_HASHES, STAT_LABELS, STAT_ORDER, type StatIconMap } from "@/lib/armory/stats";
import { useArmory } from "@/lib/armory/use-armory";
import { armorFarmTitle } from "@/lib/farm-list/armor";
import type { ArmorFarmEntry, ArmorFarmRoll } from "@/lib/farm-list/types";
import type { Manifest } from "@/lib/manifest/load";

/** Every tertiary an archetype can roll: at this many, with any tuning, any roll will do. */
const ALL_TERTIARIES = 4;

const Muted = ({ children }: { children: string }) => <span className="text-muted-foreground">{children}</span>;

/**
 * The armor half of the Farm list, added from Theoretical and Dream builds. A match
 * already fits everything the entry asks, so unlike a weapon's extras there's nothing to
 * compare field by field.
 */
export function ArmorFarmPanel({
  entries,
  fresh,
  manifest,
}: {
  entries: ArmorFarmEntry[];
  fresh: ReadonlySet<string> | null;
  manifest: Manifest | undefined;
}) {
  const armory = useArmory().data;
  const pieces = useMemo(() => new Map(armory?.pieces.map((p) => [p.instanceId, p])), [armory]);
  const icons = useMemo(() => {
    const out = {} as StatIconMap;
    if (manifest)
      for (const key of STAT_ORDER)
        out[key] = manifest.def("DestinyStatDefinition", STAT_HASHES[key])?.displayProperties?.icon;
    return out;
  }, [manifest]);
  return (
    <FarmPanel
      title="Armor"
      entries={entries}
      empty="No armor yet."
      renderCard={(entry) => (
        <ArmorCard
          key={entry.id}
          entry={entry}
          isNew={fresh?.has(entry.id) ?? false}
          drop={entry.obtained ? (armory ? (pieces.get(entry.obtained.instanceId) ?? null) : undefined) : undefined}
          icons={icons}
          manifest={manifest}
        />
      )}
    />
  );
}

function ArmorCard({
  entry,
  isNew,
  drop,
  icons,
  manifest,
}: {
  entry: ArmorFarmEntry;
  isNew: boolean;
  /** The copy that matched; null once it's gone, undefined until that's known or without one. */
  drop: ArmorPiece | null | undefined;
  icons: StatIconMap;
  manifest: Manifest | undefined;
}) {
  const status = entry.obtained
    ? `Dropped ${farmDate.format(entry.obtained.at)}${drop === null ? ", since removed" : ""}`
    : `Added ${farmDate.format(entry.createdAt)}`;
  const anyRoll = entry.rolls.length >= ALL_TERTIARIES && entry.rolls.every((r) => r.tuned === null);
  return (
    <FarmCard
      id={entry.id}
      thumb={<CardThumb entry={entry} drop={drop} icons={icons} manifest={manifest} />}
      title={
        <>
          <span className="truncate font-medium">{armorFarmTitle(entry)}</span>
          <Stat stat={entry.primary} icons={icons} glyphOnly />
          <Stat stat={entry.secondary} icons={icons} glyphOnly />
        </>
      }
      isNew={isNew}
      status={status}
      actions={entry.obtained ? <ObtainedActions entry={entry} /> : <RemoveButton entry={entry} label="Remove" />}
    >
      <FarmField label="Class" column="class">
        <span>{CLASS_NAMES[entry.classType]}</span>
      </FarmField>
      {entry.setName && (
        <FarmField label="Set" column="set">
          <span className="truncate" title={entry.setName}>
            {entry.setName}
          </span>
        </FarmField>
      )}
      <FarmField label="Tertiary" column="tertiary">
        {anyRoll ? <Muted>Any</Muted> : entry.rolls.map((roll) => <Tertiary key={roll.tertiary} roll={roll} icons={icons} />)}
      </FarmField>
      <FarmField label="Tuned" column="tuned">
        {anyRoll ? <Muted>Any</Muted> : entry.rolls.map((roll) => <Tuned key={roll.tertiary} roll={roll} icons={icons} />)}
      </FarmField>
    </FarmCard>
  );
}

/** The drop itself, else the set's piece for the slot. */
function CardThumb({
  entry,
  drop,
  icons,
  manifest,
}: {
  entry: ArmorFarmEntry;
  drop: ArmorPiece | null | undefined;
  icons: StatIconMap;
  manifest: Manifest | undefined;
}) {
  const { setHash, slot, classType } = entry;
  const setLook = useMemo(() => {
    if (!manifest) return undefined;
    return setSlotIcons(manifest, setHash, classType)[slot] ?? setIcon(manifest, setHash, classType);
  }, [manifest, setHash, slot, classType]);
  if (drop?.icon) {
    return (
      <ArmorThumb
        icon={drop.icon}
        watermark={drop.watermark}
        alt=""
        size={48}
        masterworked={isFullyMasterworked(drop)}
        gearTier={armorPipTier(drop)}
      />
    );
  }
  if (setLook) {
    return <ArmorThumb icon={setLook.icon} watermark={setLook.watermark} alt="" size={48} gearTier={5} />;
  }
  return (
    <span className="d2-brackets flex size-12 shrink-0 items-center justify-center bg-black/25">
      <Stat stat={entry.primary} icons={icons} glyphOnly />
    </span>
  );
}

function Stat({ stat, icons, glyphOnly = false }: { stat: number; icons: StatIconMap; glyphOnly?: boolean }) {
  const key = STAT_ORDER[stat];
  const glyph = (
    <StatGlyph
      src={icons[key]}
      label={STAT_LABELS[key]}
      className="size-4 shrink-0"
      tint
      plain
      decorative={!glyphOnly}
    />
  );
  if (glyphOnly) return glyph;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      {glyph}
      {STAT_LABELS[key]}
    </span>
  );
}

// One line per roll in both fields, a fixed height so a tertiary sits level with its tuning.
const ROLL_LINE = "flex h-6 items-center gap-x-2";

function Tertiary({ roll, icons }: { roll: ArmorFarmRoll; icons: StatIconMap }) {
  return (
    <div className={ROLL_LINE}>
      <Stat stat={roll.tertiary} icons={icons} />
    </div>
  );
}

function Tuned({ roll, icons }: { roll: ArmorFarmRoll; icons: StatIconMap }) {
  return (
    <div className={ROLL_LINE}>
      {/* Several tuned stats that would do: just their glyphs, as Dream build lists them. */}
      {roll.tuned === null ? (
        <Muted>Any</Muted>
      ) : (
        roll.tuned.map((t) => <Stat key={t} stat={t} icons={icons} glyphOnly={roll.tuned!.length > 1} />)
      )}
    </div>
  );
}
