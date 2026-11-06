// "Update loadout" from the optimizer: put a fresh build's armor and stat mods into a
// saved loadout while keeping everything the build doesn't decide — weapons, artifact
// and its perks, other equipped items, mods that aren't stat, tuning or artifice mods,
// and the subclass's Super, abilities and aspects. Runtime imports are relative so the
// module runs under vitest.
import { ARMOR_BUCKETS, plugKindForCategory } from "../armory/stats";
import type { DimLoadout, DimLoadoutItem } from "../dim/loadout-link";
import type { Manifest } from "../manifest/load";
import { subclassFromItemHash } from "../dim/subclasses";
import { subclassOptions, withSubclassPlugs } from "./subclass";

export interface UpdateFromBuildLookups {
  /** True for an armor piece (the build replaces every one of them). */
  isArmor: (ref: DimLoadoutItem) => boolean;
  /** True for a mod the optimizer places (stat, tuning, artifice): the build's copy wins. */
  isBuildMod: (hash: number) => boolean;
  /** `item` with its fragment sockets set to `hashes` (the rest emptied). */
  withFragments: (item: DimLoadoutItem, hashes: number[]) => DimLoadoutItem;
}

/** The builder's subclass: which one, and the fragments its stat math used. */
export interface BuilderSubclass {
  itemHash: number;
  fragmentHashes: number[];
}

const isSubclass = (ref: DimLoadoutItem) => subclassFromItemHash(ref.hash) !== undefined;

/**
 * `build` is the dim-api loadout a build card makes (armor, a fragments-only subclass
 * carrier, the optimizer's mods); `existing` is the saved one being updated. The
 * result keeps `existing`'s id and artifact perks. Its subclass is the saved one with
 * the builder's fragments (they're part of the build's stats); if the builder is on a
 * different subclass, the builder's wins.
 */
export function mergeBuildIntoLoadout(
  existing: DimLoadout,
  build: DimLoadout,
  builderSubclass: BuilderSubclass | undefined,
  { isArmor, isBuildMod, withFragments }: UpdateFromBuildLookups,
): DimLoadout {
  const saved = existing.equipped.find(isSubclass);
  const carrier = build.equipped.find(isSubclass);
  const subclass = !builderSubclass
    ? (saved ?? carrier)
    : saved?.hash === builderSubclass.itemHash
      ? withFragments(saved, builderSubclass.fragmentHashes)
      : (carrier ?? { hash: builderSubclass.itemHash });
  const equipped = [
    ...build.equipped.filter((ref) => !isSubclass(ref)),
    ...existing.equipped.filter((ref) => !isArmor(ref) && !isSubclass(ref)),
    ...(subclass ? [subclass] : []),
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

/** The lookups, read from the manifest (and the live armory for instances). */
export function updateLookups(
  manifest: Manifest,
  classType: number,
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
    withFragments: (item, hashes) => {
      const subclass = subclassFromItemHash(item.hash);
      return subclass
        ? withSubclassPlugs(item, subclassOptions(manifest, classType, subclass).fragments, hashes)
        : item;
    },
  };
}
