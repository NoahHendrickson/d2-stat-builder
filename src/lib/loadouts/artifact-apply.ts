// Applying a loadout's artifact: put the artifact on (it is matched by item hash on the
// target character — every character has its own copy), then move its perks into place.
//
// Runtime imports are relative so the module runs under vitest.
import {
  artifactPerkSockets,
  assignArtifactPerks,
  planArtifactPlugs,
  type ArtifactDefLookup,
  type OwnedArtifact,
} from "../armory/artifact-items";
import type { EquipItemState } from "../bungie/equip-plan";
import type { PlugAction } from "./apply-plan";
import type { ResolvedArtifact } from "./resolve";

export interface ArtifactApplyPlan {
  /** The artifact to equip, when the character has it but it isn't on. */
  equip?: EquipItemState;
  /** The character's copy, when it has one. */
  item?: OwnedArtifact;
  plugs: PlugAction[];
  inPlace: PlugAction[];
  skipped: string[];
}

export function planArtifactApply(
  artifact: ResolvedArtifact,
  owned: readonly OwnedArtifact[],
  characterId: string,
  manifest: ArtifactDefLookup,
  perkName: (hash: number) => string,
): ArtifactApplyPlan {
  const item = owned.find((a) => a.itemHash === artifact.itemHash);
  if (!item) {
    return { plugs: [], inPlace: [], skipped: [`${artifact.name} isn't on this character`] };
  }
  const equip: EquipItemState | undefined = item.equipped
    ? undefined
    : { itemInstanceId: item.instanceId, itemHash: item.itemHash, location: "inventory", characterId };

  const skipped: string[] = [];
  const locked = new Set(item.locked);
  const wanted = artifact.perks.filter((hash) => {
    if (!locked.has(hash)) return true;
    skipped.push(`${perkName(hash)}: not unlocked on ${artifact.name} yet`);
    return false;
  });
  const sockets = artifactPerkSockets(manifest, item.itemHash);
  const target = wanted.length > 0 ? assignArtifactPerks(sockets, wanted, item.perks) : {};
  if (!target) {
    skipped.push(`${artifact.name}: the perks don't fit its sockets`);
    return { equip, item, plugs: [], inPlace: [], skipped };
  }
  const { steps, inPlace } = planArtifactPlugs(sockets, target, item.perks);
  const action = (s: { socketIndex: number; plugItemHash: number; clear?: boolean }): PlugAction => ({
    itemInstanceId: item.instanceId,
    socketIndex: s.socketIndex,
    plugItemHash: s.plugItemHash,
    label: s.clear
      ? `Free ${perkName(item.perks[s.socketIndex])} → ${artifact.name}`
      : `${perkName(s.plugItemHash)} → ${artifact.name}`,
  });
  return { equip, item, plugs: steps.map(action), inPlace: inPlace.map(action), skipped };
}
