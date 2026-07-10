import type { ArmorPiece } from "@/lib/armory/normalize";
import type { OptimizerLoadout } from "@/lib/optimizer/types";
import type { StatModHashes } from "./mod-hashes";
import {
  BALANCED_TUNING_PLUG_HASH,
  STAT_HASHES,
  STAT_ORDER,
} from "../armory/stats";

/**
 * DIM loadout-share handoff: DIM's /loadouts route accepts a `loadout` query
 * param of URL-encoded JSON (dim-api-types `Loadout` shape) and opens its
 * loadout editor pre-filled — the same mechanism D2ArmorPicker uses. Parsed
 * entirely client-side by DIM; no API key. The user must be signed into DIM.
 */
const DIM_LOADOUT_URL = "https://app.destinyitemmanager.com/loadouts?loadout=";

/** Synthetic instance id for the fragments-carrier subclass entry (D2ArmorPicker convention). */
const SUBCLASS_FAKE_ID = "12345";

/** dim-api AssumeArmorMasterwork.All — matches this app's assumed-MW5 stat model. */
const ASSUME_MASTERWORK_ALL = 3;

export interface DimLoadoutItem {
  id?: string;
  hash: number;
  socketOverrides?: Record<number, number>;
}

export interface DimLoadout {
  id: string;
  name: string;
  classType: number;
  equipped: DimLoadoutItem[];
  unequipped: DimLoadoutItem[];
  parameters: {
    mods: number[];
    exoticArmorHash?: number;
    assumeArmorMasterwork: number;
    statConstraints?: { statHash: number; minStat: number }[];
  };
}

export interface DimLoadoutInput {
  loadout: OptimizerLoadout;
  /** The 5 resolved pieces, slot order (callers guard against missing pieces). */
  pieces: ArmorPiece[];
  classType: number;
  /** Current stat targets (STAT_ORDER); only targets > 0 become constraints. */
  targets: number[];
  /** Per-stat general mod plug hashes (STAT_ORDER) from getStatModHashes. */
  statModHashes: StatModHashes[];
  /** Directional tuning plugs keyed "plus-minus" from getTuningPlugHashes. */
  tuningPlugHashes: Map<string, number>;
  /** Per-stat artifice +3 mod plug hashes (STAT_ORDER) from getArtificeModHashes. */
  artificeModHashes: (number | undefined)[];
  /** Fragments carrier; omitted entirely when no fragments are selected. */
  subclass?: { itemHash: number; fragmentHashes: number[]; socketStart: number };
  name: string;
}

/**
 * Split the per-stat mod bonus into major/minor counts that match the
 * optimizer's actual budget. Start from the fewest-mods split (max majors),
 * then trade majors for 2 minors until the major count equals `modsUsed.major`
 * — point totals guarantee the minor count then matches too.
 */
export function decomposeModBonus(
  modBonus: number[],
  modsUsed: { major: number; minor: number },
): { majors: number[]; minors: number[] } {
  const majors = modBonus.map((v) => Math.floor(v / 10));
  const minors = modBonus.map((v, i) => (v - majors[i] * 10) / 5);
  let excess = majors.reduce((a, b) => a + b, 0) - modsUsed.major;
  for (let i = 0; i < majors.length && excess > 0; i++) {
    const convert = Math.min(majors[i], excess);
    majors[i] -= convert;
    minors[i] += convert * 2;
    excess -= convert;
  }
  return { majors, minors };
}

