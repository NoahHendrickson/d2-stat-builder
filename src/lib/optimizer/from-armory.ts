import { armorGroupOf, type LegacyRaidKey } from "../armory/legacy-raids";
import type { ArmorPiece } from "../armory/normalize";
import { offArchetypeIndices } from "../armory/stats";
import type { OptimizerPiece } from "./types";

/**
 * An armory piece as the optimizer sees it. Legacy raid armor has no manifest set: it
 * counts toward its raid's synthetic one, but only while that raid is required
 * (`requiredRaids`, see requiredLegacyRaids). Otherwise a set key would split it from
 * its stat twins in the solver's dedupe for no constraint.
 */
export function armorToOptimizerPiece(
  p: ArmorPiece,
  requiredRaids: ReadonlySet<LegacyRaidKey>,
): OptimizerPiece {
  const group = armorGroupOf(p);
  return {
    id: p.instanceId,
    stats: p.stats,
    exotic: p.isExotic,
    hash: p.itemHash,
    setHash:
      group && (!group.raid || requiredRaids.has(group.raid)) ? group.setHash : undefined,
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
