import type { Manifest } from "./load";
import {
  BALANCED_TUNING_PLUG_HASH,
  STAT_HASHES,
  STAT_ORDER,
  type StatIconMap,
} from "@/lib/armory/stats";

/** Icon path per stat key from the stat definitions (relative Bungie image paths). */
export function statIconsFromManifest(manifest: Manifest | undefined): StatIconMap {
  const out = {} as StatIconMap;
  if (!manifest) return out;
  for (const key of STAT_ORDER) {
    out[key] = manifest.def("DestinyStatDefinition", STAT_HASHES[key])?.displayProperties?.icon;
  }
  return out;
}

export function balancedTuningIconFromManifest(
  manifest: Manifest | undefined,
): string | undefined {
  return manifest?.def("DestinyInventoryItemDefinition", BALANCED_TUNING_PLUG_HASH)
    ?.displayProperties?.icon;
}
