// Theoretical Builds' inputs in localStorage: the tab's current inputs, so a reload keeps
// them, and the player's named builds. Local to the browser like selection-storage.ts;
// no sign-in, no backend. Inputs are stored as a loadout's BuilderSnapshot (the format
// "Load in builder" already reads) plus the class. Theoretical has no Builds-only
// settings, so those fields are stored at their defaults and ignored on load.
//
// Runtime imports are relative (not `@/`), matching selection-storage.ts.
import { SUBCLASSES, type Subclass } from "../armory/fragments";
import { MAX_NAME_LENGTH, parseBuilderSnapshot, type BuilderSnapshot } from "../loadouts/types";

export const THEORY_CURRENT_KEY = "stat-builder:theory-selections";
export const THEORY_SAVED_KEY = "stat-builder:theory-builds";
export const THEORY_STORAGE_VERSION = 1;

/** One set of Theoretical Builds inputs. */
export interface TheoryInputs {
  classType: number | null;
  builder: BuilderSnapshot;
}

export interface SavedTheoryBuild extends TheoryInputs {
  name: string;
}

/**
 * The tab's inputs kept across a reload: the snapshot (the active subclass's fragments)
 * plus every subclass's fragments, so picks on another subclass survive too. Null when
 * the stored draft predates the map; the snapshot's fragments then stand.
 */
export interface TheoryDraft extends TheoryInputs {
  fragSel: Record<Subclass, number[]> | null;
}

// --- pure helpers ---

function parseInputs(v: unknown): TheoryInputs | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (!(o.classType === null || Number.isInteger(o.classType))) return null;
  const builder = parseBuilderSnapshot(o.builder);
  return builder ? { classType: o.classType as number | null, builder } : null;
}

/** A trimmed name, or null when it's empty or too long to keep. */
export function cleanTheoryBuildName(name: string): string | null {
  const trimmed = name.trim();
  return trimmed && trimmed.length <= MAX_NAME_LENGTH ? trimmed : null;
}

const sameName = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;

/**
 * The stored list. Unreadable or old-format storage reads as empty, and a malformed entry
 * (or a second one under a taken name) is dropped rather than failing the rest.
 */
export function parseSavedTheoryBuilds(raw: string | null): SavedTheoryBuild[] {
  if (!raw) return [];
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof obj !== "object" || obj === null) return [];
  const o = obj as Record<string, unknown>;
  if (o.version !== THEORY_STORAGE_VERSION || !Array.isArray(o.builds)) return [];
  const out: SavedTheoryBuild[] = [];
  for (const entry of o.builds) {
    const inputs = parseInputs(entry);
    if (!inputs) continue;
    const rawName = (entry as { name?: unknown }).name;
    const name = typeof rawName === "string" ? cleanTheoryBuildName(rawName) : null;
    if (!name || findTheoryBuild(out, name)) continue;
    out.push({ name, ...inputs });
  }
  return sortTheoryBuilds(out);
}

export function sortTheoryBuilds(list: SavedTheoryBuild[]): SavedTheoryBuild[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name));
}

/** The saved build under `name` (case-insensitive), if any. */
export function findTheoryBuild(
  list: readonly SavedTheoryBuild[],
  name: string,
): SavedTheoryBuild | undefined {
  return list.find((b) => sameName(b.name, name));
}

/** `list` with `build` added, replacing one saved under the same name. */
export function withTheoryBuild(
  list: readonly SavedTheoryBuild[],
  build: SavedTheoryBuild,
): SavedTheoryBuild[] {
  return sortTheoryBuilds([...list.filter((b) => !sameName(b.name, build.name)), build]);
}

export function withoutTheoryBuild(
  list: readonly SavedTheoryBuild[],
  name: string,
): SavedTheoryBuild[] {
  return list.filter((b) => !sameName(b.name, name));
}

/** What the game data and the player's gear offer now, to check a saved build against. */
export interface TheoryBuildOptions {
  /** Exotic names the exotic picker lists. */
  exotics: ReadonlySet<string>;
  /** Fragment hashes the build's subclass offers. */
  fragments: ReadonlySet<number>;
  /** Armor sets the set bonuses list. */
  sets: ReadonlySet<number>;
  /** An exotic class item's Spirit perks by column; null when the exotic isn't one. */
  spiritPerks: (exoticName: string) => { left: number[]; right: number[] } | null;
}

