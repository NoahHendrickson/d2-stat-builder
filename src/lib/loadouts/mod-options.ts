import type { Manifest } from "@/lib/manifest/load";
import type { ArmorPiece, ArmorSocket } from "@/lib/armory/normalize";
import {
  BALANCED_TUNING_PLUG_HASH,
  STAT_HASH_TO_INDEX,
  STAT_LABELS,
  STAT_ORDER,
  plugKindForCategory,
  type ArmorSocketKind,
} from "@/lib/armory/stats";
import { plugDescription } from "@/lib/armory/fragments";
import { getArtificeModHashes, getTuningPlugHashes } from "@/lib/dim/mod-hashes";

/** One pickable mod for a socket. */
export interface ModOption {
  hash: number;
  name: string;
  icon?: string;
  description?: string;
  /** Armor energy cost (0 for tuning / artifice). */
  cost: number;
  /** False when the game refuses a second copy ("Similar mod already applied"). */
  stackable: boolean;
  /**
   * The seasonal-artifact copy of a mod (cheaper, no collectible). Every armor mod
   * ships as a full-cost + discounted pair under one name; see `dedupeModOptions`.
   */
  artifactOnly: boolean;
}

/** DestinyStatDefinition hash for "Energy Cost" — every plug carries it; it says nothing about what the mod does. */
const ENERGY_COST_STAT_HASH = 3578062600;
/** Insertion-rule text on mods the game won't take twice on one piece. */
const NO_STACK_RULE = "Similar mod already applied";

/** Last Wish leftover; deprecated and not useful in the picker. */
export function isExcludedModName(name: string): boolean {
  const n = name.toLowerCase();
  return n.includes("curse of riven") || n.includes("riven's curse");
}

/**
 * "Locked Armor Mod" / "Empty Mod Socket" placeholders sit in every plug set. They are
 * the only entries that neither grant a perk nor move a stat.
 */
export function isPlaceholderPlug(def: {
  perks?: unknown[];
  investmentStats?: { statTypeHash: number }[];
}): boolean {
  return (
    (def.perks?.length ?? 0) === 0 &&
    !(def.investmentStats ?? []).some((s) => s.statTypeHash !== ENERGY_COST_STAT_HASH)
  );
}

/**
 * What a stat mod (general +10 / +5, artifice +3) or directional tuning mod does, e.g.
 * "+10 Grenade" or "+5 Weapons / −5 Grenade" — shown in place of its name. Undefined
 * for any other plug (Balanced Tuning included).
 */
export function statModName(def: {
  plug?: { plugCategoryIdentifier?: string };
  investmentStats?: { statTypeHash: number; value: number }[];
} | undefined): string | undefined {
  const kind = plugKindForCategory(def?.plug?.plugCategoryIdentifier ?? "");
  if (kind !== "general" && kind !== "artifice" && kind !== "tuning") return undefined;
  const inv = (def?.investmentStats ?? [])
    .filter((s) => STAT_HASH_TO_INDEX[s.statTypeHash] !== undefined && s.value !== 0)
    .sort((a, b) => b.value - a.value);
  const shape = inv.map((s) => Math.sign(s.value)).join();
  if (shape !== (kind === "tuning" ? "1,-1" : "1")) return undefined;
  return inv
    .map(
      (s) =>
        `${s.value > 0 ? "+" : "−"}${Math.abs(s.value)} ${STAT_LABELS[STAT_ORDER[STAT_HASH_TO_INDEX[s.statTypeHash]]]}`,
    )
    .join(" / ");
}

function optionFor(manifest: Manifest, hash: number): ModOption | undefined {
  const def = manifest.def("DestinyInventoryItemDefinition", hash);
  if (!def || def.redacted || !def.displayProperties?.name || def.plug?.isDummyPlug) return undefined;
  if (isExcludedModName(def.displayProperties.name)) return undefined;
  if (isPlaceholderPlug(def)) return undefined;
  const rules = def.plug?.insertionRules ?? [];
  return {
    hash,
    name: statModName(def) ?? def.displayProperties.name,
    icon: def.displayProperties.icon,
    description: plugDescription(def, manifest),
    cost: def.plug?.energyCost?.energyCost ?? 0,
    stackable: !rules.some((r) => r.failureMessage?.includes(NO_STACK_RULE)),
    artifactOnly: def.collectibleHash === undefined,
  };
}

/**
 * One entry per mod name. Armor mods come in pairs (full cost + the artifact-discounted
 * copy); show the copy the player can insert when plug-set data says so, else the
 * full-cost one — its insert never depends on the current artifact. Also drops exact
 * hash repeats.
 */
export function dedupeModOptions(
  options: readonly ModOption[],
  insertable?: ReadonlySet<number>,
): ModOption[] {
  const byName = new Map<string, ModOption[]>();
  for (const o of options) {
    const list = byName.get(o.name);
    if (!list) byName.set(o.name, [o]);
    else if (!list.some((x) => x.hash === o.hash)) list.push(o);
  }
  const out: ModOption[] = [];
  for (const variants of byName.values()) {
    const usable = insertable ? variants.filter((v) => insertable.has(v.hash)) : [];
    const pool = usable.length > 0 ? usable : variants;
    out.push(
      [...pool].sort(
        (a, b) =>
          (usable.length > 0 ? a.cost - b.cost : Number(a.artifactOnly) - Number(b.artifactOnly)) ||
          a.cost - b.cost ||
          a.hash - b.hash,
      )[0],
    );
  }
  return out.sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));
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

  /**
   * The mods that can go in `socket` on `piece`: one per name (see `dedupeModOptions`),
   * cost- then name-sorted; tuning by stat. `insertable` (the player's live plug sets)
   * picks which variant of a mod to show.
   */
  optionsFor(piece: ArmorPiece, socket: ArmorSocket, insertable?: ReadonlySet<number>): ModOption[] {
    return dedupeModOptions(this.rawOptionsFor(piece, socket), insertable);
  }

  /** Every variant the plug set lists (cached per socket shape). */
  private rawOptionsFor(piece: ArmorPiece, socket: ArmorSocket): ModOption[] {
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
        // Named "+5 X / −5 Y" by `statModName`.
        const opt = optionFor(this.manifest, hash);
        if (opt) out.push(opt);
      }
    }
    return out;
  }

  /** Display info for a plug hash (any kind), or undefined if unknown. */
  option(hash: number): ModOption | undefined {
    return optionFor(this.manifest, hash);
  }

  /** Socket kind this plug belongs to, or undefined if it isn't an armor mod. */
  kind(hash: number): ArmorSocketKind | undefined {
    const cat = this.manifest.def("DestinyInventoryItemDefinition", hash)?.plug
      ?.plugCategoryIdentifier;
    return cat ? plugKindForCategory(cat) : undefined;
  }

  /** Plug investment stats (energy cost is present; callers keep armor hashes only). */
  investmentStats(hash: number) {
    return this.manifest.def("DestinyInventoryItemDefinition", hash)?.investmentStats;
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
