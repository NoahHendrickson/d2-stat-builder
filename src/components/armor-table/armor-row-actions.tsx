"use client";

import { TooltipLabel } from "@/components/ui/tooltip";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { Delete02Icon, Loading03Icon } from "@hugeicons/core-free-icons";
import { toast } from "@/lib/toast";
import { setTag, type ItemTag } from "@/lib/inventory/annotations";
import type { ArmorPiece } from "@/lib/armory/normalize";
import type { ArmoryCharacter } from "@/lib/armory/fetch";
import { peekArmory } from "@/lib/armory/use-armory";
import { CLASS_NAMES } from "@/lib/armory/stats";
import { planSpares } from "@/lib/bungie/equip-plan";
import {
  equipItemRef,
  lastPlayedCharacter,
  postEquipRequest,
  vaultedNote,
} from "@/lib/bungie/equip-client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Action = "move" | "equip";

/**
 * Takes no room until its row is hovered or holds keyboard focus (sr-only keeps it tabbable;
 * focus-visible, so a clicked button doesn't pin the actions open after the mouse leaves), so
 * piece names get the whole name cell otherwise. Always shown on touch screens.
 */
const REVEAL_ON_ROW_HOVER =
  "sr-only group-hover/row:not-sr-only group-has-[:focus-visible]/row:not-sr-only pointer-coarse:not-sr-only";

function moveDisabledReason(
  piece: ArmorPiece,
  target: ArmoryCharacter | undefined,
): string | null {
  if (!target)
    return `No ${CLASS_NAMES[piece.classType] ?? "matching"} character`;
  if (piece.location === "equipped")
    return "Equipped items can't be moved — equip something else first";
  if (piece.location === "inventory" && piece.characterId === target.id)
    return "Already on that character";
  return null;
}

function equipDisabledReason(
  piece: ArmorPiece,
  target: ArmoryCharacter | undefined,
): string | null {
  if (!target)
    return `No ${CLASS_NAMES[piece.classType] ?? "matching"} character`;
  if (piece.location === "equipped") {
    return piece.characterId === target.id
      ? "Already equipped"
      : "Equipped on another character — equip something else on them first";
  }
  return null;
}

/**
 * Move / Equip a single piece onto its class's most recently played character,
 * via the same /api/bungie/equip proxy the builder's "Equip items" uses
 * (mode: "move" skips the equip step), and a Junk toggle on the Manager's tag store.
 * Sits at the right of the row's name cell (`group/row`); the junk mark stays visible
 * on junk pieces.
 */
export function ArmorRowActions({
  piece,
  characters,
  onDone,
  provisional = false,
  tag,
}: {
  piece: ArmorPiece;
  characters: ArmoryCharacter[];
  onDone: () => void;
  /** The table shows last visit's gear; nothing may be moved until the live profile lands. */
  provisional?: boolean;
  /** Its Manager tag; Junk replaces any other tag, and clicking it again clears it. */
  tag?: ItemTag;
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<Action | null>(null);
  // Every owned piece, read at click time. Subscribing via useArmory() here would give
  // each virtualized row its own set of query observers just to plan spares.
  const ownedPieces = (): ArmorPiece[] => peekArmory(queryClient)?.pieces ?? [];

  const target = lastPlayedCharacter(characters, piece.classType);
  const junk = tag === "junk";
  const refreshing = provisional ? "Refreshing your gear from Bungie…" : null;
  const reasons: Record<Action, string | null> = {
    move: refreshing ?? moveDisabledReason(piece, target),
    equip: refreshing ?? equipDisabledReason(piece, target),
  };

  const run = async (action: Action) => {
    if (!target || busy) return;
    setBusy(action);
    const className = CLASS_NAMES[piece.classType] ?? "character";
    const pending = toast.loading(
      `${action === "move" ? "Moving" : "Equipping"} ${piece.name}`,
      `${action === "move" ? "to" : "on"} your ${className}`,
    );
    try {
      const items = [equipItemRef(piece)];
      const owned = ownedPieces();
      const results = await postEquipRequest(
        {
          characterId: target.id,
          mode: action,
          items,
          spares: planSpares(owned, items, target.id),
        },
        {
          queryClient,
          failureMessage: `${action === "move" ? "Move" : "Equip"} failed`,
          notify: pending,
        },
      );
      if (!results) return;

      const result = results[0];
      if (result?.ok) {
        const nameOf = (id: string) =>
          owned.find((p) => p.instanceId === id)?.name ?? "a piece";
        pending.success(
          action === "move"
            ? `Moved ${piece.name} to your ${className}`
            : `Equipped ${piece.name} on your ${className}`,
          result.vaulted?.length ? vaultedNote(result.vaulted, nameOf) : undefined,
        );
        onDone();
      } else {
        pending.error(`${piece.name}: ${result?.message ?? "action failed"}`);
      }
    } catch {
      pending.error("Request failed — check your connection and try again");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex shrink-0 items-center gap-1">
      <div className={cn("flex items-center gap-1", !busy && REVEAL_ON_ROW_HOVER)}>
        {(["move", "equip"] as const).map((action) => (
          <TooltipLabel
            label={reasons[action] ?? undefined}
            key={action}
            disabled={Boolean(reasons[action])}
          >
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-xs"
              disabled={Boolean(reasons[action]) || busy !== null}
              onClick={() => void run(action)}
            >
              {busy === action && (
                <HugeiconsIcon icon={Loading03Icon} className="animate-spin" aria-hidden />
              )}
              {action === "move" ? "Move" : "Equip"}
            </Button>
          </TooltipLabel>
        ))}
      </div>
      <span className={cn("flex", !junk && REVEAL_ON_ROW_HOVER)}>
        <TooltipLabel label={junk ? "Unmark junk" : "Mark as junk"}>
          <Button
            size="sm"
            variant={junk ? "default" : "outline"}
            className={cn("size-6 p-0", !junk && "text-muted-foreground")}
            aria-label="Junk"
            aria-pressed={junk}
            onClick={() => setTag([piece.instanceId], junk ? undefined : "junk")}
          >
            <HugeiconsIcon icon={Delete02Icon} className="size-3" aria-hidden />
          </Button>
        </TooltipLabel>
      </span>
    </div>
  );
}
