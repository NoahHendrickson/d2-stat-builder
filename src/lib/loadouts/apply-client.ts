"use client";

import type { QueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import type { ArmoryCharacter } from "@/lib/armory/fetch";
import type { Manifest } from "@/lib/manifest/load";
import { FRAGMENT_SOCKET_COUNT } from "@/lib/armory/equipped-subclass";
import { FRAGMENT_SOCKET_START } from "@/lib/dim/subclasses";
import { equipItemRef } from "@/lib/bungie/equip-client";
import type { EquipItemState } from "@/lib/bungie/equip-plan";
import type { ItemResult, PlugRequest, PlugResult } from "@/lib/bungie/equip-server";
import type { ResolvedLoadout } from "./resolve";
import type { SavedLoadout } from "./types";
import { planLoadoutPlugs, type ApplyPlan } from "./apply-plan";
import { planPiecesFromArmor } from "./plan-pieces";
import { plugInfoFromManifest } from "./plug-info";

export interface ApplyOutcome {
  plan: ApplyPlan;
  equip: ItemResult[];
  plugs: PlugResult[];
}

/**
 * Apply a saved loadout to `character`: plan the plug inserts from live data, POST the
 * equip + plug batch, and toast a summary. Returns null when the request itself failed
 * (already toasted). Requires `resolved.actionable`.
 */
export async function applySavedLoadout({
  saved,
  resolved,
  character,
  manifest,
  queryClient,
}: {
  saved: SavedLoadout;
  resolved: ResolvedLoadout;
  character: ArmoryCharacter;
  manifest: Manifest;
  queryClient: QueryClient;
}): Promise<ApplyOutcome | null> {
  const pieces = resolved.armor.map((a) => a.piece!);
  const items: EquipItemState[] = pieces.map(equipItemRef);

  // Subclass: equip the loadout's subclass item if it isn't already, and plan fragments.
  const subclassItem = resolved.subclass
    ? character.subclassItems.find((s) => s.itemHash === resolved.subclass!.itemHash)
    : undefined;
  if (subclassItem && !subclassItem.equipped) {
    items.push({
      itemInstanceId: subclassItem.instanceId,
      itemHash: subclassItem.itemHash,
      location: "inventory",
      characterId: character.id,
    });
  }

  const plan = planLoadoutPlugs({
    pieces: planPiecesFromArmor(pieces, manifest),
    modHashes: saved.loadout.parameters.mods,
    plugInfo: plugInfoFromManifest(manifest),
    placements: saved.modPlacement,
    subclass:
      subclassItem && resolved.subclass?.subclass
        ? {
            instanceId: subclassItem.instanceId,
            fragmentSockets: subclassItem.fragmentSockets,
            socketStart: FRAGMENT_SOCKET_START[resolved.subclass.subclass],
            socketCount: FRAGMENT_SOCKET_COUNT,
            desiredFragments: resolved.subclass.fragmentHashes,
          }
        : undefined,
  });

  const plugs: PlugRequest[] = plan.plugs.map(({ itemInstanceId, socketIndex, plugItemHash }) => ({
    itemInstanceId,
    socketIndex,
    plugItemHash,
  }));

  const res = await fetch("/api/bungie/apply-loadout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ characterId: character.id, items, plugs }),
  });
  const data = (await res.json().catch(() => null)) as
    | { equip?: ItemResult[]; plugs?: PlugResult[]; error?: string; reauth?: boolean }
    | null;
  if (!res.ok || !data) {
    toast.error(data?.error ?? "Apply failed");
    if (data?.reauth) void queryClient.invalidateQueries({ queryKey: ["session"] });
    return null;
  }

  const outcome: ApplyOutcome = { plan, equip: data.equip ?? [], plugs: data.plugs ?? [] };
  toastOutcome(outcome, pieces, character);
  return outcome;
}

function toastOutcome(
  { plan, equip, plugs }: ApplyOutcome,
  pieces: { instanceId: string; name: string }[],
  character: ArmoryCharacter,
) {
  const equipFailed = equip.filter((r) => !r.ok);
  const plugFailed = plugs.filter((r) => !r.ok);
  const equippedCount = equip.filter((r) => r.ok).length;
  const pluggedCount = plugs.filter((r) => r.ok).length;
  const summary = [
    equippedCount ? `${equippedCount} equipped` : null,
    pluggedCount ? `${pluggedCount} mods socketed` : null,
    plan.alreadyApplied.length ? `${plan.alreadyApplied.length} already in place` : null,
  ]
    .filter(Boolean)
    .join(", ");

  const problems: string[] = [];
  for (const f of equipFailed) {
    const name = pieces.find((p) => p.instanceId === f.itemInstanceId)?.name ?? "Subclass";
    problems.push(`${name}: ${f.message ?? "failed"}`);
  }
  for (const f of plugFailed) {
    const label = plan.plugs.find(
      (p) =>
        p.itemInstanceId === f.itemInstanceId &&
        p.socketIndex === f.socketIndex &&
        p.plugItemHash === f.plugItemHash,
    )?.label;
    problems.push(`${label ?? "Mod"}: ${f.message ?? "failed"}`);
  }
  problems.push(...plan.skipped);

  const where = `your ${["Titan", "Hunter", "Warlock"][character.classType] ?? "character"}`;
  if (problems.length === 0) {
    toast.success(`Loadout applied to ${where}`, summary || undefined);
  } else if (equippedCount + pluggedCount > 0) {
    toast.warning(`Partially applied to ${where}`, [summary, ...problems].filter(Boolean).join(" · "));
  } else {
    toast.error("Couldn't apply loadout", problems.join(" · "));
  }
}
