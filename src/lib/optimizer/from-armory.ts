import type { ArmorPiece } from "../armory/normalize";
import { offArchetypeIndices } from "../armory/stats";
import type { OptimizerPiece } from "./types";

/** An armory piece as the optimizer sees it. */
export function armorToOptimizerPiece(p: ArmorPiece): OptimizerPiece {
  return {
    id: p.instanceId,
    stats: p.stats,
    exotic: p.isExotic,
    hash: p.itemHash,
    setHash: p.setHash,
    power: p.power,
    // Artifice is legacy-only, tuning Tier-5-only; enforce the exclusivity here
    // (the solver stays general, the results UI shares one column for both).
    artifice: p.isArtifice && p.tunedStat === undefined,
    tuning:
      p.tunedStat !== undefined
        ? { tuned: p.tunedStat, offStats: offArchetypeIndices(p.baseStats) }
        : undefined,
  };
}
