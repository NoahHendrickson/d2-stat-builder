/**
 * Boss DPS for named weapons, from the "Sustained" tab of Aegis's boss DPS
 * spreadsheet. `npm run generate:dps` downloads the tab and snapshots it into
 * public/data/weapon-dps.json; the weapon page reads that snapshot.
 */

import type { PickSlot, Roll } from "./pick-slots";

export const DPS_SHEET_ID = "1_5wtBjRYHHxuF4oJKDb_iOGZs-wTkzB6RYbnyNLbuz4";
/** The "Sustained" tab: simulated DPS of single damage sources. */
export const DPS_SHEET_GID = "1455724279";
export const DPS_SHEET_URL = `https://docs.google.com/spreadsheets/d/${DPS_SHEET_ID}/edit?gid=${DPS_SHEET_GID}#gid=${DPS_SHEET_GID}`;
export const DPS_SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${DPS_SHEET_ID}/export?format=csv&gid=${DPS_SHEET_GID}`;

/** One tested setup of a weapon: the perks and buffs it ran, and what it did. */
export interface DpsSetup {
  /** The perks, mods and buffs the sheet ran, as it words them. */
  setup: string;
  /** Sustained damage per second against a boss, reloads included. */
  dps: number;
  /** Damage from full reserves, every shot fired (the sheet's Total). Missing for infinite-ammo weapons. */
  reservesDamage?: number;
  /** Seconds to fire off full reserves, reloads included (the sheet's TtE). */
  timeToEmpty?: number;
  /** Unlimited ammo (the sheet's INF), so there are no full reserves to total. */
  infinite?: true;
}

export interface WeaponDpsIndex {
  schema: 1;
  generatedAt: string;
  /** Setups by weapon key (see `weaponDpsKey`), highest DPS first. */
  weapons: Record<string, DpsSetup[]>;
}

/** Variant tags the catalog appends to a name; the sheet names the base weapon. */
const VARIANT_SUFFIX = /\s*\((?:Adept|Timelost|Harrowed|Baroque|Damaged)\)\s*$/i;

/** How a weapon is looked up: its base name, case- and apostrophe-folded. */
export function weaponDpsKey(name: string) {
  return name
    .normalize("NFC")
    .replace(VARIANT_SUFFIX, "")
    .replace(/[‘’]/g, "'")
    .trim()
    .toLowerCase();
}

/** RFC 4180 CSV: quoted fields may hold commas, doubled quotes, and line breaks. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** "12,904" → 12904; blanks, "N/A" and "INF" → undefined. */
function readNumber(cell: string | undefined) {
  const value = Number((cell ?? "").replace(/,/g, "").trim());
  return cell?.trim() && Number.isFinite(value) ? value : undefined;
}

/**
 * Builds the index from the Sustained tab's CSV. A row's Name cell is the
 * weapon (or archetype) on its first line and the setup below it. A row counts
 * for a weapon when its first line is that weapon's name, or, for archetype
 * rows ("Aggressive rocket launcher"), when the setup names the weapon it was
 * tested on in brackets ("… (Hezen Vengeance)"). `weaponNames` is every name in
 * the weapon catalog; rows that match none (abilities, unnamed archetypes) are
 * left out.
 */
export function buildWeaponDpsIndex(
  csv: string,
  weaponNames: Iterable<string>,
  generatedAt = new Date().toISOString(),
): WeaponDpsIndex {
  const known = new Set([...weaponNames].map(weaponDpsKey));
  const [header, ...rows] = parseCsv(csv);
  if (!header) throw new Error("The DPS sheet came back empty.");
  const column = (name: string) => {
    const at = header.findIndex(
      (h) => h.replace(/\s+/g, " ").trim().toLowerCase() === name,
    );
    if (at < 0) throw new Error(`The DPS sheet has no "${name}" column.`);
    return at;
  };
  const NAME = column("name");
  const DPS = column("dps");
  const TOTAL = column("total");
  const TTE = column("tte");

  const weapons: Record<string, DpsSetup[]> = {};
  for (const row of rows) {
    const [first = "", ...rest] = (row[NAME] ?? "").split("\n");
    const dps = readNumber(row[DPS]);
    if (!first.trim() || dps === undefined) continue;
    let key = weaponDpsKey(first);
    let setup = rest.join(" ").trim();
    if (!known.has(key)) {
      // An archetype row: credit it to the weapon named in brackets, and drop
      // that name from the setup, since the row shows on the weapon itself.
      const tested = [...setup.matchAll(/\s*\(([^)]+)\)/g)].find((m) =>
        known.has(weaponDpsKey(m[1]!)),
      );
      if (!tested) continue;
      key = weaponDpsKey(tested[1]!);
      setup = setup.replace(tested[0], "").trim();
    }
    const entry: DpsSetup = { setup, dps };
    const reservesDamage = readNumber(row[TOTAL]);
    if (reservesDamage !== undefined) entry.reservesDamage = reservesDamage;
    const timeToEmpty = readNumber(row[TTE]);
    if (timeToEmpty !== undefined) entry.timeToEmpty = timeToEmpty;
    if (row[TOTAL]?.trim().toUpperCase() === "INF") entry.infinite = true;
    (weapons[key] ??= []).push(entry);
  }
  for (const setups of Object.values(weapons)) setups.sort((a, b) => b.dps - a.dps);
  return { schema: 1, generatedAt, weapons };
}

/** How a perk name is compared with a setup's: case- and apostrophe-folded. */
export function perkNameKey(name: string) {
  return name.replace(/[‘’]/g, "'").trim().toLowerCase();
}

/**
 * The perk names a setup could mean, as `perkNameKey`s: the setup split at its
 * commas and pluses, each part without the sheet's enhanced prefix ("e. "),
 * stack count (" x5"), bracketed note or footnote star. Buffs and notes come
 * through too ("Pack Hunter", "simulated"); the caller keeps the ones a weapon
 * has a perk by.
 */
export function setupPerkKeys(setup: string): string[] {
  return setup
    .split(/[,+]/)
    .map((part) =>
      perkNameKey(
        part
          .trim()
          .replace(/\*+$/, "")
          .replace(/^e\.\s*/i, "")
          .replace(/\s*\([^)]*\)$/, "")
          .replace(/\s+x\d+$/i, ""),
      ),
    )
    .filter(Boolean);
}

/**
 * Which perk a setup ran in each column. `columns` holds each column's perks
 * as `perkNameKey`s, in order; `named` is the setup's `setupPerkKeys`. A name
 * fills one column only, and as many names find a column as can: trait
 * columns often roll the same perks, so "Cluster Bomb + Elemental Honing" on
 * two columns that both roll both puts one in each. Returns, per column, the
 * position of its perk, or undefined where the setup names none.
 */
export function matchSetupPerks(
  named: ReadonlySet<string>,
  columns: readonly (readonly string[])[],
): (number | undefined)[] {
  const picks: (number | undefined)[] = columns.map(() => undefined);
  const owner = new Map<string, number>();
  function take(column: number, at: number, name: string) {
    owner.set(name, column);
    picks[column] = at;
    return true;
  }
  // Kuhn's augmenting paths: a column takes its first free name, else one
  // whose column can move to another name.
  function place(column: number, seen: Set<string>): boolean {
    const names = [...columns[column]!.entries()].filter(
      ([, name]) => named.has(name) && !seen.has(name),
    );
    const free = names.find(([, name]) => !owner.has(name));
    if (free) return take(column, ...free);
    for (const [at, name] of names) {
      // A deeper move may have visited it since.
      if (seen.has(name)) continue;
      seen.add(name);
      if (place(owner.get(name)!, seen)) return take(column, at, name);
    }
    return false;
  }
  columns.forEach((_, column) => place(column, new Set()));
  return picks;
}

/** The slot fields the matchers read (see `PickSlot`). */
type SetupSlot = Pick<PickSlot, "key" | "perkIndices">;

/** Each slot's perks as `perkNameKey`s, in slot order. */
function slotNames(slots: readonly SetupSlot[], perks: readonly { name: string }[]) {
  return slots.map((slot) => slot.perkIndices.map((i) => perkNameKey(perks[i]?.name ?? "")));
}

/**
 * Each setup's roll on this weapon: the perk it names in each slot (see
 * `matchSetupPerks`), keyed by slot, or null for a setup that names none here
 * (buffs only).
 */
export function setupRolls(
  setups: readonly DpsSetup[],
  slots: readonly SetupSlot[],
  perks: readonly { name: string }[],
): (Roll | null)[] {
  const names = slotNames(slots, perks);
  return setups.map(({ setup }) => {
    const roll: Roll = {};
    matchSetupPerks(new Set(setupPerkKeys(setup)), names).forEach((at, i) => {
      if (at !== undefined) roll[slots[i]!.key] = slots[i]!.perkIndices[at]!;
    });
    return Object.keys(roll).length > 0 ? roll : null;
  });
}

/**
 * Every perk name a weapon can roll (its columns, masterworks and mods), as
 * `perkNameKey`s.
 */
export function weaponPerkNames(
  weapon: {
    columns: readonly { perkIndices: readonly number[] }[];
    masterworks?: readonly number[];
    mods?: readonly number[];
  },
  perks: readonly { name: string }[],
): Set<string> {
  const names = new Set<string>();
  for (const indices of [...weapon.columns.map((c) => c.perkIndices), weapon.masterworks ?? [], weapon.mods ?? []])
    for (const i of indices) {
      const name = perks[i]?.name;
      if (name) names.add(perkNameKey(name));
    }
  return names;
}

/**
 * The setups this copy of a weapon can run. The sheet names a weapon without
 * its version, so one name covers the base, adept and Timelost copies, whose
 * perk pools differ. A setup that names a perk another version can roll
 * (`versionPerks`, every version's `weaponPerkNames` together) but this one
 * (`ownPerks`) can't was run on that other version, so it's left out. Names no
 * version has (buffs, catalysts, notes) don't count either way.
 */
export function compatibleSetups(
  setups: readonly DpsSetup[],
  ownPerks: ReadonlySet<string>,
  versionPerks: ReadonlySet<string>,
): DpsSetup[] {
  return setups.filter(({ setup }) =>
    setupPerkKeys(setup).every((name) => ownPerks.has(name) || !versionPerks.has(name)),
  );
}
