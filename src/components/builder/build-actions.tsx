"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { ArrowSquareOut, CircleNotch, Copy } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { TooltipLabel } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";
import type { ArmorPiece } from "@/lib/armory/normalize";
import type { ArmoryCharacter } from "@/lib/armory/fetch";
import { isSyntheticClassItemId } from "@/lib/armory/exotic-class-perks";
import { isDreamersBondId } from "@/lib/armory/dreamers-bond";
import { CLASS_NAMES } from "@/lib/armory/stats";
import type { StatModHashes } from "@/lib/dim/mod-hashes";
import {
  buildDimLoadout,
  buildDimLoadoutUrl,
  defaultLoadoutName,
  type DimLoadout,
} from "@/lib/dim/loadout-link";
import type { LoadoutDetailsValues } from "@/components/loadouts/loadout-editor-drawer";
import { useLoadoutMutations } from "@/lib/loadouts/use-loadouts";
import { commitLoadout } from "@/lib/loadouts/commit";
import {
  LOADOUT_SCHEMA_VERSION,
  type BuilderSnapshot,
} from "@/lib/loadouts/types";
import type { Manifest } from "@/lib/manifest/load";
import {
  equipItemRef,
  lastPlayedCharacter,
  postEquipRequest,
  vaultedNote,
} from "@/lib/bungie/equip-client";
import { planSpares } from "@/lib/bungie/equip-plan";
import type { OptimizerLoadout } from "@/lib/optimizer/types";

/** Latest slider targets and builder snapshot; rows read this only on user action. */
export type GetBuilderState = () => {
  targets: number[];
  builderSnapshot?: BuilderSnapshot;
};

/** The active subclass's DIM handoff data (undefined hash = unknown subclass/class combo). */
export interface DimSubclassInput {
  name: string;
  itemHash?: number;
  fragmentHashes: number[];
  socketStart: number;
}

export interface BuildActionProps {
  characters: ArmoryCharacter[];
  statModHashes: StatModHashes[] | null;
  tuningPlugHashes: Map<string, number> | null;
  artificeModHashes: (number | undefined)[] | null;
  subclass?: DimSubclassInput;
  getBuilderState: GetBuilderState;
  manifest?: Manifest;
  insertablePlugs?: ReadonlySet<number>;
  onEquipped?: () => void;
  pieceMap: ReadonlyMap<string, ArmorPiece>;
}

const SaveLoadoutDrawer = dynamic(
  () =>
    import("@/components/builder/save-loadout-drawer").then(
      (m) => m.SaveLoadoutDrawer,
    ),
  { ssr: false },
);

/**
 * Footer of an expanded build: copy the piece IDs as a DIM search, hand the
 * build to DIM's loadout editor, or pull the pieces to a character and equip
 * them. All need every piece still present in the armory (a refetch can drop
 * instances from stale results).
 */
