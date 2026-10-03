"use client";

import { useMemo, useState, type ReactNode } from "react";
import Image from "next/image";
import {
  artifactPerkColumns,
  artifactPerkSockets,
  assignArtifactPerks,
  type OwnedArtifact,
} from "@/lib/armory/artifact-items";
import type { DimLoadoutItem } from "@/lib/dim/loadout-link";
import type { Manifest } from "@/lib/manifest/load";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TooltipLabel } from "@/components/ui/tooltip";
import { ArmorThumb } from "@/components/armor-thumb";
import {
  EmptySlotIcon,
  LOADOUT_SLOT_CLASS,
} from "@/components/loadouts/loadout-weapons-editor";
import { cn } from "@/lib/utils";

export interface ArtifactSection {
  manifest: Manifest;
  /** The artifacts on the character the loadout is for, equipped first. */
  owned: readonly OwnedArtifact[];
  /** The loadout's artifact as saved. */
  initial?: DimLoadoutItem;
}

/** The editor's artifact: which one, and its perks in the order they were picked. */
export interface ArtifactPick {
  hash: number;
  perks: number[];
}

export function initialArtifactPick({ initial }: ArtifactSection): ArtifactPick | null {
  if (!initial) return null;
  const overrides = Object.entries(initial.socketOverrides ?? {}).sort(
    ([a], [b]) => Number(a) - Number(b),
  );
  return { hash: initial.hash, perks: overrides.map(([, hash]) => hash) };
}

/** The pick as a loadout item ref: the character's instance, perks placed in sockets. */
export function artifactPickRef(
  { manifest, owned }: ArtifactSection,
  pick: ArtifactPick | null,
): DimLoadoutItem | null {
  if (!pick) return null;
  const sockets = artifactPerkSockets(manifest, pick.hash);
  const instanceId = owned.find((a) => a.itemHash === pick.hash)?.instanceId;
  return {
    ...(instanceId ? { id: instanceId } : {}),
    hash: pick.hash,
    socketOverrides: assignArtifactPerks(sockets, pick.perks) ?? {},
  };
}

/** What a live artifact holds now, as a pick. */
function livePick(artifact: OwnedArtifact): ArtifactPick {
  return { hash: artifact.itemHash, perks: Object.values(artifact.perks) };
}

function samePick(a: ArtifactPick | null, b: ArtifactPick | null) {
  if (!a || !b) return a === b;
  return (
    a.hash === b.hash && a.perks.length === b.perks.length && a.perks.every((h) => b.perks.includes(h))
  );
}

function Icon({
  icon,
  size,
  className,
}: {
  icon: string | undefined;
  size: 24 | 40;
  className?: string;
}) {
  const sizeClass = size === 24 ? "size-6" : "size-10";
  return icon ? (
    <Image
      src={`${BUNGIE_IMAGE_BASE}${icon}`}
      alt=""
      width={size}
      height={size}
      className={cn(sizeClass, className)}
      unoptimized
    />
  ) : (
    <span className={cn("bg-muted block", sizeClass, className)} aria-hidden />
  );
}

/** A 48px pickable tile: chosen = emphatic outline; blocked = 40% and not clickable. */
function Tile({
  label,
  tooltip,
  chosen,
  blocked,
  onClick,
  children,
}: {
  label: string;
  tooltip: ReactNode;
  chosen: boolean;
  blocked?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <TooltipLabel label={tooltip}>
      <button
        type="button"
        aria-pressed={chosen}
        aria-label={label}
        aria-disabled={blocked || undefined}
        onClick={() => {
          if (!blocked) onClick();
        }}
        className={cn(
          "relative flex size-12 shrink-0 items-center justify-center rounded-none border p-1 outline-none transition-[opacity,border-color,background-color,box-shadow] focus-visible:d2-tile-selected",
          chosen
            ? "border-foreground bg-foreground/10 d2-tile-selected cursor-pointer"
            : blocked
              ? "cursor-not-allowed border-foreground/20 opacity-40"
              : "hover:border-foreground/70 hover:bg-foreground/6 cursor-pointer border-foreground/25",
        )}
      >
        {children}
      </button>
    </TooltipLabel>
  );
}

/**
 * The loadout's artifact and its perks. The popover lists the character's artifacts,
 * then the chosen one's perks in its columns; a perk is blocked when every socket that
 * takes it is spoken for, or the player hasn't unlocked it yet. Equipping the loadout
 * puts the artifact on and slots the perks.
 */
