"use client";

import { TooltipLabel } from "@/components/ui/tooltip";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CircleNotch } from "@phosphor-icons/react";
import { toast } from "@/lib/toast";
import type { ArmorPiece } from "@/lib/armory/normalize";
import type { ArmoryCharacter } from "@/lib/armory/fetch";
import { CLASS_NAMES } from "@/lib/armory/stats";
import {
  equipItemRef,
  lastPlayedCharacter,
  postEquipRequest,
} from "@/lib/bungie/equip-client";
import { Button } from "@/components/ui/button";

type Action = "move" | "equip";

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
 * (mode: "move" skips the equip step).
 */
export function ArmorRowActions({
  piece,
  characters,
  onDone,
}: {
  piece: ArmorPiece;
  characters: ArmoryCharacter[];
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<Action | null>(null);

  const target = lastPlayedCharacter(characters, piece.classType);
  const reasons: Record<Action, string | null> = {
    move: moveDisabledReason(piece, target),
    equip: equipDisabledReason(piece, target),
  };

  const run = async (action: Action) => {
    if (!target || busy) return;
    setBusy(action);
    try {
      const results = await postEquipRequest(
        {
          characterId: target.id,
          mode: action,
          items: [equipItemRef(piece)],
        },
        {
          queryClient,
          failureMessage: `${action === "move" ? "Move" : "Equip"} failed`,
        },
      );
      if (!results) return;

      const result = results[0];
      const className = CLASS_NAMES[piece.classType] ?? "character";
      if (result?.ok) {
        toast.success(
          action === "move"
            ? `Moved ${piece.name} to your ${className}`
            : `Equipped ${piece.name} on your ${className}`,
        );
        onDone();
      } else {
        toast.error(`${piece.name}: ${result?.message ?? "action failed"}`);
      }
    } catch {
      toast.error("Request failed — check your connection and try again");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex items-center gap-1">
      {(["move", "equip"] as const).map((action) => (
        <TooltipLabel
          label={reasons[action] ?? undefined}
          key={action}
          disabled={Boolean(reasons[action]) || busy !== null}
        >
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-xs"
            disabled={Boolean(reasons[action]) || busy !== null}

            onClick={() => void run(action)}
          >
            {busy === action && (
              <CircleNotch className="animate-spin" aria-hidden />
            )}
            {action === "move" ? "Move" : "Equip"}
          </Button>
        </TooltipLabel>
      ))}
    </div>
  );
}
