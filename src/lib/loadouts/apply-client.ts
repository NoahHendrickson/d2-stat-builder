"use client";

import type { QueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import { signOutForReauth } from "@/lib/auth/sign-out";
import type { ArmoryCharacter } from "@/lib/armory/fetch";
import { isFullyMasterworked } from "@/lib/armory/masterwork";
import { armorPipTier, type ArmorPiece } from "@/lib/armory/normalize";
import type { LoadoutWeapon } from "@/lib/armory/weapons";
import type { Manifest } from "@/lib/manifest/load";
import { ABILITY_KINDS } from "@/lib/dim/subclasses";
import { equipItemRef, vaultedNote } from "@/lib/bungie/equip-client";
import { planSpares, type EquipItemState } from "@/lib/bungie/equip-plan";
import type { ItemResult, PlugRequest, PlugResult } from "@/lib/bungie/equip-server";
import type { ResolvedLoadout } from "./resolve";
import type { SavedLoadout } from "./types";
import { planLoadoutPlugs, type ApplyPlan, type SubclassPlugGroup } from "./apply-plan";
import { subclassOptions, selectedSubclassPlugs, subclassFragmentCapacity } from "./subclass";
import { planPiecesFromArmor } from "./plan-pieces";
import { plugInfoFromManifest } from "./plug-info";
import { planExoticWeaponSwap } from "./weapons";
import { planArtifactApply } from "./artifact-apply";
import {
  beginApplyProgress,
  finishApplyProgress,
  itemStepId,
  parseApplyStreamEvent,
  patchApplyProgress,
  plugStepId,
  readNdjsonLines,
  type ApplyStep,
} from "./apply-progress";

export interface ApplyOutcome {
  plan: ApplyPlan;
  equip: ItemResult[];
  plugs: PlugResult[];
  /**
   * The user stopped it from the progress card. Some steps may have run (the card shows
   * which), so gear has moved, but `equip` / `plugs` are empty: treat it as not applied.
   */
  cancelled?: boolean;
}

/**
 * Apply a saved loadout to `character`: plan the plug inserts from live data, POST the
 * equip + plug batch, and stream progress into the apply card. Returns null when the
 * request itself failed (already toasted). Requires `resolved.actionable`.
 */
export async function applySavedLoadout({
  saved,
  resolved,
  character,
  armory,
  weapons: ownedWeapons = [],
  manifest,
  queryClient,
  batch,
}: {
  saved: SavedLoadout;
  resolved: ResolvedLoadout;
  character: ArmoryCharacter;
  /** Every owned piece — picks same-slot spares to vault if a character's slot is full. */
  armory: Iterable<ArmorPiece>;
  /** Every owned weapon — the same for weapon slots, plus the exotic swap (see below). */
  weapons?: readonly LoadoutWeapon[];
  manifest: Manifest;
  queryClient: QueryClient;
  /**
   * Labels the progress card when this apply is one step of a run (an activity set);
   * the run reports the result, so no outcome toast is shown here.
   */
  batch?: string;
}): Promise<ApplyOutcome | null> {
  const pieces = resolved.armor.map((a) => a.piece!);
  const items: EquipItemState[] = pieces.map(equipItemRef);
  // Callers may hand over a one-shot iterator (e.g. `map.values()`); it's walked more
  // than once below.
  const owned = Array.isArray(armory) ? (armory as ArmorPiece[]) : [...armory];

  // Weapons are optional, and one that has left the account is skipped (and reported)
  // rather than holding back the armor. A legendary goes on first when the loadout's
  // exotic would otherwise collide with the one already equipped.
  const liveWeapons = resolved.weapons.flatMap((w) => (w.weapon ? [w.weapon] : []));
  const exoticSwap = planExoticWeaponSwap(liveWeapons, ownedWeapons, character.id);
  const equipWeapons = exoticSwap.swap ? [exoticSwap.swap, ...liveWeapons] : liveWeapons;
  for (const w of equipWeapons) {
    items.push({
      itemInstanceId: w.instanceId,
      itemHash: w.itemHash,
      location: w.location,
      characterId: w.characterId,
      isExotic: w.isExotic,
      slot: w.slot,
    });
  }

  const spares = planSpares([...owned, ...ownedWeapons], items, character.id);
  const pieceName = (id: string) =>
    owned.find((p) => p.instanceId === id)?.name ??
    ownedWeapons.find((w) => w.instanceId === id)?.name ??
    "a piece";

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

  // Artifact: the character's copy goes on (if it isn't already), then its perks move.
  const nameOf = (hash: number | undefined) =>
    manifest.def("DestinyInventoryItemDefinition", hash)?.displayProperties?.name ?? "Perk";
  const artifactPlan = resolved.artifact
    ? planArtifactApply(resolved.artifact, character.artifacts ?? [], character.id, manifest, nameOf)
    : undefined;
  if (artifactPlan?.equip) items.push(artifactPlan.equip);

  const groups: SubclassPlugGroup[] = [];
  if (subclassItem && resolved.subclass?.subclass) {
    const options = subclassOptions(manifest, character.classType, resolved.subclass.subclass);
    const carrier = { hash: subclassItem.itemHash, socketOverrides: resolved.subclass.socketOverrides };
    // Abilities first so a Super/aspect swap never fights a fragment that needs it.
    const specs: { kind: SubclassPlugGroup["kind"]; group: (typeof options)["aspects"]; current: Record<number, number> }[] = [
      ...ABILITY_KINDS.map((kind) => ({
        kind: kind === "super" ? ("super" as const) : ("ability" as const),
        group: options.abilities[kind],
        current: subclassItem.abilitySockets,
      })),
      { kind: "aspect", group: options.aspects, current: subclassItem.aspectSockets },
      { kind: "fragment", group: options.fragments, current: subclassItem.fragmentSockets },
    ];
    for (const { kind, group, current } of specs) {
      const entries = Object.entries(carrier.socketOverrides).filter(([i]) => Number(i) >= group.start && Number(i) < group.start + group.count);
      if (!entries.length) continue;
      groups.push({
        kind,
        start: group.start,
        count: kind === "fragment" ? Math.min(group.count, subclassFragmentCapacity(carrier, options.aspects)) : group.count,
        current,
        desired: selectedSubclassPlugs(carrier, group),
        emptyHash: group.emptyHash,
        clearUnused: entries.some(([, hash]) => hash === group.emptyHash),
      });
    }
  }

  const plan = planLoadoutPlugs({
    pieces: planPiecesFromArmor(pieces, manifest),
    modHashes: saved.loadout.parameters.mods,
    plugInfo: plugInfoFromManifest(manifest),
    placements: saved.modPlacement,
    subclass:
      subclassItem && resolved.subclass?.subclass
        ? { instanceId: subclassItem.instanceId, groups }
        : undefined,
  });
  if (resolved.subclass && !subclassItem) plan.skipped.push("Subclass is not available on this character");
  for (const w of resolved.weapons) {
    if (w.missing) plan.skipped.push(`${w.name} is no longer in your inventory`);
  }
  if (exoticSwap.blocked) plan.skipped.push(exoticSwap.blocked);
  if (artifactPlan) {
    plan.plugs.push(...artifactPlan.plugs);
    plan.inPlace.push(...artifactPlan.inPlace);
    plan.alreadyApplied.push(...artifactPlan.inPlace.map((p) => p.label));
    plan.skipped.push(...artifactPlan.skipped);
  }

  const plugs: PlugRequest[] = plan.plugs.map(({ itemInstanceId, socketIndex, plugItemHash }) => ({
    itemInstanceId,
    socketIndex,
    plugItemHash,
  }));

  const iconOf = (hash: number | undefined) =>
    manifest.def("DestinyInventoryItemDefinition", hash)?.displayProperties?.icon;
  const subclassDef = subclassItem
    ? manifest.def("DestinyInventoryItemDefinition", subclassItem.itemHash)
    : undefined;
  const steps: ApplyStep[] = [];
  if (subclassItem && items.some((i) => i.itemInstanceId === subclassItem.instanceId)) {
    steps.push({
      id: itemStepId(subclassItem.instanceId),
      name: subclassDef?.displayProperties?.name ?? "Subclass",
      icon: subclassDef?.displayProperties?.icon,
      status: "pending",
    });
  }
  if (artifactPlan?.equip && resolved.artifact) {
    steps.push({
      id: itemStepId(artifactPlan.equip.itemInstanceId),
      name: resolved.artifact.name,
      icon: resolved.artifact.icon,
      status: "pending",
    });
  }
  for (const w of equipWeapons) {
    steps.push({
      id: itemStepId(w.instanceId),
      name: w.name,
      icon: w.icon,
      watermark: w.watermark,
      status: "pending",
    });
  }
  for (const piece of pieces) {
    if (!items.some((i) => i.itemInstanceId === piece.instanceId)) continue;
    steps.push({
      id: itemStepId(piece.instanceId),
      name: piece.name,
      icon: piece.icon,
      watermark: piece.watermark,
      gearTier: armorPipTier(piece),
      masterworked: isFullyMasterworked(piece),
      status: "pending",
    });
  }
  for (const plug of plan.inPlace) {
    steps.push({
      id: plugStepId(plug),
      name: plug.label,
      icon: iconOf(plug.plugItemHash),
      status: "ok",
    });
  }
  for (const plug of plan.plugs) {
    steps.push({
      id: plugStepId(plug),
      name: plug.label,
      icon: iconOf(plug.plugItemHash),
      status: "pending",
    });
  }

  const showCard = steps.length > 0;
  // Names this apply for the card's Cancel button (see apply-loadout/cancel).
  const applyId = crypto.randomUUID();
  const requestCancel = async () => {
    const res = await fetch("/api/bungie/apply-loadout/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ applyId }),
    });
    if (!res.ok) throw new Error("Cancel failed");
  };
  const session = showCard
    ? beginApplyProgress(
        { name: saved.loadout.name, batch, steps, skipped: plan.skipped },
        requestCancel,
      )
    : 0;

  const failCard = (message: string) => {
    if (!showCard) return;
    patchApplyProgress(session, { type: "error", error: message });
    finishApplyProgress(session, "fail");
  };

  let res: Response;
  try {
    res = await fetch("/api/bungie/apply-loadout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ characterId: character.id, items, plugs, spares, applyId }),
    });
  } catch {
    failCard("Apply failed");
    if (!showCard) toast.error("Apply failed — check your connection and try again");
    return null;
  }
  const contentType = res.headers.get("content-type") ?? "";

  if (!res.ok || !contentType.includes("ndjson") || !res.body) {
    const data = (await res.json().catch(() => null)) as
      | { error?: string; reauth?: boolean }
      | null;
    const message = data?.error ?? "Apply failed";
    failCard(message);
    if (!showCard) toast.error(message);
    if (data?.reauth) void signOutForReauth(queryClient);
    return null;
  }

  let equip: ItemResult[] = [];
  let plugsOut: PlugResult[] = [];
  let streamError: string | undefined;
  let gotDone = false;
  let cancelled = false;
  try {
    for await (const line of readNdjsonLines(res.body)) {
      let event = parseApplyStreamEvent(line);
      if (!event) continue;
      if (event.type === "item" && event.result.vaulted?.length) {
        const note = vaultedNote(event.result.vaulted, pieceName);
        const message = event.result.ok ? note : `${event.result.message ?? "Equip failed"} (${note})`;
        event = { ...event, result: { ...event.result, message } };
      }
      if (showCard) patchApplyProgress(session, event);
      if (event.type === "done") {
        equip = event.equip;
        plugsOut = event.plugs;
        gotDone = true;
      } else if (event.type === "cancelled") {
        cancelled = true;
      } else if (event.type === "error") {
        streamError = event.error;
        if (event.reauth) void signOutForReauth(queryClient);
      }
    }
  } catch {
    // The connection dropped mid-stream. The server keeps going, so the character may
    // be partially changed — say so rather than leave the card spinning.
    streamError = "Connection lost while applying — refresh your gear to see what changed";
    if (showCard) patchApplyProgress(session, { type: "error", error: streamError });
  }

  if (cancelled) {
    if (showCard) finishApplyProgress(session, "cancelled");
    return { plan, equip: [], plugs: [], cancelled: true };
  }

  if (streamError || !gotDone) {
    const message = streamError ?? "Apply failed";
    if (showCard) {
      if (!streamError) patchApplyProgress(session, { type: "error", error: message });
      finishApplyProgress(session, "fail");
    } else {
      toast.error(message);
    }
    return null;
  }

  const outcome: ApplyOutcome = { plan, equip, plugs: plugsOut };
  if (showCard) finishApplyProgress(session, finishFromResults(equip, plugsOut));
  else if (!batch) toastOutcome(outcome, [...pieces, ...equipWeapons], character, pieceName);
  return outcome;
}


