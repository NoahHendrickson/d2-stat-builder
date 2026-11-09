// Import a loadout from a DIM link. Two kinds of link carry one: a short dim.gg link,
// which the server resolves (see /api/dim-share), and DIM's own /loadouts?loadout=<json>.
//
// DIM's data is looser than a saved loadout: fields can be absent, and it can list far
// more items and extras than this app keeps. So it's reduced to what's kept here, then
// goes through the usual validator.
//
// Runtime imports are relative so the module runs under vitest.
import { ASSUME_MASTERWORK_ALL } from "../dim/loadout-link";
import type { Manifest } from "../manifest/load";
import { isBuildItem } from "./ingame-import";
import {
  LOADOUT_SCHEMA_VERSION,
  MAX_ARTIFACT_UNLOCKS,
  MAX_ITEMS,
  MAX_MODS,
  MAX_NAME_LENGTH,
  MAX_NOTES_LENGTH,
  MAX_SET_BONUSES,
  MAX_SOCKET_OVERRIDES,
  MAX_STAT_CONSTRAINTS,
  isInt,
  isObj,
  parseDimLoadout,
  type SavedLoadoutData,
} from "./types";

export type DimLink = { kind: "share"; id: string } | { kind: "inline"; loadout: unknown };

const SHARE_ID = /^[a-z0-9]{4,16}$/;
/** DIM's older constraints use tiers; a tier is ten points of a stat. */
const POINTS_PER_TIER = 10;

const ints = (v: unknown): number[] => (Array.isArray(v) ? v.filter(isInt) : []);

export const isDimShareId = (id: string) => SHARE_ID.test(id);

/** The loadout a pasted DIM link points at, or null if it isn't one. */
export function parseDimLink(text: string): DimLink | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host === "dim.gg") {
    const id = url.pathname.split("/").filter(Boolean)[0]?.toLowerCase();
    return id && isDimShareId(id) ? { kind: "share", id } : null;
  }
  if (host === "destinyitemmanager.com" || host.endsWith(".destinyitemmanager.com")) {
    if (!/\/loadouts\/?$/.test(url.pathname)) return null;
    const json = url.searchParams.get("loadout");
    if (!json) return null;
    try {
      return { kind: "inline", loadout: JSON.parse(json) };
    } catch {
      return null;
    }
  }
  return null;
}

function item(raw: unknown) {
  if (!isObj(raw) || !isInt(raw.hash)) return [];
  const id = typeof raw.id === "string" && raw.id !== "0" && raw.id.length <= 64 ? raw.id : undefined;
  const overrides = isObj(raw.socketOverrides)
    ? Object.entries(raw.socketOverrides)
        .filter(([key, hash]) => Number.isInteger(Number(key)) && isInt(hash))
        .slice(0, MAX_SOCKET_OVERRIDES)
    : [];
  return [
    {
      hash: raw.hash,
      ...(id ? { id } : {}),
      ...(overrides.length > 0 ? { socketOverrides: Object.fromEntries(overrides) } : {}),
    },
  ];
}

function statConstraints(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return raw
    .flatMap((c: unknown) => {
      if (!isObj(c) || !isInt(c.statHash) || c.ignored === true) return [];
      const minStat = isInt(c.minStat)
        ? c.minStat
        : isInt(c.minTier)
          ? c.minTier * POINTS_PER_TIER
          : undefined;
      return minStat === undefined ? [] : [{ statHash: c.statHash, minStat }];
    })
    .slice(0, MAX_STAT_CONSTRAINTS);
}

function setBonuses(raw: unknown) {
  if (!isObj(raw)) return undefined;
  const kept = Object.entries(raw)
    .filter(([key, count]) => Number.isInteger(Number(key)) && (count === 2 || count === 4))
    .slice(0, MAX_SET_BONUSES);
  return kept.length > 0 ? Object.fromEntries(kept) : undefined;
}

function artifactUnlocks(raw: unknown) {
  if (!isObj(raw) || !isInt(raw.seasonNumber)) return undefined;
  const unlockedItemHashes = ints(raw.unlockedItemHashes).slice(0, MAX_ARTIFACT_UNLOCKS);
  return unlockedItemHashes.length > 0
    ? { unlockedItemHashes, seasonNumber: raw.seasonNumber }
    : undefined;
}

/**
 * A DIM loadout as a loadout to save here, or null if there's nothing usable in it.
 * Only the build it equips comes across: this app doesn't use DIM's unequipped items, and
 * can't equip a Ghost, ship or the like, which would otherwise leave the loadout unusable.
 */
export function savedDataFromDimLoadout(raw: unknown, manifest: Manifest): SavedLoadoutData | null {
  if (!isObj(raw)) return null;
  const equipped = (Array.isArray(raw.equipped) ? raw.equipped : [])
    .flatMap(item)
    .filter((ref) => isBuildItem(manifest, ref.hash))
    .slice(0, MAX_ITEMS);
  const p = isObj(raw.parameters) ? raw.parameters : {};
  const mods = ints(p.mods).slice(0, MAX_MODS);
  if (equipped.length === 0 && mods.length === 0) return null;

  const name = typeof raw.name === "string" ? raw.name.trim().slice(0, MAX_NAME_LENGTH).trim() : "";
  const notes = typeof raw.notes === "string" ? raw.notes.slice(0, MAX_NOTES_LENGTH) : "";
  const constraints = statConstraints(p.statConstraints);
  const bonuses = setBonuses(p.setBonuses);
  const artifact = artifactUnlocks(p.artifactUnlocks);
  const loadout = parseDimLoadout({
    id: crypto.randomUUID(),
    name: name || "DIM loadout",
    ...(notes ? { notes } : {}),
    classType: isInt(raw.classType) && raw.classType >= 0 && raw.classType <= 3 ? raw.classType : 3,
    equipped,
    unequipped: [],
    parameters: {
      mods,
      assumeArmorMasterwork: isInt(p.assumeArmorMasterwork)
        ? p.assumeArmorMasterwork
        : ASSUME_MASTERWORK_ALL,
      ...(isInt(p.exoticArmorHash) ? { exoticArmorHash: p.exoticArmorHash } : {}),
      ...(constraints.length > 0 ? { statConstraints: constraints } : {}),
      ...(bonuses ? { setBonuses: bonuses } : {}),
      ...(artifact ? { artifactUnlocks: artifact } : {}),
    },
  });
  return loadout && { version: LOADOUT_SCHEMA_VERSION, loadout };
}

/** Why a pasted link couldn't be imported; the message is shown to the player. */
export class DimImportError extends Error {}

/** The loadout behind a pasted DIM link. Every failure is a DimImportError. */
export async function resolveDimLink(
  text: string,
  manifest: Manifest,
  signal?: AbortSignal,
): Promise<SavedLoadoutData> {
  const link = parseDimLink(text);
  if (!link) throw new DimImportError("That doesn't look like a DIM loadout link");
  let raw = link.kind === "inline" ? link.loadout : undefined;
  if (link.kind === "share") {
    let res: Response;
    try {
      res = await fetch(`/api/dim-share/${encodeURIComponent(link.id)}`, { signal });
    } catch {
      throw new DimImportError("Couldn't reach DIM. Check your connection and try again.");
    }
    if (res.status === 404) throw new DimImportError("That DIM link doesn't exist");
    if (!res.ok) throw new DimImportError("Couldn't reach DIM. Try again in a moment.");
    raw = ((await res.json().catch(() => null)) as { loadout?: unknown } | null)?.loadout;
  }
  const data = savedDataFromDimLoadout(raw, manifest);
  if (!data) throw new DimImportError("That DIM loadout can't be read");
  return data;
}
