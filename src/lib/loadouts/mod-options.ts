import type { Manifest } from "@/lib/manifest/load";
import type { ArmorPiece, ArmorSocket } from "@/lib/armory/normalize";
import { BALANCED_TUNING_PLUG_HASH, STAT_LABELS, STAT_ORDER } from "@/lib/armory/stats";
import { getArtificeModHashes, getTuningPlugHashes } from "@/lib/dim/mod-hashes";

/** One pickable mod for a socket. */
export interface ModOption {
  hash: number;
  name: string;
  icon?: string;
  description?: string;
  /** Armor energy cost (0 for tuning / artifice). */
  cost: number;
}

function optionFor(manifest: Manifest, hash: number): ModOption | undefined {
  const def = manifest.def("DestinyInventoryItemDefinition", hash);
  if (!def || def.redacted || !def.displayProperties?.name || def.plug?.isDummyPlug) return undefined;
  return {
    hash,
    name: def.displayProperties.name,
    icon: def.displayProperties.icon,
    description: def.displayProperties.description || undefined,
    cost: def.plug?.energyCost?.energyCost ?? 0,
  };
}

/** Plug hashes a plug set lists (everything, including the empty plug). */
export function plugSetHashes(manifest: Manifest, plugSetHash: number | undefined): Set<number> {
  const out = new Set<number>();
  if (!plugSetHash) return out;
  for (const p of manifest.def("DestinyPlugSetDefinition", plugSetHash)?.reusablePlugItems ?? []) {
    out.add(p.plugItemHash);
  }
  return out;
}

/**
 * Per-manifest lookups for socket options. Built once per page (scans the item table
 * for tuning + artifice plugs) and reused for every socket.
 */
export class ModOptionCatalog {
  private readonly tuning: Map<string, number>;
  private readonly artifice: (number | undefined)[];
  private readonly cache = new Map<string, ModOption[]>();

  constructor(private readonly manifest: Manifest) {
    this.tuning = getTuningPlugHashes(manifest);
    this.artifice = getArtificeModHashes(manifest);
  }

  /** The mods that can go in `socket` on `piece` (deduped, name-sorted; tuning by stat). */
  optionsFor(piece: ArmorPiece, socket: ArmorSocket): ModOption[] {
    const key = `${socket.kind}:${socket.plugSetHash ?? 0}:${socket.emptyPlugHash ?? 0}:${piece.tunedStat ?? "-"}:${piece.isExotic ? "x" : "l"}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    let out: ModOption[];
    switch (socket.kind) {
      case "tuning":
        out = this.tuningOptions(piece);
        break;
      case "artifice":
        out = this.artifice.flatMap((h) => (h ? (optionFor(this.manifest, h) ?? []) : []));
        break;
      default:
        // The socket's own "Empty … Socket" plug (its definition's initial item) is in
        // the plug set too; it's a no-op, not a mod, so it's excluded by hash.
        out = [...plugSetHashes(this.manifest, socket.plugSetHash)]
          .filter((h) => h !== socket.emptyPlugHash)
          .flatMap((h) => optionFor(this.manifest, h) ?? [])
          .sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));
    }
    this.cache.set(key, out);
    return out;
  }

  /** Balanced Tuning + the directionals this piece's roll allows (+5 tuned stat / −5 X). */
  private tuningOptions(piece: ArmorPiece): ModOption[] {
    const out: ModOption[] = [];
    const balanced = optionFor(this.manifest, BALANCED_TUNING_PLUG_HASH);
    if (balanced) out.push(balanced);
    if (piece.tunedStat === undefined) return out;
    const pluses = piece.isExotic ? STAT_ORDER.map((_, i) => i) : [piece.tunedStat];
    for (const plus of pluses) {
      for (let minus = 0; minus < STAT_ORDER.length; minus++) {
        if (minus === plus) continue;
        const hash = this.tuning.get(`${plus}-${minus}`);
        if (hash === undefined) continue;
        const opt = optionFor(this.manifest, hash);
        if (opt) {
          out.push({
            ...opt,
            name: `+5 ${STAT_LABELS[STAT_ORDER[plus]]} / −5 ${STAT_LABELS[STAT_ORDER[minus]]}`,
          });
        }
      }
    }
    return out;
  }

  /** Display info for a plug hash (any kind), or undefined if unknown. */
  option(hash: number): ModOption | undefined {
    return optionFor(this.manifest, hash);
  }
}

const catalogs = new WeakMap<Manifest, ModOptionCatalog>();

/** One catalog per manifest (the constructor scans the item table). */
export function getModCatalog(manifest: Manifest): ModOptionCatalog {
  let c = catalogs.get(manifest);
  if (!c) {
    c = new ModOptionCatalog(manifest);
    catalogs.set(manifest, c);
  }
  return c;
}
