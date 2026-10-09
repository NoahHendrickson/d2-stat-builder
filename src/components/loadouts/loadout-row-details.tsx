"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipLabel,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Fragment } from "react";
import Image from "next/image";
import type { ArmoryCharacter } from "@/lib/armory/fetch";
import { buildFragmentStats, formatFragmentStats, SUBCLASS_LINE, subclassFromPlug, type Subclass } from "@/lib/armory/fragments";
import { isStrandSharedAbilityIcon } from "@/lib/dim/subclasses";
import {
  STRAND_ABILITY_PLATE_FILTER,
  StrandAbilityRecolor,
} from "@/components/loadouts/strand-ability-recolor";
import type { Manifest } from "@/lib/manifest/load";
import {
  SLOT_LABELS,
  STAT_DISPLAY_ORDER,
  STAT_LABELS,
  STAT_ORDER,
  type StatIconMap,
} from "@/lib/armory/stats";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import { lastPlayedCharacter } from "@/lib/bungie/equip-client";
import type { ResolvedLoadout } from "@/lib/loadouts/resolve";
import type { SavedLoadout } from "@/lib/loadouts/types";
import { StatGlyph } from "@/components/stat-glyph";
import { ArmorThumb } from "@/components/armor-thumb";
import { isFullyMasterworked } from "@/lib/armory/masterwork";
import { cn } from "@/lib/utils";
import { armorPipTier } from "@/lib/armory/normalize";

const STAT_COLS = STAT_DISPLAY_ORDER.map((key) => ({
  key,
  i: STAT_ORDER.indexOf(key),
}));
/** Name column takes the slack; the six stat columns and Tuned stay fixed. */
const DETAIL_COLS = "minmax(0,1fr) repeat(6, 2.25rem) 3rem";

/**
 * Light white hairline frame for subclass plugs and the artifact, drawn on an overlay so
 * it sits on top of the icon (an inset shadow on the <img> itself paints under the art).
 * The host must be `relative`.
 */
export const TILE_FRAME =
  "after:pointer-events-none after:absolute after:inset-0 after:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.4)]";

/**
 * Armor mod categories whose art leaves out the square plate (white at ~14%) that the
 * rest of the mod icons bake in: tuning mods and the newer raid mods. Painted behind
 * them so a row of mods reads as one set of tiles.
 */
const PLATELESS_MOD = /\.tuning\.mods$|^enhancements\.raid_v[78]\d\d$/;

/** Icon + name for a plug/mod hash, from the manifest; falls back to the hash. */
export function PlugIcon({
  hash,
  manifest,
  dim = false,
  suffix,
  size = 24,
  sizeClassName,
  className,
  classType,
  element,
  framed: framedProp = false,
}: {
  hash: number;
  manifest: Manifest;
  dim?: boolean;
  suffix?: string;
  size?: 16 | 20 | 24 | 32 | 40;
  /** Overrides the size classes (e.g. a container-query step); `size` still sets the image's pixels. */
  sizeClassName?: string;
  className?: string;
  /** When set, append armor-stat bonuses (fragments' +10 / −10). */
  classType?: number;
  /** Subclass damage type: marks a subclass plug (aspects / fragments), which gets a frame. */
  element?: Subclass;
  /** Frame a plug that isn't a subclass plug (artifact perks). */
  framed?: boolean;
}) {
  const def = manifest.def("DestinyInventoryItemDefinition", hash);
  const name = def?.displayProperties?.name ?? `#${hash}`;
  const stats =
    classType === undefined
      ? ""
      : formatFragmentStats(
          buildFragmentStats(def?.investmentStats, classType).stats,
        );
  const title = suffix ? `${name} — ${suffix}` : name;
  const label = stats ? `${title}\n${stats}` : title;
  const icon = def?.displayProperties?.icon;
  const recolor = isStrandSharedAbilityIcon(def?.plug?.plugCategoryIdentifier);
  const plate = PLATELESS_MOD.test(def?.plug?.plugCategoryIdentifier ?? "");
  const framed = framedProp || (subclassFromPlug(def) ?? element) !== undefined;
  const sizeClass =
    sizeClassName ??
    (size === 16
      ? "size-4"
      : size === 20
        ? "size-5"
        : size === 32
          ? "size-8"
          : size === 40
            ? "size-10"
            : "size-6");
  return icon ? (
    <TooltipLabel label={label}>
      <span
        className={cn(
          sizeClass,
          "relative inline-flex shrink-0",
          recolor && "isolate",
          framed && TILE_FRAME,
        )}
        tabIndex={0}
      >
        <Image
          src={`${BUNGIE_IMAGE_BASE}${icon}`}
          alt={label}
          width={size}
          height={size}
          className={cn(
            sizeClass,
            "rounded-none",
            plate && "bg-white/14",
            dim && "opacity-40 grayscale",
            className,
          )}
          style={recolor ? { filter: STRAND_ABILITY_PLATE_FILTER } : undefined}
          unoptimized
        />
        <StrandAbilityRecolor on={recolor} />
      </span>
    </TooltipLabel>
  ) : (
    <TooltipLabel label={label}>
      <span
        className={cn(
          "bg-muted relative shrink-0 rounded-none",
          sizeClass,
          dim && "opacity-40",
          framed && TILE_FRAME,
          className,
        )}
        tabIndex={0}
        aria-label={label}
      />
    </TooltipLabel>
  );
}

