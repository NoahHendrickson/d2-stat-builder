import type { Manifest } from "@/lib/manifest/load";
import { STAT_HASH_TO_INDEX, TUNING_PLUG_CATEGORY } from "@/lib/armory/stats";
import type { PlugInfo, PlugKind } from "./apply-plan";

const GENERAL_MOD_CATEGORY = "enhancements.v2_general";
const ARTIFICE_MOD_CATEGORY = "enhancements.artifice";

/** Manifest-backed `plugInfo` for apply-plan: category, name, energy cost, tuned stat. */
export function plugInfoFromManifest(manifest: Manifest): (hash: number) => PlugInfo | undefined {
  const cache = new Map<number, PlugInfo | undefined>();
  return (hash) => {
    if (cache.has(hash)) return cache.get(hash);
    const def = manifest.def("DestinyInventoryItemDefinition", hash);
    let info: PlugInfo | undefined;
    if (def) {
      const cat = def.plug?.plugCategoryIdentifier ?? "";
      let kind: PlugKind = "other";
      let tunedPlus: number | undefined;
      if (cat === GENERAL_MOD_CATEGORY) kind = "general";
      else if (cat === ARTIFICE_MOD_CATEGORY) kind = "artifice";
      else if (cat.includes(TUNING_PLUG_CATEGORY)) {
        kind = "tuning";
        const inv = def.investmentStats ?? [];
        // Directional = +5 one stat / −5 another; Balanced is all-positive → undefined.
        if (inv.some((s) => s.value < 0)) {
          const plus = inv.find((s) => s.value > 0);
          tunedPlus = plus ? STAT_HASH_TO_INDEX[plus.statTypeHash] : undefined;
        }
      }
      info = {
        kind,
        name: def.displayProperties?.name ?? `#${hash}`,
        cost: def.plug?.energyCost?.energyCost ?? 0,
        ...(tunedPlus !== undefined ? { tunedPlus } : {}),
      };
    }
    cache.set(hash, info);
    return info;
  };
}
