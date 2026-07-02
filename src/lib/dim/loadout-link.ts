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

export function defaultLoadoutName(
  loadout: OptimizerLoadout,
  exoticName?: string,
): string {
  return `Stat Builder ${loadout.total} — ${exoticName ?? "no exotic"}`;
}
