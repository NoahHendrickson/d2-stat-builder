import type { Manifest } from "@/lib/manifest/load";
import { STAT_HASH_TO_INDEX, plugKindForCategory } from "@/lib/armory/stats";
import type { PlugInfo } from "./apply-plan";

/** Manifest-backed `plugInfo` for apply-plan: category, name, energy cost, tuned stat. */
export function plugInfoFromManifest(manifest: Manifest): (hash: number) => PlugInfo | undefined {
  const cache = new Map<number, PlugInfo | undefined>();
  return (hash) => {
    if (cache.has(hash)) return cache.get(hash);
    const def = manifest.def("DestinyInventoryItemDefinition", hash);
    let info: PlugInfo | undefined;
    if (def) {
      const cat = def.plug?.plugCategoryIdentifier ?? "";
      // Same classifier the sockets use (normalize.ts), so kinds always line up. A plug
      // that isn't an armor mod at all is "other": it then simply finds no socket that
      // accepts it, which the planner reports by name (better than "Unknown mod").
      const kind = plugKindForCategory(cat) ?? "other";
      let tunedPlus: number | undefined;
      if (kind === "tuning") {
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
