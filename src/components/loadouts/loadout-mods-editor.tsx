"use client";

import { TooltipLabel } from "@/components/ui/tooltip";
import { useMemo, useState } from "react";
import Image from "next/image";
import { MagnifyingGlass, X } from "@phosphor-icons/react";
import type { ArmorPiece, ArmorSocket } from "@/lib/armory/normalize";
import { SLOT_LABELS } from "@/lib/armory/stats";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import type { ModOption, ModOptionCatalog } from "@/lib/loadouts/mod-options";
import { pieceEnergyUsed } from "@/lib/loadouts/mod-placement";
import type { ModPlacement } from "@/lib/loadouts/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export const KIND_LABEL: Record<ArmorSocket["kind"], string> = {
  general: "Stat mod",
  other: "Armor mod",
  tuning: "Tuning",
  artifice: "Artifice",
};

function ModIcon({
  option,
  className,
}: {
  option: ModOption | undefined;
  className?: string;
}) {
  if (!option?.icon) {
    return (
      <span
        className={cn("bg-muted inline-block size-8 rounded-sm", className)}
        aria-hidden
      />
    );
  }
  return (
    <Image
      src={`${BUNGIE_IMAGE_BASE}${option.icon}`}
      alt=""
      width={32}
      height={32}
      className={cn("size-8 rounded-sm", className)}
      unoptimized
    />
  );
}

