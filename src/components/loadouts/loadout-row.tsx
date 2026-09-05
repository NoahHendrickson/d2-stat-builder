"use client";

import { Fragment, memo, useMemo, useState } from "react";
import Image from "next/image";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowSquareOut,
  CaretDown,
  CircleNotch,
  Copy,
  DotsThree,
  PencilSimple,
  ShareNetwork,
  SlidersHorizontal,
  Trash,
  Warning,
} from "@phosphor-icons/react";
import { toast } from "@/lib/toast";
import type { ArmorPiece } from "@/lib/armory/normalize";
import type { ArmoryCharacter } from "@/lib/armory/fetch";
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

const STAT_COLS = STAT_DISPLAY_ORDER.map((key) => ({ key, i: STAT_ORDER.indexOf(key) }));
const DETAIL_COLS = "minmax(0,1fr) repeat(6, minmax(1.75rem, 1fr)) minmax(2.75rem, auto)";

/** Icon + name for a plug/mod hash, from the manifest; falls back to the hash. */
function PlugIcon({
  hash,
  manifest,
  dim = false,
  suffix,
}: {
  hash: number;
  manifest: Manifest;
  dim?: boolean;
  suffix?: string;
}) {
  const def = manifest.def("DestinyInventoryItemDefinition", hash);
  const name = def?.displayProperties?.name ?? `#${hash}`;
  const label = suffix ? `${name} — ${suffix}` : name;
  const icon = def?.displayProperties?.icon;
  return icon ? (
    <Image
      src={`${BUNGIE_IMAGE_BASE}${icon}`}
      alt={label}
      title={label}
      width={24}
      height={24}
      className={cn("size-6 shrink-0 rounded-sm", dim && "opacity-40 grayscale")}
      unoptimized
    />
  ) : (
    <span
      className={cn("bg-muted size-6 shrink-0 rounded-sm", dim && "opacity-40")}
      title={label}
      aria-label={label}
    />
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
      <div className={cn("text-muted-foreground truncate", labelClass)}>{label}</div>
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
 * One saved loadout. Memoized: the list renders (virtualized) rows with stable,
 * loadout-taking callbacks, so a keystroke in the search box or one row's expansion
 * doesn't re-render every other row. Expansion lives in the list so it survives the
 * row scrolling out of the virtual window.
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
  onLoadInBuilder,
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
  onLoadInBuilder: (saved: SavedLoadout) => void;
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
  const exoticIcon = manifest.def("DestinyInventoryItemDefinition", exoticHash)
    ?.displayProperties?.icon;

  const setBadges = Object.entries(loadout.parameters.setBonuses ?? {}).map(
    ([hash, count]) => ({
      hash: Number(hash),
      count,
      name:
        manifest.def("DestinyEquipableItemSetDefinition", Number(hash))?.displayProperties
          ?.name ?? "Set",
    }),
  );

  const className = loadout.classType === 3 ? "Any class" : CLASS_NAMES[loadout.classType];
  const targetCharacter = lastPlayedCharacter(
    characters,
    loadout.classType === 3 ? resolved.armor[0]?.piece?.classType : loadout.classType,
  );
  const hashtags = loadoutHashtags(loadout);
  // Piece each mod is placed on (from the saved placement) for the Mods line tooltips.
  const modPieceNames = new Map<number, string[]>();
  for (const [instanceId, sockets] of Object.entries(saved.modPlacement ?? {})) {
    const name = resolved.armor.find((a) => a.ref.id === instanceId)?.name;
    if (!name) continue;
    for (const hash of Object.values(sockets)) {
      modPieceNames.set(hash, [...(modPieceNames.get(hash) ?? []), name]);
    }
  }

  // Artifact perks: which of the saved unlocks the target character currently has active.
  const artifact = loadout.parameters.artifactUnlocks;
  const currentUnlocks = new Set(targetCharacter?.artifactUnlocks?.unlockedItemHashes ?? []);
  const artifactActive = artifact
    ? artifact.unlockedItemHashes.filter((h) => currentUnlocks.has(h)).length
    : 0;

  // Equip the armor (+ subclass), then socket mods / tuning / artifice / fragments.
  const applyLoadout = async () => {
    if (!resolved.actionable || !targetCharacter || applying) return;
    setApplying(true);
    try {
      const outcome = await applySavedLoadout({
        saved,
        resolved,
        character: targetCharacter,
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

  const disabledReason = resolved.missing
    ? "A piece in this loadout isn't in your inventory anymore"
    : !resolved.actionable
      ? "Theoretical exotic class item roll — needs a real instance"
      : !targetCharacter
        ? `No ${className} character`
        : undefined;

  return (
    <div className="border-border/60 overflow-hidden rounded-lg border">
      <button
        type="button"
        onClick={() => onToggle(saved.id)}
        aria-expanded={open}
        className="hover:bg-muted/40 flex w-full items-center gap-3 p-2.5 text-left transition-colors max-lg:gap-2"
      >
        {exoticIcon ? (
          <Image
            src={`${BUNGIE_IMAGE_BASE}${exoticIcon}`}
            alt=""
            width={36}
            height={36}
            className="size-9 shrink-0 rounded"
            unoptimized
          />
        ) : (
          <span className="bg-muted size-9 shrink-0 rounded" aria-hidden />
        )}
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium">{loadout.name}</span>
            {resolved.missing && (
              <Warning
                weight="fill"
                className="size-4 shrink-0 text-amber-500"
                aria-label="Missing items"
              />
            )}
          </div>
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            <span>{className}</span>
            {resolved.subclass?.subclass && <span>· {resolved.subclass.subclass}</span>}
            <span>· edited {formatRelativeTime(saved.updatedAt, now)}</span>
          </div>
        </div>
        {optimizer && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm max-lg:hidden">
            {STAT_COLS.map(({ key, i }) => (
              <span key={key} className="flex items-center gap-1 tabular-nums">
                <StatGlyph src={statIcons[key]} label={STAT_LABELS[key]} />
                {optimizer.stats[i]}
              </span>
            ))}
            <span className="text-muted-foreground tabular-nums">{optimizer.total}</span>
          </div>
        )}
        {setBadges.map((b) => (
          <Badge
            key={b.hash}
            variant="outline"
            className="max-lg:hidden shrink-0 px-1.5 py-0 text-[10px]"
            title={b.name}
          >
            {b.count}pc
          </Badge>
        ))}
        <CaretDown
          weight="duotone"
          className={cn(
            "text-muted-foreground size-4 shrink-0 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="border-border/60 space-y-3 border-t px-2.5 py-2 text-xs">
          {loadout.notes && (
            <p className="text-muted-foreground whitespace-pre-wrap">{loadout.notes}</p>
          )}
          {hashtags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {hashtags.map((t) => (
                <Badge key={t} variant="outline" className="px-1.5 py-0 text-[10px]">
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
              const slotIndex = optimizer?.pieceIds.indexOf(a.ref.id ?? "") ?? -1;
              const tune = slotIndex >= 0 ? optimizer!.tuning[slotIndex] : null;
              const artificePick = slotIndex >= 0 ? optimizer!.artifice[slotIndex] : null;
              return (
                <Fragment key={`${a.ref.id ?? a.ref.hash}-${idx}`}>
                  <div className="flex min-w-0 items-center gap-1.5">
                    {a.icon ? (
                      <Image
                        src={`${BUNGIE_IMAGE_BASE}${a.icon}`}
                        alt=""
                        width={20}
                        height={20}
                        className={cn("size-5 shrink-0 rounded-sm", a.missing && "opacity-50")}
                        unoptimized
                      />
                    ) : (
                      <span className="bg-muted size-5 shrink-0 rounded-sm" aria-hidden />
                    )}
                    <span className={cn("truncate", a.missing && "text-muted-foreground")}>
                      {a.name}
                    </span>
                    {a.slot && (
                      <span className="text-muted-foreground shrink-0">
                        {SLOT_LABELS[a.slot]}
                      </span>
                    )}
                    {a.missing && (
                      <Badge variant="outline" className="shrink-0 px-1 py-0 text-[10px]">
                        missing
                      </Badge>
                    )}
                  </div>
                  {STAT_COLS.map(({ key, i }) => (
                    <div key={key} className="text-muted-foreground text-center tabular-nums">
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
                <DetailRow label="Armor" render={(i) => optimizer.baseStats[i] || ""} />
                <DetailRow
                  label="Mods"
                  render={(i) =>
                    optimizer.modBonus[i] ? (
                      <span className="text-brand/80">+{optimizer.modBonus[i]}</span>
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
                        <span className="text-brand/80">+{optimizer.artificeBonus[i]}</span>
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
                      <span className={v < 0 ? "text-red-400/80" : "text-brand/80"}>
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
                    <span className="text-foreground font-medium">{optimizer.stats[i]}</span>
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

          {resolved.subclass && resolved.subclass.fragmentHashes.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground w-16 shrink-0">Fragments</span>
              <div className="flex flex-wrap gap-1">
                {resolved.subclass.fragmentHashes.map((hash, i) => (
                  <PlugIcon key={`${hash}-${i}`} hash={hash} manifest={manifest} />
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
                    suffix={currentUnlocks.has(hash) ? undefined : "not currently unlocked"}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="border-border/60 flex flex-wrap items-center justify-end gap-2 border-t pt-2.5">
            <Button size="sm" variant="outline" onClick={() => onLoadInBuilder(saved)}>
              <SlidersHorizontal weight="duotone" aria-hidden />
              Load in builder
            </Button>
            <Button size="sm" variant="outline" onClick={() => onEdit(saved)}>
              <PencilSimple weight="duotone" aria-hidden />
              Edit
            </Button>
            <Button size="sm" variant="outline" onClick={openInDim}>
              <ArrowSquareOut weight="duotone" aria-hidden />
              Open in DIM
            </Button>
            <Button
              size="sm"
              onClick={applyLoadout}
              disabled={!resolved.actionable || !targetCharacter || applying}
              title={
                disabledReason ??
                "Equips the armor and subclass, then sockets mods, tuning, and fragments (be in orbit)"
              }
            >
              {applying ? <CircleNotch className="animate-spin" aria-hidden /> : null}
              Apply loadout
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button size="icon-sm" variant="outline" />}
                aria-label="More actions"
              >
                <DotsThree weight="bold" aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onDuplicate(saved)}>
                  <Copy weight="duotone" aria-hidden />
                  Duplicate
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onShare(saved)}>
                  <ShareNetwork weight="duotone" aria-hidden />
                  Copy share link
                </DropdownMenuItem>
                <DropdownMenuItem onClick={copyItemIds} disabled={!resolved.actionable}>
                  <Copy weight="duotone" aria-hidden />
                  Copy item IDs
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => onDelete(saved)}>
                  <Trash weight="duotone" aria-hidden />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}
    </div>
  );
});
