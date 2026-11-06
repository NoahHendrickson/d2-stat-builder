// "Update loadout" from the optimizer: put a fresh build's armor and stat mods into a
// saved loadout while keeping everything the build doesn't decide — subclass, weapons,
// artifact and its perks, other equipped items, and mods that aren't stat, tuning or
// artifice mods. Runtime imports are relative so the module runs under vitest.
import { ARMOR_BUCKETS, plugKindForCategory } from "../armory/stats";
import type { DimLoadout, DimLoadoutItem } from "../dim/loadout-link";
import type { DefLookup } from "./resolve";
import { subclassFromItemHash } from "../dim/subclasses";

export interface UpdateFromBuildLookups {
  /** True for an armor piece (the build replaces every one of them). */
  isArmor: (ref: DimLoadoutItem) => boolean;
  /** True for a mod the optimizer places (stat, tuning, artifice): the build's copy wins. */
  isBuildMod: (hash: number) => boolean;
}

/**
 * `build` is the dim-api loadout a build card makes (armor, a fragments-only subclass
 * carrier, the optimizer's mods); `existing` is the saved one being updated. The
 * result keeps `existing`'s id, its full subclass (aspects, abilities, fragments) when
 * it has one, and its artifact perks.
 */
export function mergeBuildIntoLoadout(
  existing: DimLoadout,
  build: DimLoadout,
  { isArmor, isBuildMod }: UpdateFromBuildLookups,
): DimLoadout {
  const isSubclass = (ref: DimLoadoutItem) => subclassFromItemHash(ref.hash) !== undefined;
  const keptSubclass = existing.equipped.some(isSubclass);
  const equipped = [
    ...build.equipped.filter((ref) => !isSubclass(ref) || !keptSubclass),
    ...existing.equipped.filter((ref) => !isArmor(ref)),
  ];
  const mods = [
    ...build.parameters.mods,
    ...existing.parameters.mods.filter((hash) => !isBuildMod(hash)),
  ];
  const artifactUnlocks =
    existing.parameters.artifactUnlocks ?? build.parameters.artifactUnlocks;
  return {
    ...build,
    id: existing.id,
    equipped,
    unequipped: existing.unequipped,
    parameters: {
      ...build.parameters,
      mods,
      ...(artifactUnlocks ? { artifactUnlocks } : {}),
    },
  };
}

/** `isArmor` / `isBuildMod` read from the manifest (and the live armory for instances). */
export function updateLookups(
  manifest: DefLookup,
  isOwnedArmor: (instanceId: string) => boolean,
): UpdateFromBuildLookups {
  const def = (hash: number) => manifest.def("DestinyInventoryItemDefinition", hash);
  return {
    isArmor: (ref) => {
      if (ref.id !== undefined && isOwnedArmor(ref.id)) return true;
      const bucket = def(ref.hash)?.inventory?.bucketTypeHash;
      return bucket !== undefined && bucket in ARMOR_BUCKETS;
    },
    isBuildMod: (hash) => {
      const kind = plugKindForCategory(def(hash)?.plug?.plugCategoryIdentifier ?? "");
      return kind === "general" || kind === "tuning" || kind === "artifice";
    },
  };
}
