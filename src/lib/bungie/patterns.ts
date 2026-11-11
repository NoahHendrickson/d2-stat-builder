// Crafting pattern progress: how many of a weapon's patterns (red-border copies) the
// player has extracted. Shared by GET /api/bungie/patterns and the item panel that shows it.
import type {
  DestinyCharacterRecordsComponent,
  DestinyProfileRecordsComponent,
  DestinyRecordComponent,
  DestinyRecordDefinition,
} from "bungie-api-ts/destiny2";

/**
 * Bungie's pattern records carry no link to the weapon: each is a "Weapon Pattern"
 * record named after it, with one "Pattern progress" objective.
 */
const PATTERN_RECORD_TYPE = "Weapon Pattern";

export interface PatternRecord {
  hash: number;
  name: string;
  /** 0 profile-wide, 1 per character (the raid patterns). */
  scope: number;
}

export interface PatternProgress {
  progress: number;
  needed: number;
}

/** Pattern progress per weapon name, as GET /api/bungie/patterns returns it. */
export interface PatternsResponse {
  patterns: Record<string, PatternProgress>;
}

/** The pattern records out of the record definition table. */
export function patternRecords(
  defs: Iterable<Pick<DestinyRecordDefinition, "hash" | "recordTypeName" | "displayProperties" | "scope" | "redacted">>,
): PatternRecord[] {
  const out: PatternRecord[] = [];
  for (const def of defs) {
    const name = def.displayProperties?.name;
    if (def.recordTypeName !== PATTERN_RECORD_TYPE || def.redacted || !name) continue;
    out.push({ hash: def.hash, name, scope: def.scope });
  }
  return out;
}

function progressOf(record: DestinyRecordComponent | undefined): PatternProgress | undefined {
  const objective = record?.objectives?.[0];
  if (!objective?.completionValue) return undefined;
  return {
    progress: Math.min(objective.progress ?? 0, objective.completionValue),
    needed: objective.completionValue,
  };
}

/**
 * Each pattern's progress from the profile's records (component 900). Per-character
 * patterns take the furthest character's.
 */
export function patternProgress(
  records: readonly PatternRecord[],
  profileRecords: DestinyProfileRecordsComponent | undefined,
  characterRecords: Record<string, DestinyCharacterRecordsComponent> | undefined,
): Record<string, PatternProgress> {
  const characters = Object.values(characterRecords ?? {});
  const out: Record<string, PatternProgress> = {};
  for (const { hash, name, scope } of records) {
    const candidates =
      scope === 1
        ? characters.map((c) => progressOf(c.records?.[hash]))
        : [progressOf(profileRecords?.records?.[hash])];
    let best: PatternProgress | undefined;
    for (const p of candidates) {
      if (p && (!best || p.progress > best.progress)) best = p;
    }
    if (best) out[name] = best;
  }
  return out;
}

/**
 * A weapon's pattern progress by its name. Adept, Harrowed and Timelost copies share the
 * base weapon's pattern, so a trailing "(…)" is dropped when the full name has none.
 */
export function patternFor(
  patterns: Record<string, PatternProgress> | undefined,
  weaponName: string,
): PatternProgress | undefined {
  if (!patterns) return undefined;
  return patterns[weaponName] ?? patterns[weaponName.replace(/\s*\([^)]*\)$/, "")];
}
