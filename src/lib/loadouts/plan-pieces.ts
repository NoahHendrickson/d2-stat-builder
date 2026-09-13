import type { Manifest } from "@/lib/manifest/load";
import type { ArmorPiece } from "@/lib/armory/normalize";
import type { PlanPiece } from "./apply-plan";
import { plugSetHashes } from "./mod-options";

/** Live armor pieces → what the planner needs (sockets with plug-set acceptance, energy, roll). */
export function planPiecesFromArmor(pieces: ArmorPiece[], manifest: Manifest): PlanPiece[] {
  return pieces.map((p) => ({
    instanceId: p.instanceId,
    name: p.name,
    sockets: (p.armorSockets ?? []).map((s) => ({
      index: s.index,
      kind: s.kind,
      current: s.plugHash,
      // Tuning / artifice are judged by roll + kind; other sockets by their plug set.
      ...(s.kind === "other" || s.kind === "general"
        ? { accepts: s.plugSetHash ? plugSetHashes(manifest, s.plugSetHash) : undefined }
        : {}),
    })),
    energy: p.energy,
    tunedStat: p.tunedStat,
    flexibleTuning: p.isExotic && p.tunedStat !== undefined,
  }));
}
