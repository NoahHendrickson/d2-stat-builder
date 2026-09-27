export const WEAPON_DPS_SHEET_ID = "1_5wtBjRYHHxuF4oJKDb_iOGZs-wTkzB6RYbnyNLbuz4";
export const WEAPON_DPS_SHEET_GID = "1455724279";
export const WEAPON_DPS_SHEET_NAME = "Sustained";

export const WEAPON_DPS_SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${WEAPON_DPS_SHEET_ID}/export?format=csv&gid=${WEAPON_DPS_SHEET_GID}`;
export const WEAPON_DPS_SHEET_URL = `https://docs.google.com/spreadsheets/d/${WEAPON_DPS_SHEET_ID}/edit?gid=${WEAPON_DPS_SHEET_GID}`;

const WEAPON_ROW_TYPES = new Set(["primary", "special", "power", "heavy"]);

export interface WeaponDpsEntry {
  dps: number;
  /** `null` when the sheet marks total damage as INF or N/A. */
  totalDamage: number | null;
  /** Trait perks from the sheet's benchmark build for this weapon. */
  buildPerks: string[];
  /** Perks, mods, and buffs from the sheet row's Name column. */
  buildDescription: string;
}

export interface WeaponDpsCatalogEntry {
  name: string;
  traitPerkNames: string[];
}

export interface WeaponDpsIndex {
  source: string;
  sheet: string;
  syncedAt: string;
  byName: Record<string, WeaponDpsEntry>;
}

export type WeaponDpsLookup = ReadonlyMap<string, WeaponDpsEntry>;

/** Parse a numeric sheet cell; returns `null` for blanks and non-numeric markers. */
export function parseDpsNumber(value: string): number | null {
  const trimmed = value.trim().replace(/,/g, "");
  if (!trimmed || trimmed === "N/A" || trimmed === "INF" || trimmed === "?") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Parse total-damage cells; INF/N/A become `null` (displayed as INF). */
export function parseTotalDamage(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "N/A" || trimmed === "INF" || trimmed === "?") return null;
  return parseDpsNumber(trimmed);
}

/** Match a sheet row to a catalog weapon name (longest name wins). */
export function matchSheetRowToWeapon(
  rawName: string,
  catalogNames: readonly string[],
): string | undefined {
  const rawLower = rawName.toLowerCase();
  for (const name of catalogNames) {
    if (rawLower.includes(name.toLowerCase())) return name;
  }
  return undefined;
}

/** Human-readable build details from the sheet Name cell (perks, mods, buffs). */
export function formatBuildDescription(rawName: string, weaponName: string): string {
  let text = rawName.trim().replace(/\r\n/g, "\n");
  const parenPattern = new RegExp(`\\s*\\(${escapeRegExp(weaponName)}\\)`, "i");
  text = text.replace(parenPattern, "");

  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length > 1 && lines[0]?.toLowerCase() === weaponName.toLowerCase()) {
    lines.shift();
  }

  return lines.join(" · ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Trait perks from the sheet build string that exist on a weapon variant. */
export function extractTraitPerksFromRow(
  rawName: string,
  variants: readonly { traitPerkNames: readonly string[] }[],
): string[] {
  const rawLower = rawName.toLowerCase();
  let best: string[] = [];

  for (const variant of variants) {
    const sorted = [...new Set(variant.traitPerkNames)].sort((a, b) => b.length - a.length);
    const matched: string[] = [];
    for (const perk of sorted) {
      if (rawLower.includes(perk.toLowerCase())) matched.push(perk);
    }
    if (matched.length > best.length) best = matched;
  }

  return best;
}

function catalogNamesFromEntries(catalog: readonly WeaponDpsCatalogEntry[]): string[] {
  return [...new Set(catalog.map((entry) => entry.name))].sort((a, b) => b.length - a.length);
}

function variantsForWeapon(
  catalog: readonly WeaponDpsCatalogEntry[],
  weaponName: string,
): { traitPerkNames: readonly string[] }[] {
  return catalog
    .filter((entry) => entry.name === weaponName)
    .map((entry) => ({ traitPerkNames: entry.traitPerkNames }));
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\n" || (ch === "\r" && next === "\n")) {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      if (ch === "\r") i++;
      continue;
    }
    if (ch === "\r") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += ch;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

/** Build a weapon-name → best sustained DPS lookup from the community sheet CSV. */
export function buildWeaponDpsIndex(
  csvText: string,
  catalog: readonly WeaponDpsCatalogEntry[],
  syncedAt = new Date().toISOString(),
): WeaponDpsIndex {
  const sortedNames = catalogNamesFromEntries(catalog);
  const byName: Record<string, WeaponDpsEntry> = {};
  const rows = parseCsv(csvText);

  for (const row of rows.slice(1)) {
    if (row.length < 20) continue;
    const type = row[1]?.trim().toLowerCase() ?? "";
    if (!WEAPON_ROW_TYPES.has(type)) continue;

    const rawName = row[0]?.trim() ?? "";
    const totalDamage = parseTotalDamage(row[18] ?? "");
    const dps = parseDpsNumber(row[19] ?? "");
    if (!rawName || dps == null) continue;

    const weaponName = matchSheetRowToWeapon(rawName, sortedNames);
    if (!weaponName) continue;

    const buildPerks = extractTraitPerksFromRow(rawName, variantsForWeapon(catalog, weaponName));
    const buildDescription = formatBuildDescription(rawName, weaponName);
    const existing = byName[weaponName];
    if (!existing || dps > existing.dps) {
      byName[weaponName] = { dps, totalDamage, buildPerks, buildDescription };
    }
  }

  return {
    source: `https://docs.google.com/spreadsheets/d/${WEAPON_DPS_SHEET_ID}/edit?gid=${WEAPON_DPS_SHEET_GID}`,
    sheet: WEAPON_DPS_SHEET_NAME,
    syncedAt,
    byName,
  };
}

export function weaponDpsLookupFromIndex(index: WeaponDpsIndex): WeaponDpsLookup {
  return new Map(Object.entries(index.byName));
}

export function formatWeaponDpsParts(entry: WeaponDpsEntry): { total: string; dps: string } {
  return {
    total: entry.totalDamage == null ? "INF" : entry.totalDamage.toLocaleString("en-US"),
    dps: entry.dps.toLocaleString("en-US"),
  };
}

export function formatWeaponDpsLabel(entry: WeaponDpsEntry): string {
  const { total, dps } = formatWeaponDpsParts(entry);
  return `${total} / ${dps}`;
}
