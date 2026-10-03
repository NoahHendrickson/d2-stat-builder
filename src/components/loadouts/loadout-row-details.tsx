"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipLabel,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Fragment, type CSSProperties } from "react";
import Image from "next/image";
import type { ArmoryCharacter } from "@/lib/armory/fetch";
import { buildFragmentStats, formatFragmentStats, SUBCLASS_LINE, subclassFromPlugCategory, type Subclass } from "@/lib/armory/fragments";
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
 * Hairline frame tinted with `--element-line`, drawn on an overlay so it sits on top of the
 * icon (an inset shadow on the <img> itself paints under the art). The host must be
 * `relative`.
 */
const ELEMENT_FRAME =
  "after:pointer-events-none after:absolute after:inset-0 after:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--element-line)_45%,transparent)]";

/**
 * Soft `--element-line` glow for shaped art (the Super / subclass diamond): a drop shadow
 * follows the icon's transparency, where a square frame would box in the empty corners.
 */
const ELEMENT_GLOW =
  "[filter:drop-shadow(0_0_5px_color-mix(in_srgb,var(--element-line)_55%,transparent))]";

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
  /** Subclass damage type — tints the tile frame (aspects / fragments). */
  element?: Subclass;
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
  const plugElement =
    subclassFromPlugCategory(def?.plug?.plugCategoryIdentifier) ?? element;
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
  const tileStyle = plugElement
    ? ({ "--element-line": SUBCLASS_LINE[plugElement] } as CSSProperties)
    : undefined;
  return icon ? (
    <TooltipLabel label={label}>
      <span
        className={cn(
          sizeClass,
          "relative inline-flex shrink-0",
          recolor && "isolate",
          plugElement && ELEMENT_FRAME,
        )}
        style={tileStyle}
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
          plugElement && ELEMENT_FRAME,
          className,
        )}
        style={tileStyle}
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
  element,
}: {
  showTooltip?: boolean;
  icon?: string;
  label: string;
  size: 12 | 16 | 22 | 24 | 32 | 40;
  className?: string;
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
              : "size-4";
  const tileStyle = element
    ? ({ "--element-line": SUBCLASS_LINE[element] } as CSSProperties)
    : undefined;
  return icon ? (
    <TooltipLabel label={showTooltip ? label : undefined}>
      <Image
        src={`${BUNGIE_IMAGE_BASE}${icon}`}
        alt={label}
        tabIndex={showTooltip ? 0 : undefined}
        width={size}
        height={size}
        className={cn(sizeClass, "shrink-0", element && ELEMENT_GLOW, className)}
        style={tileStyle}
        unoptimized
      />
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
  label: string;
}

/** Set bonuses → the perk each piece count unlocks (its icon is the set's glyph). */
export function loadoutSetBonuses(
  saved: SavedLoadout,
  manifest: Manifest,
): SetBonus[] {
  return Object.entries(saved.loadout.parameters.setBonuses ?? {}).map(
    ([hash, count]) => {
      const setDef = manifest.def(
        "DestinyEquipableItemSetDefinition",
        Number(hash),
      );
      const setName = setDef?.displayProperties?.name ?? "Set";
      const perkHash = setDef?.setPerks?.find(
        (p) => p.requiredSetCount === count,
      )?.sandboxPerkHash;
      const perk = manifest.def("DestinySandboxPerkDefinition", perkHash);
      return {
        hash: Number(hash),
        count,
        icon: perk?.displayProperties?.icon,
        label: `${count}pc ${setName}`,
      };
    },
  );
}

/** Every active set bonus's perk glyph in one bordered 32px well; names in the tooltip. */
export function SetBonusChip({ bonuses }: { bonuses: SetBonus[] }) {
  if (bonuses.length === 0) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        delay={100}
        render={
          <span
            tabIndex={0}
            aria-label={bonuses.map((b) => b.label).join(", ")}
            className="bg-[#41a6ff] flex h-8 min-w-8 shrink-0 items-center justify-center gap-1.5 rounded-none normal:rounded-[8px] border border-foreground/8 px-1 outline-none focus-visible:border-outline-strong"
          />
        }
      >
        {bonuses.map((b) => (
          <ManifestIcon
            key={b.hash}
            icon={b.icon}
            label={b.label}
            size={22}
            showTooltip={false}
          />
        ))}
      </TooltipTrigger>
      <TooltipContent className="grid gap-2 px-3 py-2.5 text-sm leading-6">
        {bonuses.map((b) => (
          <div key={b.hash}>{b.label}</div>
        ))}
      </TooltipContent>
    </Tooltip>
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
    <div className="grid gap-4 border-t border-foreground/15 pt-3 text-sm @3xl:grid-cols-[minmax(0,40rem)_minmax(0,1fr)]">
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