function finishFromResults(
  equip: ItemResult[],
  plugs: PlugResult[],
): "ok" | "partial" | "fail" {
  const failed = equip.some((r) => !r.ok) || plugs.some((r) => !r.ok);
  const ok = equip.some((r) => r.ok) || plugs.some((r) => r.ok);
  if (failed && ok) return "partial";
  if (failed) return "fail";
  return "ok";
}

function toastOutcome(
  { plan, equip, plugs }: ApplyOutcome,
  pieces: { instanceId: string; name: string }[],
  character: ArmoryCharacter,
  pieceName: (id: string) => string,
) {
  const equipFailed = equip.filter((r) => !r.ok);
  // Every spare that left the character, including ones vaulted for a piece that then
  // failed anyway — the user needs to know either way.
  const vaultedIds = equip.flatMap((r) => r.vaulted ?? []);
  const plugFailed = plugs.filter((r) => !r.ok);
  const equippedCount = equip.filter((r) => r.ok).length;
  const pluggedCount = plugs.filter((r) => r.ok).length;
  const summary = [
    equippedCount ? `${equippedCount} equipped` : null,
    pluggedCount ? `${pluggedCount} mods socketed` : null,
    plan.alreadyApplied.length ? `${plan.alreadyApplied.length} already in place` : null,
    vaultedIds.length ? vaultedNote(vaultedIds, pieceName) : null,
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