/**
 * The saved inputs without what no longer exists, and a short note for each kind of thing
 * dropped. Nothing here throws: a stale item is skipped and the rest loads.
 */
export function resolveTheoryBuild(
  builder: BuilderSnapshot,
  options: TheoryBuildOptions,
): { builder: BuilderSnapshot; skipped: string[] } {
  const skipped: string[] = [];
  let exoticName = builder.exoticName;
  let exoticPerks = builder.exoticPerks;
  if (exoticName !== null && !options.exotics.has(exoticName)) {
    skipped.push(exoticName);
    exoticName = null;
  }
  const perks = exoticName === null ? null : options.spiritPerks(exoticName);
  if (!perks) {
    exoticPerks = [null, null];
  } else {
    const [left, right] = exoticPerks;
    const keep = (hash: number | null, column: number[]) =>
      hash === null || column.includes(hash) ? hash : null;
    exoticPerks = [keep(left, perks.left), keep(right, perks.right)];
    if (exoticPerks[0] !== left || exoticPerks[1] !== right) skipped.push("Spirit perks");
  }

  const fragmentHashes = builder.fragmentHashes.filter((h) => options.fragments.has(h));
  const lostFragments = builder.fragmentHashes.length - fragmentHashes.length;
  if (lostFragments) skipped.push(lostFragments === 1 ? "1 fragment" : `${lostFragments} fragments`);

  const setReqs = Object.fromEntries(
    Object.entries(builder.setReqs).filter(([hash]) => options.sets.has(Number(hash))),
  ) as Record<number, 2 | 4>;
  const lostSets = Object.keys(builder.setReqs).length - Object.keys(setReqs).length;
  if (lostSets) skipped.push(lostSets === 1 ? "1 set bonus" : `${lostSets} set bonuses`);

  return {
    builder: { ...builder, exoticName, exoticPerks, fragmentHashes, setReqs },
    skipped,
  };
}

/** The toast line for what a load skipped: "Skipped A, B and C: no longer available." */
export function skippedNote(skipped: readonly string[]): string {
  const list =
    skipped.length < 2
      ? skipped.join("")
      : `${skipped.slice(0, -1).join(", ")} and ${skipped[skipped.length - 1]}`;
  return `Skipped ${list}: no longer available.`;
}

// --- storage I/O (best-effort: a private-mode, quota or corrupt-data failure never throws) ---

function storage(): Storage | undefined {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage;
  } catch {
    return undefined;
  }
}

function read(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Whether the value reached storage. */
function write(key: string, value: unknown): boolean {
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadSavedTheoryBuilds(): SavedTheoryBuild[] {
  return parseSavedTheoryBuilds(read(THEORY_SAVED_KEY));
}

/** False when storage refused the write (full, blocked, unavailable). */
export function writeSavedTheoryBuilds(builds: readonly SavedTheoryBuild[]): boolean {
  return write(THEORY_SAVED_KEY, { version: THEORY_STORAGE_VERSION, builds });
}

/** Every subclass's fragment hashes, or null unless each is an array of integers. */
function parseFragSel(v: unknown): Record<Subclass, number[]> | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const ok = SUBCLASSES.every(
    (sc) => Array.isArray(o[sc]) && (o[sc] as unknown[]).every(Number.isInteger),
  );
  return ok ? (Object.fromEntries(SUBCLASSES.map((sc) => [sc, o[sc]])) as Record<Subclass, number[]>) : null;
}

/** The tab's inputs from last visit, or null when absent or unreadable. */
export function loadTheoryInputs(): TheoryDraft | null {
  const raw = read(THEORY_CURRENT_KEY);
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as unknown;
    if ((obj as { version?: unknown } | null)?.version !== THEORY_STORAGE_VERSION) return null;
    const inputs = parseInputs(obj);
    return inputs && { ...inputs, fragSel: parseFragSel((obj as { fragSel?: unknown }).fragSel) };
  } catch {
    return null;
  }
}

export function saveTheoryInputs(draft: TheoryDraft): void {
  write(THEORY_CURRENT_KEY, { version: THEORY_STORAGE_VERSION, ...draft });
}
