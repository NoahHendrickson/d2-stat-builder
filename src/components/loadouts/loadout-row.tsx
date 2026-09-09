"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipLabel,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Fragment, memo, useMemo, useState } from "react";
import Image from "next/image";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLineDown,
  ArrowSquareOut,
  CircleNotch,
  Copy,
  DotsThreeVertical,
  PencilSimple,
  ShareFat,
  SlidersHorizontal,
  Trash,
  Warning,
} from "@phosphor-icons/react";
import { toast } from "@/lib/toast";
import type { ArmorPiece } from "@/lib/armory/normalize";
import type { ArmoryCharacter } from "@/lib/armory/fetch";
import type { Subclass } from "@/lib/armory/fragments";
import { ABILITY_KINDS, ABILITY_LABELS } from "@/lib/dim/subclasses";
import type { Manifest } from "@/lib/manifest/load";
import {
  CLASS_NAMES,
  SLOT_LABELS,
  STAT_DISPLAY_ORDER,
  STAT_LABELS,
  STAT_ORDER,
  type StatIconMap,
} from "@/lib/armory/stats";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import { lastPlayedCharacter } from "@/lib/bungie/equip-client";
import { buildDimLoadoutUrl } from "@/lib/dim/loadout-link";
import { applySavedLoadout } from "@/lib/loadouts/apply-client";
import { formatRelativeTime } from "@/lib/armor-table/relative-time";
import { superSocketIndex } from "@/lib/loadouts/subclass";
import { resolveLoadout } from "@/lib/loadouts/resolve";
import { loadoutHashtags, type SavedLoadout } from "@/lib/loadouts/types";
import { StatGlyph } from "@/components/builder/build-results";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const STAT_COLS = STAT_DISPLAY_ORDER.map((key) => ({
  key,
  i: STAT_ORDER.indexOf(key),
}));
/** Name column takes the slack; the six stat columns and Tuned stay fixed so names keep room in the 307px card. */
const DETAIL_COLS = "minmax(0,1fr) repeat(6, 1.75rem) 2.5rem";

/** Chip tint per subclass element (Figma 3:1982 is the Solar one at 8%). */
const SUBCLASS_TINT: Record<Subclass, string> = {
  Solar: "bg-[rgb(239_100_31/0.08)]",
  Arc: "bg-[rgb(123_199_255/0.08)]",
  Void: "bg-[rgb(177_132_197/0.08)]",
  Stasis: "bg-[rgb(77_136_255/0.08)]",
  Strand: "bg-[rgb(53_227_102/0.08)]",
  Prismatic: "bg-[rgb(255_107_214/0.08)]",
};

/** Icon + name for a plug/mod hash, from the manifest; falls back to the hash. */
function PlugIcon({
  hash,
  manifest,
  dim = false,
  suffix,
  size = 24,
  className,
}: {
  hash: number;
  manifest: Manifest;
  dim?: boolean;
  suffix?: string;
  size?: 16 | 20 | 24;
  className?: string;
}) {
  const def = manifest.def("DestinyInventoryItemDefinition", hash);
  const name = def?.displayProperties?.name ?? `#${hash}`;
  const label = suffix ? `${name} — ${suffix}` : name;
  const icon = def?.displayProperties?.icon;
  const sizeClass = size === 16 ? "size-4" : size === 20 ? "size-5" : "size-6";
  return icon ? (
    <TooltipLabel label={label}>
      <Image
        src={`${BUNGIE_IMAGE_BASE}${icon}`}
        alt={label}
        tabIndex={0}
        width={size}
        height={size}
        className={cn(
          sizeClass,
          "shrink-0 rounded-sm",
          dim && "opacity-40 grayscale",
          className,
        )}
        unoptimized
      />
    </TooltipLabel>
  ) : (
    <TooltipLabel label={label}>
      <span
        className={cn(
          "bg-muted shrink-0 rounded-sm",
          sizeClass,
          dim && "opacity-40",
          className,
        )}
        tabIndex={0}
        aria-label={label}
      />
    </TooltipLabel>
  );
}