/** A Bungie-hosted icon at a fixed square size, or a muted square when absent. */
export function ManifestIcon({
  icon,
  label,
  size,
  className,
  showTooltip = true,
  diamond = false,
  element,
}: {
  showTooltip?: boolean;
  icon?: string;
  label: string;
  size: 12 | 16 | 22 | 24 | 32 | 40 | 48;
  className?: string;
  /** Super art: a full-bleed diamond, outlined with a sharp 1px stroke. */
  diamond?: boolean;
  /** Tints the diamond outline to match the art; white at 16% without one. */
  element?: Subclass;
}) {
  const sizeClass =
    size === 12
      ? "size-3"
      : size === 22
        ? "size-[22px]"
        : size === 24
          ? "size-6"
          : size === 32
            ? "size-8"
            : size === 40
              ? "size-10"
              : size === 48
                ? "size-12"
                : "size-4";
  const image = (
    <Image
      src={`${BUNGIE_IMAGE_BASE}${icon}`}
      alt={label}
      tabIndex={showTooltip && !diamond ? 0 : undefined}
      width={size}
      height={size}
      className={cn(sizeClass, "shrink-0", className)}
      unoptimized
    />
  );
  return icon ? (
    <TooltipLabel label={showTooltip ? label : undefined}>
      {diamond ? (
        <span
          className={cn(sizeClass, "relative inline-flex shrink-0")}
          tabIndex={showTooltip ? 0 : undefined}
        >
          {image}
          <svg
            viewBox={`0 0 ${size} ${size}`}
            className="pointer-events-none absolute inset-0 size-full overflow-visible"
            aria-hidden
          >
            <polygon
              points={`${size / 2},0 ${size},${size / 2} ${size / 2},${size} 0,${size / 2}`}
              fill="none"
              // var() only resolves in CSS, not in the stroke attribute.
              style={{
                stroke: element
                  ? `color-mix(in srgb, ${SUBCLASS_LINE[element]} 60%, white)`
                  : "white",
              }}
              strokeOpacity={element ? 0.55 : 0.16}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </span>
      ) : (
        image
      )}
    </TooltipLabel>
  ) : (
    <TooltipLabel label={showTooltip ? label : undefined}>
      <span
        className={cn(
          "bg-muted relative shrink-0 rounded-none",
          sizeClass,
          className,
        )}
        tabIndex={showTooltip ? 0 : undefined}
      />
    </TooltipLabel>
  );
}


function DetailRow({
  label,
  render,
  labelClass,
}: {
  label: string;
  render: (i: number) => React.ReactNode;
  labelClass?: string;
}) {
  return (
    <>
      <div className={cn("text-muted-foreground truncate", labelClass)}>
        {label}
      </div>
      {STAT_COLS.map(({ key, i }) => (
        <div key={key} className="text-center tabular-nums">
          {render(i)}
        </div>
      ))}
      <div />
    </>
  );
}

export interface SetBonus {
  hash: number;
  count: number;
  icon?: string;
  /** "2pc Set name". */
  label: string;
  perkName?: string;
}

/**
 * Set bonuses → one entry per perk the piece count unlocks, so a 4pc set lists its 2pc
 * perk too (each perk's icon is the set's glyph).
 */