export function LoadoutArtifactEditor({
  section,
  value,
  onChange,
}: {
  section: ArtifactSection;
  value: ArtifactPick | null;
  onChange: (next: ArtifactPick | null) => void;
}) {
  const { manifest, owned } = section;
  const [open, setOpen] = useState(false);
  const def = (hash: number | undefined) =>
    manifest.def("DestinyInventoryItemDefinition", hash);

  const sockets = useMemo(
    () => (value ? artifactPerkSockets(manifest, value.hash) : []),
    [manifest, value],
  );
  const columns = useMemo(() => artifactPerkColumns(sockets), [sockets]);
  const live = value ? owned.find((a) => a.itemHash === value.hash) : undefined;
  const locked = useMemo(() => new Set(live?.locked), [live]);
  const picked = useMemo(() => new Set(value?.perks), [value]);
  const equipped = owned.find((a) => a.equipped);
  const name = value ? (def(value.hash)?.displayProperties?.name ?? "Artifact") : undefined;
  // Perks in grid order, so the trigger reads like the game.
  const ordered = columns.flat().filter((h) => picked.has(h));

  const choose = (artifact: OwnedArtifact) => {
    if (value?.hash === artifact.itemHash) return;
    // Start from what that artifact holds now — usually the build it was set up for.
    onChange(livePick(artifact));
  };

  return (
    <section aria-label="Artifact" className="min-w-0">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          aria-label={value ? `Artifact: ${name}, ${value.perks.length} perks` : "Add artifact"}
          className={LOADOUT_SLOT_CLASS}
        >
          {value ? (
            <ArmorThumb icon={def(value.hash)?.displayProperties?.icon} size={48} />
          ) : (
            <EmptySlotIcon />
          )}
          <span className="flex min-w-0 flex-col">
            <span className="d2-label text-[10px] leading-4">Artifact</span>
            <span className={cn("truncate text-sm leading-5", !value && "text-muted-foreground")}>
              {value ? name : "Add artifact"}
            </span>
            {value && (
              <span className="flex items-center gap-0.5">
                {ordered.length > 0 ? (
                  ordered.map((hash) => (
                    <Icon key={hash} icon={def(hash)?.displayProperties?.icon} size={24} />
                  ))
                ) : (
                  <span className="text-muted-foreground text-[10px] leading-4">No perks</span>
                )}
              </span>
            )}
          </span>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto max-w-[calc(100vw-2rem)] gap-3 p-3">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">{name ?? "Artifact"}</span>
            {value && sockets.length > 0 && (
              <span className="text-muted-foreground text-xs tabular-nums">
                {value.perks.length}/{sockets.length} perks
              </span>
            )}
            <span className="ml-auto flex items-center gap-1">
              {equipped && (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={samePick(value, livePick(equipped))}
                  onClick={() => onChange(livePick(equipped))}
                >
                  Use equipped
                </Button>
              )}
              {value && value.perks.length > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => onChange({ hash: value.hash, perks: [] })}
                >
                  Clear perks
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={!value}
                onClick={() => onChange(null)}
              >
                Remove
              </Button>
            </span>
          </div>

          <div role="group" aria-label="Artifacts" className="flex flex-wrap gap-1">
            {owned.map((artifact) => {
              const d = def(artifact.itemHash);
              const label = d?.displayProperties?.name ?? "Artifact";
              return (
                <Tile
                  key={artifact.instanceId}
                  label={label}
                  tooltip={artifact.equipped ? `${label}\nEquipped now` : label}
                  chosen={value?.hash === artifact.itemHash}
                  onClick={() => choose(artifact)}
                >
                  <Icon icon={d?.displayProperties?.icon} size={40} />
                </Tile>
              );
            })}
          </div>

          {value && (
            <div className="flex gap-3 overflow-x-auto">
              {columns.map((column, c) => (
                <div key={c} role="group" aria-label={`Column ${c + 1}`} className="flex flex-col gap-1">
                  {column.map((hash) => {
                    const d = def(hash);
                    const perkName = d?.displayProperties?.name ?? `#${hash}`;
                    const chosen = picked.has(hash);
                    const why = chosen
                      ? undefined
                      : locked.has(hash)
                        ? "Not unlocked yet"
                        : value.perks.length >= sockets.length
                          ? "Every perk slot is taken"
                          : !assignArtifactPerks(sockets, [...value.perks, hash])
                            ? "No slot left that takes this column"
                            : undefined;
                    return (
                      <Tile
                        key={hash}
                        label={why ? `${perkName} — ${why}` : perkName}
                        tooltip={
                          <span className="flex max-w-64 flex-col gap-1">
                            <span className="font-medium">{perkName}</span>
                            {d?.displayProperties?.description && (
                              <span className="text-muted-foreground">
                                {d.displayProperties.description}
                              </span>
                            )}
                            {why && <span className="text-warning">{why}</span>}
                          </span>
                        }
                        chosen={chosen}
                        blocked={why !== undefined}
                        onClick={() =>
                          onChange({
                            hash: value.hash,
                            perks: chosen
                              ? value.perks.filter((h) => h !== hash)
                              : [...value.perks, hash],
                          })
                        }
                      >
                        <Icon icon={d?.displayProperties?.icon} size={40} />
                      </Tile>
                    );
                  })}
                </div>
              ))}
              {columns.length === 0 && (
                <p className="text-muted-foreground text-xs">
                  This artifact&apos;s perks aren&apos;t in the cached game data yet.
                </p>
              )}
            </div>
          )}
          {owned.length === 0 && (
            <p className="text-muted-foreground max-w-80 text-xs">
              No artifacts found on this character.
            </p>
          )}
        </PopoverContent>
      </Popover>
    </section>
  );
}