/** A Bungie-hosted icon at a fixed square size, or a muted square when absent. */
function ManifestIcon({
  icon,
  label,
  size,
  className,
  showTooltip = true,
}: {
  showTooltip?: boolean;
  icon?: string;
  label: string;
  size: 12 | 16 | 24;
  className?: string;
}) {
  const sizeClass = size === 12 ? "size-3" : size === 24 ? "size-6" : "size-4";
  return icon ? (
    <TooltipLabel label={showTooltip ? label : undefined}>
      <Image
        src={`${BUNGIE_IMAGE_BASE}${icon}`}
        alt={label}
        tabIndex={showTooltip ? 0 : undefined}
        width={size}
        height={size}
        className={cn(sizeClass, "shrink-0", className)}
        unoptimized
      />
    </TooltipLabel>
  ) : (
    <TooltipLabel label={showTooltip ? label : undefined}>
      <span
        className={cn("bg-muted shrink-0 rounded-sm", sizeClass, className)}
        tabIndex={showTooltip ? 0 : undefined}
      />
    </TooltipLabel>
  );
}

function ChipDivider() {
  return <span className="bg-border h-4 w-px shrink-0" aria-hidden />;
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

/**
 * One saved loadout as a sidebar card (Figma "Attachment", 1:1209): name with Equip and
 * the actions menu, a row of chips (exotic · set bonuses · subclass + aspects + fragments), and
 * the stat line. Clicking the name expands the piece-by-piece breakdown.
 *
 * Memoized: the list renders (virtualized) rows with stable, loadout-taking callbacks,
 * so a keystroke in the search box or one row's expansion doesn't re-render every other
 * row. Expansion lives in the list so it survives the row scrolling out of the window.
 */
export const LoadoutRow = memo(function LoadoutRow({
  saved,
  open,
  onToggle,
  pieceMap,
  manifest,
  characters,
  statIcons,
  balancedTuningIcon,
  now,
  onEdit,
  onDuplicate,
  onDelete,
  onShare,
  onOptimize,
  onArmoryChanged,
}: {
  saved: SavedLoadout;
  open: boolean;
  onToggle: (id: string) => void;
  pieceMap: ReadonlyMap<string, ArmorPiece>;
  manifest: Manifest;
  characters: ArmoryCharacter[];
  statIcons: StatIconMap;
  balancedTuningIcon?: string;
  /** Reference time for "edited … ago" (captured once by the list). */
  now: number;
  onEdit: (saved: SavedLoadout) => void;
  onDuplicate: (saved: SavedLoadout) => void;
  onDelete: (saved: SavedLoadout) => void;
  onShare: (saved: SavedLoadout) => void;
  /** Load the loadout's targets into the optimizer to look for better builds. */
  onOptimize: (saved: SavedLoadout) => void;
  onArmoryChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const [applying, setApplying] = useState(false);
  const { loadout, optimizer } = saved;

  const resolved = useMemo(
    () => resolveLoadout(loadout, pieceMap, manifest),
    [loadout, pieceMap, manifest],
  );

  const exoticHash =
    loadout.parameters.exoticArmorHash ??
    resolved.armor.find((a) => a.piece?.isExotic)?.ref.hash;
  const exoticDef = manifest.def("DestinyInventoryItemDefinition", exoticHash);
  const exoticIcon = exoticDef?.displayProperties?.icon;
  const exoticName = exoticDef?.displayProperties?.name ?? "Exotic";

  // Set bonuses → the perk each piece count unlocks (its icon is the set's glyph).
  const setBonuses = Object.entries(loadout.parameters.setBonuses ?? {}).map(
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

  const subclass = resolved.subclass;
  const subclassDef = manifest.def(
    "DestinyInventoryItemDefinition",
    subclass?.itemHash,
  );
  const subclassLabel =
    subclassDef?.displayProperties?.name ?? subclass?.subclass ?? "Subclass";
  const superStart = subclass
    ? superSocketIndex(manifest, subclass.itemHash)
    : undefined;
  const initialSuperHash =
    superStart !== undefined
      ? subclassDef?.sockets?.socketEntries[superStart]?.singleInitialItemHash
      : undefined;
  const superDef = manifest.def(
    "DestinyInventoryItemDefinition",
    subclass?.superHash ?? (initialSuperHash || undefined),
  );
  const superIcon =
    superDef?.displayProperties?.icon ?? subclassDef?.displayProperties?.icon;
  const superLabel = superDef?.displayProperties?.name
    ? `${superDef.displayProperties.name} · ${subclassLabel}`
    : subclassLabel;
  // Pinned abilities besides the Super, in socket order (class ability, jump, melee, grenade).
  const abilityChips = subclass
    ? ABILITY_KINDS.filter((kind) => kind !== "super").flatMap((kind) => {
        const hash = subclass.abilityHashes[kind];
        return hash === undefined ? [] : [{ kind, hash }];
      })
    : [];

  const className =
    loadout.classType === 3 ? "Any class" : CLASS_NAMES[loadout.classType];
  const targetCharacter = lastPlayedCharacter(
    characters,
    loadout.classType === 3
      ? resolved.armor[0]?.piece?.classType
      : loadout.classType,
  );
  const hashtags = loadoutHashtags(loadout);
  // Piece each mod is placed on (from the saved placement) for the Mods line tooltips.
  const modPieceNames = new Map<number, string[]>();
  for (const [instanceId, sockets] of Object.entries(
    saved.modPlacement ?? {},
  )) {
    const name = resolved.armor.find((a) => a.ref.id === instanceId)?.name;
    if (!name) continue;
    for (const hash of Object.values(sockets)) {
      modPieceNames.set(hash, [...(modPieceNames.get(hash) ?? []), name]);
    }
  }

  // Artifact perks: which of the saved unlocks the target character currently has active.
  const artifact = loadout.parameters.artifactUnlocks;
  const currentUnlocks = new Set(
    targetCharacter?.artifactUnlocks?.unlockedItemHashes ?? [],
  );
  const artifactActive = artifact
    ? artifact.unlockedItemHashes.filter((h) => currentUnlocks.has(h)).length
    : 0;

  const canApply = resolved.actionable && !!targetCharacter && !applying;

  // Equip the armor (+ subclass), then socket mods / tuning / artifice / fragments.
  const applyLoadout = async () => {
    if (!resolved.actionable || !targetCharacter || applying) return;
    setApplying(true);
    try {
      const outcome = await applySavedLoadout({
        saved,
        resolved,
        character: targetCharacter,
        armory: pieceMap.values(),
        manifest,
        queryClient,
      });
      if (outcome) onArmoryChanged();
    } catch {
      toast.error("Apply failed — check your connection and try again");
    } finally {
      setApplying(false);
    }
  };

  const copyItemIds = async () => {
    if (!resolved.actionable) return;
    const query = resolved.armor.map((a) => `id:'${a.ref.id}'`).join(" OR ");
    try {
      await navigator.clipboard.writeText(query);
      toast.success("Item IDs copied — paste into DIM search");
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  };

  const openInDim = () => {
    window.open(buildDimLoadoutUrl(loadout), "_blank", "noopener,noreferrer");
  };

  const hasChips = !!exoticIcon || setBonuses.length > 0 || !!subclass;

  return (
    <div className="border-border flex flex-col gap-4 border-b px-4 py-2">
      <div className="flex flex-col gap-2">
        <div className="flex h-8 items-center justify-between gap-2">
          <TooltipLabel
            label={`${className}${subclass?.subclass ? ` · ${subclass.subclass}` : ""} · edited ${formatRelativeTime(saved.updatedAt, now)}`}
          >
            <button
              type="button"
              onClick={() => onToggle(saved.id)}
              aria-expanded={open}

              className="hover:text-foreground/80 flex min-w-0 flex-1 items-center gap-1.5 text-left text-base leading-6 transition-colors"
            >
              <span className="truncate">{loadout.name}</span>
              {resolved.missing && (
                <Warning
                  weight="fill"
                  className="size-4 shrink-0 text-amber-500"
                  aria-label="Missing items"
                />
              )}
            </button>
          </TooltipLabel>
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              variant="emphatic"
              size="xs"
              className="h-8 gap-1.5"
              onClick={applyLoadout}
              disabled={!canApply}
            >
              {applying && (
                <CircleNotch className="animate-spin" aria-hidden />
              )}
              Equip
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button size="icon" variant="ghost" />}
                aria-label={`Actions for ${loadout.name}`}
              >
                <DotsThreeVertical
                  weight="bold"
                  className="size-4"
                  aria-hidden
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-50">
                <DropdownMenuItem onClick={() => onOptimize(saved)}>
                  <SlidersHorizontal weight="duotone" aria-hidden />
                  Optimize
                </DropdownMenuItem>
                <DropdownMenuItem onClick={applyLoadout} disabled={!canApply}>
                  <ArrowLineDown weight="duotone" aria-hidden />
                  Equip
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onEdit(saved)}>
                  <PencilSimple weight="duotone" aria-hidden />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onShare(saved)}>
                  <ShareFat weight="duotone" aria-hidden />
                  Share
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onDuplicate(saved)}>
                  <Copy weight="duotone" aria-hidden />
                  Duplicate
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={copyItemIds}
                  disabled={!resolved.actionable}
                >
                  <Copy weight="duotone" aria-hidden />
                  Copy item IDs
                </DropdownMenuItem>
                <DropdownMenuItem onClick={openInDim}>
                  <ArrowSquareOut weight="duotone" aria-hidden />
                  Open in DIM
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => onDelete(saved)}
                >
                  <Trash weight="duotone" aria-hidden />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {hasChips && (
          <div className="flex h-8 items-center gap-2 overflow-hidden">
            {exoticIcon && (
              <TooltipLabel label={exoticName} delay={100}>
                <Image
                  src={`${BUNGIE_IMAGE_BASE}${exoticIcon}`}
                  alt={exoticName}
                  width={24}
                  height={24}
                  className="size-6 shrink-0 ring-1 ring-[#fff600]/70"
                  tabIndex={0}
                  unoptimized
                />
              </TooltipLabel>
            )}
            {exoticIcon && setBonuses.length > 0 && <ChipDivider />}
            {setBonuses.length > 0 && (
              <Tooltip>
                <TooltipTrigger
                  delay={100}
                  render={
                    <span
                      tabIndex={0}
                      aria-label={setBonuses.map((b) => b.label).join(", ")}
                      className="bg-foreground/4 flex shrink-0 items-center gap-1 rounded-[4px] p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  }
                >
                  {setBonuses.map((b) => (
                    <ManifestIcon
                      key={b.hash}
                      icon={b.icon}
                      label={b.label}
                      size={24}
                      showTooltip={false}
                    />
                  ))}
                </TooltipTrigger>
                <TooltipContent className="grid gap-2 px-3 py-2.5 text-sm leading-6">
                  {setBonuses.map((b) => (
                    <div key={b.hash}>{b.label}</div>
                  ))}
                </TooltipContent>
              </Tooltip>
            )}
            {(exoticIcon || setBonuses.length > 0) && subclass && (
              <ChipDivider />
            )}
            {subclass && (
              <span
                aria-label={superLabel}
                className={cn(
                  "flex min-w-0 items-center gap-1 rounded-[4px] p-1",
                  subclass.subclass
                    ? SUBCLASS_TINT[subclass.subclass]
                    : "bg-foreground/4",
                )}
              >
                <ManifestIcon
                  icon={superIcon}
                  label={superLabel}
                  size={24}
                />
                {abilityChips.map(({ kind, hash }) => (
                  <PlugIcon
                    key={kind}
                    hash={hash}
                    manifest={manifest}
                    suffix={ABILITY_LABELS[kind]}
                    size={24}
                    className="rounded-none"
                  />
                ))}
                {subclass.aspectHashes.map((hash) => (
                  <PlugIcon
                    key={hash}
                    hash={hash}
                    manifest={manifest}
                    size={24}
                    className="rounded-none"
                  />
                ))}
                {subclass.fragmentHashes.map((hash, i) => (
                  <PlugIcon
                    key={`${hash}-${i}`}
                    hash={hash}
                    manifest={manifest}
                    size={24}
                    className="rounded-none"
                  />
                ))}
              </span>
            )}
          </div>
        )}
      </div>

      {optimizer ? (
        <div className="flex items-start justify-between gap-1 text-xs leading-4 tabular-nums">
          <TooltipLabel label="Total stats">
            <span tabIndex={0}>{optimizer.total}</span>
          </TooltipLabel>
          {STAT_COLS.map(({ key, i }) => {
            const value = optimizer.stats[i];
            return (
              <span key={key} className="flex items-center gap-0.5">
                <StatGlyph
                  src={statIcons[key]}
                  label={STAT_LABELS[key]}
                  className="opacity-65"
                />
                <span className={cn(value === 0 && "text-muted-foreground")}>
                  {value}
                </span>
              </span>
            );
          })}
        </div>
      ) : (
        <p className="text-muted-foreground text-xs leading-4">
          {className}
          {subclass?.subclass ? ` · ${subclass.subclass}` : ""} · edited{" "}
          {formatRelativeTime(saved.updatedAt, now)}
        </p>
      )}

      {open && (
        <div className="border-border space-y-3 border-t pt-2 text-xs">
          {loadout.notes && (
            <p className="text-muted-foreground whitespace-pre-wrap">
              {loadout.notes}
            </p>
          )}
          {hashtags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {hashtags.map((t) => (
                <Badge
                  key={t}
                  variant="outline"
                  className="px-1.5 py-0 text-[10px]"
                >
                  #{t}
                </Badge>
              ))}
            </div>
          )}

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
            <div className="text-muted-foreground pb-0.5 text-center text-[10px] leading-4">
              Tuned
            </div>

            {resolved.armor.map((a, idx) => {
              const slotIndex =
                optimizer?.pieceIds.indexOf(a.ref.id ?? "") ?? -1;
              const tune = slotIndex >= 0 ? optimizer!.tuning[slotIndex] : null;
              const artificePick =
                slotIndex >= 0 ? optimizer!.artifice[slotIndex] : null;
              return (
                <Fragment key={`${a.ref.id ?? a.ref.hash}-${idx}`}>
                  <div className="flex min-w-0 items-center gap-1.5">
                    {a.icon ? (
                      <Image
                        src={`${BUNGIE_IMAGE_BASE}${a.icon}`}
                        alt=""
                        width={20}
                        height={20}
                        className={cn(
                          "size-5 shrink-0 rounded-sm",
                          a.missing && "opacity-50",
                        )}
                        unoptimized
                      />
                    ) : (
                      <span
                        className="bg-muted size-5 shrink-0 rounded-sm"
                        aria-hidden
                      />
                    )}
                    <TooltipLabel
                      label={
                        a.slot ? `${a.name} · ${SLOT_LABELS[a.slot]}` : a.name
                      }
                    >
                      <span
                        className={cn(
                          "truncate",
                          a.missing && "text-muted-foreground",
                        )}
                        tabIndex={0}
                      >
                        {a.name}
                      </span>
                    </TooltipLabel>
                    {a.missing && (
                      <Badge
                        variant="outline"
                        className="shrink-0 px-1 py-0 text-[10px]"
                      >
                        missing
                      </Badge>
                    )}
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
                      <span className="flex items-center gap-0.5 text-[10px] text-brand/80 tabular-nums">
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
                <div className="border-border/60 col-span-full my-0.5 border-t" />
                <DetailRow
                  label="Armor"
                  render={(i) => optimizer.baseStats[i] || ""}
                />
                <DetailRow
                  label="Mods"
                  render={(i) =>
                    optimizer.modBonus[i] ? (
                      <span className="text-brand/80">
                        +{optimizer.modBonus[i]}
                      </span>
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
                        <span className="text-brand/80">
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
                      <span
                        className={v < 0 ? "text-red-400/80" : "text-brand/80"}
                      >
                        {v > 0 ? `+${v}` : v}
                      </span>
                    );
                  }}
                />
                <div className="border-border/60 col-span-full my-0.5 border-t" />
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

          {loadout.parameters.mods.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground w-16 shrink-0">Mods</span>
              <div className="flex flex-wrap gap-1">
                {loadout.parameters.mods.map((hash, i) => (
                  <PlugIcon
                    key={`${hash}-${i}`}
                    hash={hash}
                    manifest={manifest}
                    suffix={modPieceNames.get(hash)?.shift()}
                  />
                ))}
              </div>
            </div>
          )}

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
                      currentUnlocks.has(hash)
                        ? undefined
                        : "not currently unlocked"
                    }
                  />
                ))}
              </div>
            </div>
          )}

          <p className="text-muted-foreground">
            {className}
            {subclass?.subclass ? ` · ${subclass.subclass}` : ""} · edited{" "}
            {formatRelativeTime(saved.updatedAt, now)}
          </p>
        </div>
      )}
    </div>
  );
});