export function loadoutSetBonuses(
  saved: SavedLoadout,
  manifest: Manifest,
): SetBonus[] {
  return Object.entries(saved.loadout.parameters.setBonuses ?? {}).flatMap(
    ([hash, count]) => {
      const setDef = manifest.def(
        "DestinyEquipableItemSetDefinition",
        Number(hash),
      );
      const setName = setDef?.displayProperties?.name ?? "Set";
      return (setDef?.setPerks ?? [])
        .filter((p) => p.requiredSetCount <= count)
        .sort((a, b) => a.requiredSetCount - b.requiredSetCount)
        .map((p) => {
          const perk = manifest.def(
            "DestinySandboxPerkDefinition",
            p.sandboxPerkHash,
          );
          return {
            hash: Number(hash),
            count: p.requiredSetCount,
            icon: perk?.displayProperties?.icon,
            label: `${p.requiredSetCount}pc ${setName}`,
            perkName: perk?.displayProperties?.name,
          };
        });
    },
  );
}

/**
 * Each set-bonus perk as a round blue cell, like a picked perk in the weapon search;
 * the piece count, set and perk name are in its tooltip.
 */
export function SetBonusChip({ bonuses }: { bonuses: SetBonus[] }) {
  if (bonuses.length === 0) return null;
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {bonuses.map((b) => (
        <Tooltip key={`${b.hash}-${b.count}`}>
          <TooltipTrigger
            delay={100}
            render={
              <span
                tabIndex={0}
                aria-label={b.perkName ? `${b.label}: ${b.perkName}` : b.label}
                className="flex size-10 shrink-0 items-center justify-center rounded-full border border-foreground/12 bg-[#305f8e] outline-none focus-visible:d2-tile-selected"
              />
            }
          >
            <ManifestIcon
              icon={b.icon}
              label={b.label}
              size={24}
              showTooltip={false}
            />
          </TooltipTrigger>
          <TooltipContent className="grid px-3 py-2.5 text-sm leading-6">
            <div>{b.label}</div>
            {b.perkName && (
              <div className="text-muted-foreground">{b.perkName}</div>
            )}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

/**
 * The stat breakdown a card expands into: each piece's stats with its tuning / artifice
 * pick, the Armor / Mods / Artifice / Tuning / Total rows, and the artifact perks.
 */
export function LoadoutRowDetails({
  saved,
  resolved,
  manifest,
  characters,
  statIcons,
  balancedTuningIcon,
}: {
  saved: SavedLoadout;
  resolved: ResolvedLoadout;
  manifest: Manifest;
  characters: ArmoryCharacter[];
  statIcons: StatIconMap;
  balancedTuningIcon?: string;
}) {
  const { loadout, optimizer } = saved;
  const targetCharacter = lastPlayedCharacter(
    characters,
    loadout.classType === 3
      ? resolved.armor[0]?.piece?.classType
      : loadout.classType,
  );
  // Artifact perks: which of the saved unlocks the target character currently has active.
  const artifact = loadout.parameters.artifactUnlocks;
  const currentUnlocks = new Set(
    targetCharacter?.artifactUnlocks?.unlockedItemHashes ?? [],
  );
  const artifactActive = artifact
    ? artifact.unlockedItemHashes.filter((h) => currentUnlocks.has(h)).length
    : 0;

  return (
    <div className="d2-reveal grid gap-4 border-t border-foreground/15 pt-3 text-sm @3xl:grid-cols-[minmax(0,40rem)_minmax(0,1fr)]">
      <div
        className="grid items-center gap-x-1 gap-y-1"
        style={{ gridTemplateColumns: DETAIL_COLS }}
      >
        <div />
        {STAT_COLS.map(({ key }) => (
          <div key={key} className="flex justify-center pb-0.5">
            <StatGlyph src={statIcons[key]} label={STAT_LABELS[key]} />
          </div>
        ))}
        <div className="d2-label pb-0.5 text-center text-[10px]">Tuned</div>

        {resolved.armor.map((a, idx) => {
          const slotIndex = optimizer?.pieceIds.indexOf(a.ref.id ?? "") ?? -1;
          const tune = slotIndex >= 0 ? optimizer!.tuning[slotIndex] : null;
          const artificePick =
            slotIndex >= 0 ? optimizer!.artifice[slotIndex] : null;
          return (
            <Fragment key={`${a.ref.id ?? a.ref.hash}-${idx}`}>
              <div className="flex min-w-0 items-center gap-1.5">
                {a.icon ? (
                  <ArmorThumb
                    icon={a.icon}
                    watermark={a.piece?.watermark}
                    size={20}
                    masterworked={isFullyMasterworked(a.piece)}
                    gearTier={armorPipTier(a.piece)}
                    className={a.missing ? "opacity-50" : undefined}
                  />
                ) : (
                  <span
                    className="d2-brackets bg-black/25 size-5 shrink-0"
                    aria-hidden
                  />
                )}
                <TooltipLabel
                  label={a.slot ? `${a.name} · ${SLOT_LABELS[a.slot]}` : a.name}
                >
                  <span
                    className={cn("truncate", a.missing && "text-muted-foreground")}
                    tabIndex={0}
                  >
                    {a.name}
                  </span>
                </TooltipLabel>
              </div>
              {STAT_COLS.map(({ key, i }) => (
                <div
                  key={key}
                  className="text-muted-foreground text-center tabular-nums"
                >
                  {a.piece ? a.piece.stats[i] || "" : ""}
                </div>
              ))}
              <div className="flex justify-center">
                {tune?.kind === "balanced" ? (
                  <StatGlyph
                    src={balancedTuningIcon}
                    label="Balanced Tuning"
                    invert={false}
                  />
                ) : tune?.kind === "directional" ? (
                  <StatGlyph
                    src={statIcons[STAT_ORDER[tune.plus]]}
                    label={`Tuned +5 ${STAT_LABELS[STAT_ORDER[tune.plus]]}`}
                  />
                ) : artificePick !== null && artificePick !== undefined ? (
                  <span className="flex items-center gap-0.5 text-[10px] text-positive/90 tabular-nums">
                    <StatGlyph
                      src={statIcons[STAT_ORDER[artificePick]]}
                      label={`Artifice +3 ${STAT_LABELS[STAT_ORDER[artificePick]]}`}
                    />
                    +3
                  </span>
                ) : null}
              </div>
            </Fragment>
          );
        })}

        {optimizer && (
          <>
            <div className="col-span-full my-0.5 border-t border-foreground/15" />
            <DetailRow label="Armor" render={(i) => optimizer.baseStats[i] || ""} />
            <DetailRow
              label="Mods"
              render={(i) =>
                optimizer.modBonus[i] ? (
                  <span className="text-positive/90">+{optimizer.modBonus[i]}</span>
                ) : (
                  ""
                )
              }
            />
            {optimizer.artificeBonus.some((v) => v > 0) && (
              <DetailRow
                label="Artifice"
                render={(i) =>
                  optimizer.artificeBonus[i] ? (
                    <span className="text-positive/90">
                      +{optimizer.artificeBonus[i]}
                    </span>
                  ) : (
                    ""
                  )
                }
              />
            )}
            <DetailRow
              label="Tuning"
              render={(i) => {
                const v = optimizer.tuningBonus[i];
                if (!v) return "";
                return (
                  <span className={v < 0 ? "text-destructive" : "text-positive/90"}>
                    {v > 0 ? `+${v}` : v}
                  </span>
                );
              }}
            />
            <div className="col-span-full my-0.5 border-t border-foreground/15" />
            <DetailRow
              label="Total"
              labelClass="text-foreground font-medium"
              render={(i) => (
                <span className="text-foreground font-medium">
                  {optimizer.stats[i]}
                </span>
              )}
            />
          </>
        )}
      </div>

      {artifact && artifact.unlockedItemHashes.length > 0 && (
        <div className="flex items-start gap-2">
          <span className="text-muted-foreground w-16 shrink-0 pt-1">
            Artifact
            <span className="block text-[10px] tabular-nums">
              {artifactActive}/{artifact.unlockedItemHashes.length} active
            </span>
          </span>
          <div className="flex flex-wrap gap-1">
            {artifact.unlockedItemHashes.map((hash, i) => (
              <PlugIcon
                key={`${hash}-${i}`}
                hash={hash}
                manifest={manifest}
                dim={!currentUnlocks.has(hash)}
                suffix={
                  currentUnlocks.has(hash) ? undefined : "not currently unlocked"
                }
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