function SocketPicker({
  piece,
  socket,
  catalog,
  chosen,
  onChoose,
}: {
  piece: ArmorPiece;
  socket: ArmorSocket;
  catalog: ModOptionCatalog;
  chosen: number | undefined;
  onChoose: (hash: number | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const options = useMemo(
    () => catalog.optionsFor(piece, socket),
    [catalog, piece, socket],
  );
  // An "Empty … Socket" plug reads as no current mod.
  const current =
    socket.plugHash && socket.plugHash !== socket.emptyPlugHash
      ? catalog.option(socket.plugHash)
      : undefined;
  const chosenOption =
    chosen !== undefined ? catalog.option(chosen) : undefined;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? options.filter((o) => o.name.toLowerCase().includes(q))
      : options;
  }, [options, query]);

  const label = chosenOption
    ? `${chosenOption.name} (${chosenOption.cost})`
    : current
      ? `Keep current: ${current.name}`
      : "Keep current (empty)";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <TooltipLabel
        label={`${KIND_LABEL[socket.kind]} on ${piece.name}: ${label}`}
      >
        <PopoverTrigger
          aria-label={`${KIND_LABEL[socket.kind]} on ${piece.name}: ${label}`}

          className={cn(
            "relative flex size-9 cursor-pointer items-center justify-center rounded-md border transition-colors",
            chosen !== undefined
              ? "border-brand bg-brand/10"
              : "border-border/60 hover:border-foreground/40",
          )}
        >
          <ModIcon
            option={chosenOption ?? current}
            className={chosen === undefined ? "opacity-40" : undefined}
          />
          {chosenOption && chosenOption.cost > 0 && (
            <span className="bg-background text-foreground absolute -top-1 -right-1 rounded-full border px-1 text-[9px] leading-3 tabular-nums">
              {chosenOption.cost}
            </span>
          )}
        </PopoverTrigger>
      </TooltipLabel>
      <PopoverContent align="start" className="w-72 p-2">
        <div className="text-muted-foreground mb-1.5 px-1 text-xs">
          {KIND_LABEL[socket.kind]}
        </div>
        {options.length > 8 && (
          <div className="relative mb-1.5">
            <MagnifyingGlass
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2"
              aria-hidden
            />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search mods"
              aria-label="Search mods"
              className="pl-7"
              autoFocus
            />
          </div>
        )}
        <div className="max-h-64 space-y-0.5 overflow-y-auto">
          <button
            type="button"
            onClick={() => {
              onChoose(undefined);
              setOpen(false);
            }}
            className={cn(
              "hover:bg-muted/60 flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs",
              chosen === undefined && "bg-muted/40",
            )}
          >
            <X className="text-muted-foreground size-4 shrink-0" aria-hidden />
            <span className="truncate">
              Keep current{current ? ` (${current.name})` : " (empty)"}
            </span>
          </button>
          {shown.length === 0 && (
            <p className="text-muted-foreground px-1.5 py-1 text-xs">
              No mods match.
            </p>
          )}
          {shown.map((o) => (
            <TooltipLabel label={o.description} key={o.hash}>
              <button
                type="button"
                onClick={() => {
                  onChoose(o.hash);
                  setOpen(false);
                }}

                className={cn(
                  "hover:bg-muted/60 flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs",
                  chosen === o.hash && "bg-brand/10",
                )}
              >
                <ModIcon option={o} className="size-6" />
                <span className="min-w-0 flex-1 truncate">{o.name}</span>
                {o.cost > 0 && (
                  <span className="text-muted-foreground shrink-0 tabular-nums">
                    {o.cost}
                  </span>
                )}
              </button>
            </TooltipLabel>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Socket-by-socket mod picker for a loadout's five pieces. `value` holds only the
 * sockets the user has chosen a mod for; anything else keeps whatever is socketed at
 * apply time. Stat mods the optimizer assigned arrive pre-chosen.
 */
export function LoadoutModsEditor({
  pieces,
  catalog,
  value,
  onChange,
}: {
  pieces: ArmorPiece[];
  catalog: ModOptionCatalog;
  value: ModPlacement;
  onChange: (next: ModPlacement) => void;
}) {
  const costOf = (hash: number) => catalog.option(hash)?.cost ?? 0;

  const choose = (
    instanceId: string,
    socketIndex: number,
    hash: number | undefined,
  ) => {
    const next: ModPlacement = {
      ...value,
      [instanceId]: { ...(value[instanceId] ?? {}) },
    };
    if (hash === undefined) delete next[instanceId][socketIndex];
    else next[instanceId][socketIndex] = hash;
    if (Object.keys(next[instanceId]).length === 0) delete next[instanceId];
    onChange(next);
  };

  const anyChosen = Object.keys(value).length > 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Mods</span>
        {anyChosen && (
          <Button
            type="button"
            variant="link"
            size="xs"
            onClick={() => onChange({})}
          >
            Clear all
          </Button>
        )}
      </div>
      <div className="divide-border/60 divide-y rounded-lg border">
        {pieces.map((piece) => {
          const sockets = piece.armorSockets ?? [];
          const used = pieceEnergyUsed(piece, value[piece.instanceId], costOf);
          const capacity = piece.energy?.capacity;
          const over = capacity !== undefined && used > capacity;
          return (
            <div
              key={piece.instanceId}
              className="flex items-center gap-3 px-2.5 py-2"
            >
              {piece.icon ? (
                <Image
                  src={`${BUNGIE_IMAGE_BASE}${piece.icon}`}
                  alt=""
                  width={28}
                  height={28}
                  className="size-7 shrink-0 rounded"
                  unoptimized
                />
              ) : (
                <span
                  className="bg-muted size-7 shrink-0 rounded"
                  aria-hidden
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{piece.name}</div>
                <div className="text-muted-foreground text-xs">
                  {SLOT_LABELS[piece.slot]}
                  {capacity !== undefined && (
                    <>
                      {" · "}
                      <span
                        className={cn(
                          "tabular-nums",
                          over && "text-destructive font-medium",
                        )}
                      >
                        {used}/{capacity} energy
                      </span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {sockets.length === 0 ? (
                  <span className="text-muted-foreground text-xs">
                    No mod sockets
                  </span>
                ) : (
                  sockets.map((socket) => (
                    <SocketPicker
                      key={socket.index}
                      piece={piece}
                      socket={socket}
                      catalog={catalog}
                      chosen={value[piece.instanceId]?.[socket.index]}
                      onChoose={(hash) =>
                        choose(piece.instanceId, socket.index, hash)
                      }
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-muted-foreground text-xs">
        Highlighted sockets are part of the loadout; dimmed ones keep whatever
        is socketed when you apply. Energy is the loadout's chosen mods.
      </p>
    </div>
  );
}