export function buildDimLoadout(input: DimLoadoutInput): DimLoadout {
  const {
    loadout,
    pieces,
    classType,
    targets,
    statModHashes,
    tuningPlugHashes,
    artificeModHashes,
    subclass,
    name,
  } = input;

  const equipped: DimLoadoutItem[] = pieces.map((p) => ({
    id: p.instanceId,
    hash: p.itemHash,
  }));

  if (subclass && subclass.fragmentHashes.length > 0) {
    const socketOverrides: Record<number, number> = {};
    subclass.fragmentHashes.forEach((hash, i) => {
      socketOverrides[subclass.socketStart + i] = hash;
    });
    equipped.push({ id: SUBCLASS_FAKE_ID, hash: subclass.itemHash, socketOverrides });
  }

  const mods: number[] = [];
  const { majors, minors } = decomposeModBonus(loadout.modBonus, loadout.modsUsed);
  for (let i = 0; i < STAT_ORDER.length; i++) {
    const push = (hash: number | undefined, count: number, size: string) => {
      if (count === 0) return;
      if (hash === undefined) {
        console.warn(`DIM link: no ${size} mod hash for stat ${STAT_ORDER[i]}`);
        return;
      }
      for (let n = 0; n < count; n++) mods.push(hash);
    };
    push(statModHashes[i]?.major, majors[i], "major");
    push(statModHashes[i]?.minor, minors[i], "minor");
  }

  for (const tune of loadout.tuning) {
    if (!tune) continue;
    if (tune.kind === "balanced") {
      mods.push(BALANCED_TUNING_PLUG_HASH);
      continue;
    }
    const hash = tuningPlugHashes.get(`${tune.plus}-${tune.minus}`);
    if (hash === undefined) {
      console.warn(`DIM link: no tuning plug for +${tune.plus}/-${tune.minus}`);
      continue;
    }
    mods.push(hash);
  }

  for (const pick of loadout.artifice) {
    if (pick === null) continue;
    const hash = artificeModHashes[pick];
    if (hash === undefined) {
      console.warn(`DIM link: no artifice mod hash for stat ${STAT_ORDER[pick]}`);
      continue;
    }
    mods.push(hash);
  }

  const statConstraints = STAT_ORDER.flatMap((key, i) =>
    targets[i] > 0
      ? [{ statHash: STAT_HASHES[key], minStat: Math.min(targets[i], 200) }]
      : [],
  );

  return {
    id: "stat-builder", // required by DIM's type; replaced with a UUID on import
    name,
    classType,
    equipped,
    unequipped: [],
    parameters: {
      mods,
      exoticArmorHash: loadout.exotic
        ? pieces.find((p) => p.isExotic)?.itemHash
        : undefined,
      assumeArmorMasterwork: ASSUME_MASTERWORK_ALL,
      ...(statConstraints.length > 0 ? { statConstraints } : {}),
    },
  };
}

export function buildDimLoadoutUrl(loadout: DimLoadout): string {
  return DIM_LOADOUT_URL + encodeURIComponent(JSON.stringify(loadout));
}

/**
 * Short set-bonus tag for the loadout name: single-word set names read fine
 * as-is ("CODA", "Bushido"); multi-word names collapse to initials, dropping a
 * trailing "Set" ("Smoke Jumper Set" → "SJ").
 */
export function abbreviateSetName(name: string): string {
  const words = name.split(/\s+/).filter((w) => w.toLowerCase() !== "set");
  if (words.length <= 1) return words[0] ?? name;
  return words.map((w) => w[0]).join("").toUpperCase();
}

/**
 * Default editor placeholder: "<Exotic> · <Subclass> · <SET 2pc/4pc>", keeping
 * only the parts the build actually has. Set counts collapse to the bonus tier
 * that's active (2pc for 2–3 pieces, 4pc for 4+).
 */
export function defaultLoadoutName(input: {
  exoticName?: string;
  subclassName?: string;
  sets?: { name: string; count: number }[];
  total: number;
}): string {
  const parts: string[] = [];
  if (input.exoticName) parts.push(input.exoticName);
  if (input.subclassName) parts.push(input.subclassName);
  for (const s of input.sets ?? []) {
    if (s.count < 2) continue;
    parts.push(`${abbreviateSetName(s.name)} ${s.count >= 4 ? 4 : 2}pc`);
  }
  return parts.length > 0 ? parts.join(" · ") : `d2-stat-builder ${input.total}`;
}