export function BuildActions({
  loadout,
  pieces,
  exoticName,
  setBadges,
  characters,
  statModHashes,
  tuningPlugHashes,
  artificeModHashes,
  subclass,
  getBuilderState,
  manifest,
  insertablePlugs,
  onEquipped,
  pieceMap,
}: {
  loadout: OptimizerLoadout;
  pieces: (ArmorPiece | undefined)[];
  exoticName?: string;
  setBadges: { name: string; count: number }[];
} & BuildActionProps) {
  const queryClient = useQueryClient();
  const [equipping, setEquipping] = useState(false);
  // The Save drawer: 0 until the first click (its chunk isn't fetched before then); each
  // click bumps the session so the drawer rebuilds its mod picker from the inputs as
  // they are then. It stays mounted after the first click so it can animate closed.
  const [saveSession, setSaveSession] = useState(0);
  const [saveOpen, setSaveOpen] = useState(false);
  const { create: createLoadout } = useLoadoutMutations();

  const resolved = pieces.filter((p): p is ArmorPiece => p !== undefined);
  const complete = resolved.length === loadout.pieceIds.length;
  // Dreamer's Bond is omitted from saved/DIM/equip lists (empty class-item slot).
  // A theoretical exotic class item still needs a real instance.
  const livePieces = resolved.filter((p) => !isDreamersBondId(p.instanceId));
  const hasBlockingSynthetic = resolved.some(
    (p) =>
      isSyntheticClassItemId(p.instanceId) && !isDreamersBondId(p.instanceId),
  );
  const buildClass = resolved[0]?.classType;
  const targetCharacter = lastPlayedCharacter(characters, buildClass);

  const missingTitle = !complete
    ? "Refresh your gear — a piece in this build is missing"
    : hasBlockingSynthetic
      ? "Theoretical class item — equip / DIM need a real instance"
      : undefined;

  const canActOnItems = complete && !hasBlockingSynthetic;
  const hasModHashes = Boolean(
    statModHashes && tuningPlugHashes && artificeModHashes,
  );

  const defaultName = defaultLoadoutName({
    exoticName,
    subclassName: subclass?.name,
    sets: setBadges,
    total: loadout.total,
  });

  /** The dim-api object for this build (shared by Open in DIM and Save). */
  const makeDimLoadout = (name: string, notes?: string) => {
    const { targets, builderSnapshot } = getBuilderState();
    return buildDimLoadout({
      loadout,
      pieces: livePieces,
      classType: buildClass ?? 3,
      targets,
      statModHashes: statModHashes!,
      tuningPlugHashes: tuningPlugHashes!,
      artificeModHashes: artificeModHashes!,
      subclass:
        subclass?.itemHash !== undefined
          ? {
              itemHash: subclass.itemHash,
              fragmentHashes: subclass.fragmentHashes,
              socketStart: subclass.socketStart,
            }
          : undefined,
      name,
      notes,
      setBonuses: builderSnapshot?.setReqs,
      artifactUnlocks: targetCharacter?.artifactUnlocks,
    });
  };

  const openInDim = () => {
    if (!canActOnItems || !hasModHashes) return;
    const url = buildDimLoadoutUrl(makeDimLoadout(defaultName));
    window.open(url, "_blank", "noopener,noreferrer");
  };

  // Saving allows a theoretical exotic class-item roll: it's stored hash-only (no
  // instance id). Dreamer's Bond is omitted entirely (empty class-item slot).
  const canSave = complete && hasModHashes;

  const openSave = () => {
    if (!canSave || !manifest) return;
    setSaveSession((s) => s + 1);
    setSaveOpen(true);
  };

  const saveLoadout = (dim: DimLoadout, values: LoadoutDetailsValues) => {
    if (!canSave || !manifest) return;
    dim.equipped = dim.equipped.map((item) =>
      item.id !== undefined && isSyntheticClassItemId(item.id)
        ? { hash: item.hash }
        : item,
    );
    const { builderSnapshot } = getBuilderState();
    createLoadout.mutate(
      commitLoadout(
        {
          version: LOADOUT_SCHEMA_VERSION,
          loadout: dim,
          optimizer: loadout,
          ...(builderSnapshot ? { builder: builderSnapshot } : {}),
        },
        manifest,
        values,
      ),
      {
        onSuccess: () => {
          setSaveOpen(false);
          toast.success("Loadout saved", "Find it under the Loadouts tab");
        },
        onError: (err) => {
          toast.error(
            err.notConfigured
              ? "Saving needs loadout storage — set DATABASE_URL (see .env.example)"
              : err.message,
          );
        },
      },
    );
  };

  const copyItemIds = async () => {
    if (!canActOnItems) return;
    const query = livePieces.map((p) => `id:'${p.instanceId}'`).join(" OR ");
    try {
      await navigator.clipboard.writeText(query);
      toast.success("Item IDs copied — paste into DIM search");
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  };

  const equip = async () => {
    if (!canActOnItems || !targetCharacter || equipping) return;
    setEquipping(true);
    try {
      const items = livePieces.map(equipItemRef);
      const results = await postEquipRequest(
        {
          characterId: targetCharacter.id,
          items,
          spares: planSpares(pieceMap.values(), items, targetCharacter.id),
        },
        { queryClient, failureMessage: "Equip failed" },
      );
      if (!results) return;

      const failed = results.filter((r) => !r.ok);
      const vaultedIds = results.flatMap((r) => r.vaulted ?? []);
      if (failed.length === 0) {
        toast.success(
          `Equipped on your ${CLASS_NAMES[buildClass ?? -1] ?? "character"}`,
          vaultedIds.length
            ? vaultedNote(vaultedIds, (id) => pieceMap.get(id)?.name ?? "a piece")
            : undefined,
        );
        onEquipped?.();
      } else {
        const names = failed.map((f) => {
          const piece = resolved.find((p) => p.instanceId === f.itemInstanceId);
          return `${piece?.name ?? "Unknown piece"}: ${f.message ?? "failed"}`;
        });
        toast.warning(`Some items didn't equip — ${names.join("; ")}`);
        onEquipped?.();
      }
    } catch {
      toast.error("Equip failed — check your connection and try again");
    } finally {
      setEquipping(false);
    }
  };

  return (
    // Figma 18:6865 footer: outline actions, then the emphatic "Save as loadout".
    <div className="flex flex-wrap items-center justify-end gap-2 p-4">
      <TooltipLabel
        label={
          missingTitle ??
          (targetCharacter
            ? undefined
            : `No ${CLASS_NAMES[buildClass ?? -1] ?? "matching"} character`)
        }
        disabled={!canActOnItems || !targetCharacter || equipping}
      >
        <Button
          variant="outline"
          onClick={equip}
          disabled={!canActOnItems || !targetCharacter || equipping}
        >
          {equipping ? (
            <CircleNotch className="animate-spin" aria-hidden />
          ) : null}
          Equip items
        </Button>
      </TooltipLabel>
      <TooltipLabel label={missingTitle} disabled={!canActOnItems}>
        <Button
          variant="outline"
          onClick={copyItemIds}
          disabled={!canActOnItems}
        >
          <Copy data-icon="inline-start" aria-hidden />
          Copy item IDs
        </Button>
      </TooltipLabel>
      <TooltipLabel
        label={missingTitle}
        disabled={!canActOnItems || !hasModHashes}
      >
        <Button
          variant="outline"
          onClick={openInDim}
          disabled={!canActOnItems || !hasModHashes}
        >
          Open in DIM
          <ArrowSquareOut data-icon="inline-end" aria-hidden />
        </Button>
      </TooltipLabel>
      <TooltipLabel
        label={!complete ? missingTitle : undefined}
        disabled={!canSave}
      >
        <Button variant="emphatic" onClick={openSave} disabled={!canSave}>
          Save as loadout
        </Button>
      </TooltipLabel>
      {saveSession > 0 && manifest && (
        <SaveLoadoutDrawer
          open={saveOpen}
          onOpenChange={(open) => {
            if (!open) setSaveOpen(false);
          }}
          session={saveSession}
          pieces={livePieces}
          manifest={manifest}
          insertablePlugs={insertablePlugs}
          buildClass={buildClass}
          defaultName={defaultName}
          subclassItemHash={subclass?.itemHash}
          makeDimLoadout={makeDimLoadout}
          busy={createLoadout.isPending}
          onSubmit={saveLoadout}
        />
      )}
    </div>
  );
}
