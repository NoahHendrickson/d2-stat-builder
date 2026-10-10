"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipLabel,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Fragment } from "react";
import type { ArmoryCharacter } from "@/lib/armory/fetch";
import { ManifestIcon, PlugIcon } from "@/components/loadouts/loadout-icons";
import type { Manifest } from "@/lib/manifest/load";
import {
  SLOT_LABELS,
  STAT_DISPLAY_ORDER,
  STAT_LABELS,
  STAT_ORDER,
  type StatIconMap,
} from "@/lib/armory/stats";
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
