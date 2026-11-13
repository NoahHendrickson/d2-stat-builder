// The manager's item search, a DIM-style query language:
//   plain words        name, type, perk, or notes contain it ("fatebringer", "kill clip");
//                      a descriptive keyword on its own ("stasis", "hunter", "smg") also
//                      matches as its is: filter
//   #word              notes contain the hashtag
//   is:/not:<keyword>  weapon, armor, exotic, crafted, craftable, locked, junk, dupe, heavy,
//                      handcannon, light, equipped, oncurrentchar, onwarlock, …
//   tag:<tag>          favorite, keep, junk, infuse, archive, none
//   power:>=400        also >, <, <=, =; the same for tier: and stat:<name>:
//   stat:total:>=60    armor stat total; any live stat by name (stat:range:>50)
//   perk: exactperk: origin: name: exactname: notes: type: element: breaker: class: ammo:
// Terms are ANDed; "or" between terms ORs them; "-term" negates; ( ) group.
import type { Annotations, ItemTag } from "./annotations";
import { ITEM_TAGS } from "./annotations";
import { BUCKETS } from "./buckets";
import type { InventoryItem, ManagerInventory } from "./build";
import type { Place } from "./moves";
import { WEAPON_CATEGORIES, WEAPON_TYPE_ALIASES } from "./weapon-types";
import { isAdeptWeaponName } from "@/lib/weapons/weapon-variants";
import {
  AMMO_WORDS,
  CHAMPION_SYNONYMS,
  CHAMPION_WORDS,
  ELEMENT_SIDES,
  ELEMENT_WORDS,
  GRENADE_LAUNCHER_AMMO_WORDS,
  RARITY_WORDS,
  WEAPON_SLOT_ALIASES,
  WEAPON_SLOT_WORDS,
  lookupWord,
  type Ammo,
  type Champion,
  type Rarity,
  type WeaponSlot,
} from "@/lib/search-vocabulary";

export interface SearchContext {
  annotations: Annotations;
  /** Lower-case perk names on the item (plugged and rolled options). */
  perks(item: InventoryItem): readonly string[];
  /** Lower-case origin trait names on a weapon. */
  origins(item: InventoryItem): readonly string[];
  /** Item hashes the account owns more than one of. */
  dupes: ReadonlySet<number>;
}

/** The search context plus what matchItems reads off the inventory: who holds what. */
interface MatchContext extends SearchContext {
  /** The most recently played character. */
  currentCharacterId?: string;
  /** Each character's DestinyClass, by character id. */
  classOf: ReadonlyMap<string, number>;
}

type Predicate = (item: InventoryItem, place: Place, ctx: MatchContext) => boolean;

export type ParsedSearch =
  | { ok: true; predicate: Predicate; usesPerks: boolean }
  | { ok: false; error: string };

const ITEM_TYPE_ARMOR = 2;
const ITEM_TYPE_WEAPON = 3;
/** Each shared word (search-vocabulary.ts) as the manifest number it stands for. */
const numbered = <K extends string, V extends string>(
  words: Readonly<Record<K, V>>,
  ids: Readonly<Record<V, number>>,
): Record<string, number> =>
  Object.fromEntries(Object.entries<V>(words).map(([word, name]) => [word, ids[name]]));

const TIER_NAMES = numbered<string, Rarity>(RARITY_WORDS, {
  Exotic: 6,
  Legendary: 5,
  Rare: 4,
  Uncommon: 3,
  Common: 2,
});
const TIER_COLORS: Record<string, number> = { yellow: 6, purple: 5, blue: 4, green: 3, white: 2 };
const CLASS_NAMES: Record<string, number> = { titan: 0, hunter: 1, warlock: 2 };
/** is:ontitan / is:onhunter / is:onwarlock: on a character of that class (equipped or not). */
const ON_CLASS: Record<string, number> = Object.fromEntries(
  Object.entries(CLASS_NAMES).map(([name, id]) => [`on${name}`, id]),
);
const AMMO_IDS: Record<Ammo, number> = { Primary: 1, Special: 2, Heavy: 3 };
const AMMO_NAMES = numbered<string, Ammo>(AMMO_WORDS, AMMO_IDS);
const BREAKER_NAMES = numbered<string, Champion>(CHAMPION_WORDS, {
  Barrier: 1,
  Overload: 2,
  Unstoppable: 3,
});
const ELEMENTS: ReadonlySet<string> = new Set(ELEMENT_WORDS);
/** is:light / is:dark: the element's side for Prismatic. */
const ELEMENT_SIDE_SETS: Record<string, ReadonlySet<string>> = {
  light: new Set(ELEMENT_SIDES.light),
  dark: new Set(ELEMENT_SIDES.dark),
};
const WEAPON_SLOT_BUCKETS: Record<WeaponSlot, number> = {
  Kinetic: BUCKETS.kinetic,
  Energy: BUCKETS.energy,
  Power: BUCKETS.power,
};
const WEAPON_TYPES = new Set(WEAPON_CATEGORIES.map(([name]) => name));
const SLOT_NAMES: Record<string, number> = {
  ...numbered<string, WeaponSlot>(WEAPON_SLOT_WORDS, WEAPON_SLOT_BUCKETS),
  helmet: BUCKETS.helmet,
  gauntlets: BUCKETS.arms,
  arms: BUCKETS.arms,
  chest: BUCKETS.chest,
  leg: BUCKETS.legs,
  legs: BUCKETS.legs,
  classitem: BUCKETS.classItem,
  ghost: BUCKETS.ghost,
  sparrow: BUCKETS.vehicle,
  vehicle: BUCKETS.vehicle,
  ship: BUCKETS.ships,
  ships: BUCKETS.ships,
};
/** DIM's slot names that read as something else on their own ("power"), so only after is:. */
const SLOT_ALIASES = numbered<string, WeaponSlot>(WEAPON_SLOT_ALIASES, WEAPON_SLOT_BUCKETS);

/** Strip case, spaces, and punctuation so "Hand Cannon" and "handcannon" meet. */
export const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9#]+/g, "");

// A search runs on every keystroke over every item, so each item's normalized name,
// type, and perk names are worked out once and kept (items and perk lists are stable
// objects until the inventory or perk lookup changes).
const normalizedNames = new WeakMap<InventoryItem, string>();
const normalizedTypes = new WeakMap<InventoryItem, string>();
const normalizedLists = new WeakMap<readonly string[], readonly string[]>();
const nameOf = (i: InventoryItem): string => {
  let n = normalizedNames.get(i);
  if (n === undefined) normalizedNames.set(i, (n = normalize(i.name)));
  return n;
};
const typeOf = (i: InventoryItem): string => {
  let n = normalizedTypes.get(i);
  if (n === undefined) normalizedTypes.set(i, (n = normalize(i.typeName)));
  return n;
};
const normalizedAll = (list: readonly string[]): readonly string[] => {
  let n = normalizedLists.get(list);
  if (!n) normalizedLists.set(list, (n = list.map(normalize)));
  return n;
};

/** Every `is:` keyword, for help text and suggestions. */
export const IS_KEYWORDS: readonly string[] = [
  "weapon",
  "armor",
  ...Object.keys(TIER_NAMES),
  "masterwork",
  "crafted",
  "craftable",
  "enhanced",
  "deepsight",
  "adept",
  "locked",
  "unlocked",
  "tagged",
  ...ITEM_TAGS,
  "notes",
  "equipped",
  "oncurrentchar",
  ...Object.keys(ON_CLASS),
  "postmaster",
  "invault",
  "transferable",
  "haspower",
  "dupe",
  ...Object.keys(CLASS_NAMES),
  ...Object.keys(AMMO_NAMES),
  ...ELEMENTS,
  ...Object.keys(ELEMENT_SIDE_SETS),
  ...Object.keys(CHAMPION_WORDS).filter((word) => !CHAMPION_SYNONYMS.has(word)),
  ...WEAPON_TYPES,
  ...Object.keys(GRENADE_LAUNCHER_AMMO_WORDS),
  ...Object.keys(WEAPON_TYPE_ALIASES),
  ...Object.keys(SLOT_NAMES),
  ...Object.keys(SLOT_ALIASES),
  ...Object.keys(TIER_COLORS),
];

/**
 * `is:` words about an item's state or where it is, where the opposite is a common
 * search too, so suggestions offer `not:` beside them (`equ` → is:equipped, not:equipped).
 */
export const STATE_KEYWORDS: ReadonlySet<string> = new Set([
  "masterwork",
  "crafted",
  "craftable",
  "enhanced",
  "deepsight",
  "adept",
  "locked",
  "tagged",
  ...ITEM_TAGS,
  "notes",
  "equipped",
  "oncurrentchar",
  ...Object.keys(ON_CLASS),
  "postmaster",
  "invault",
  "transferable",
  "haspower",
  "dupe",
]);

/**
 * Keywords that describe what an item is, so typed on their own ("stasis", "hunter",
 * "smg") they also match as `is:`. State words (locked, junk, dupe, …) stay text.
 */
const BARE_KEYWORDS: ReadonlySet<string> = new Set([
  "weapon",
  "armor",
  ...Object.keys(TIER_NAMES),
  ...Object.keys(CLASS_NAMES),
  ...Object.keys(AMMO_NAMES),
  ...ELEMENTS,
  ...Object.keys(CHAMPION_WORDS).filter((word) => !CHAMPION_SYNONYMS.has(word)),
  ...WEAPON_TYPES,
  ...Object.keys(WEAPON_TYPE_ALIASES),
  ...Object.keys(SLOT_NAMES),
]);

/** Every `key:` the parser takes (aliases aside), in the order suggestions list them. */
export const SEARCH_KEYS: readonly string[] = [
  "is",
  "not",
  "tag",
  "perk",
  "exactperk",
  "origin",
  "name",
  "exactname",
  "type",
  "element",
  "champion",
  "class",
  "ammo",
  "power",
  "tier",
  "stat",
  "notes",
];

/** The fixed values a key takes, aliases included; open-ended keys (perk:, type:, …) aren't here. */
export const KEY_VALUES: Readonly<Record<string, readonly string[]>> = {
  is: IS_KEYWORDS,
  not: IS_KEYWORDS,
  tag: [...ITEM_TAGS, "none", "any"],
  element: [...ELEMENTS],
  damage: [...ELEMENTS],
  champion: ["barrier", "overload", "unstoppable"],
  breaker: ["barrier", "overload", "unstoppable"],
  class: Object.keys(CLASS_NAMES),
  ammo: Object.keys(AMMO_NAMES),
};

/** TransferStatuses.NotTransferrable. */
const TRANSFER_NOT_TRANSFERRABLE = 2;

const tagOf = (item: InventoryItem, ctx: SearchContext): ItemTag | undefined =>
  item.instanceId ? ctx.annotations[item.instanceId]?.tag : undefined;
const notesOf = (item: InventoryItem, ctx: SearchContext): string =>
  (item.instanceId ? ctx.annotations[item.instanceId]?.notes : undefined)?.toLowerCase() ?? "";

function isKeyword(word: string): Predicate | undefined {
  // Own keys only: `is:constructor` is unknown, not Object's constructor.
  const numberFor = (table: Record<string, number>) => lookupWord(table, word);
  const tier = numberFor(TIER_NAMES) ?? numberFor(TIER_COLORS);
  if (tier !== undefined) return (i) => i.tierType === tier;
  const classType = numberFor(CLASS_NAMES);
  if (classType !== undefined) return (i) => i.classType === classType;
  const onClass = numberFor(ON_CLASS);
  if (onClass !== undefined) {
    return (_, p, ctx) => p.kind === "character" && ctx.classOf.get(p.characterId) === onClass;
  }
  const ammo = numberFor(AMMO_NAMES);
  if (ammo !== undefined) return (i) => i.ammoType === ammo;
  const breaker = numberFor(BREAKER_NAMES);
  if (breaker !== undefined) return (i) => i.breakerType === breaker;
  const bucket = numberFor(SLOT_NAMES) ?? numberFor(SLOT_ALIASES);
  if (bucket !== undefined) return (i) => i.bucketHash === bucket;
  if (ELEMENTS.has(word)) return (i) => i.element === word;
  const side = lookupWord(ELEMENT_SIDE_SETS, word);
  if (side) return (i) => i.element !== undefined && side.has(i.element);
  const launcherAmmo = lookupWord(GRENADE_LAUNCHER_AMMO_WORDS, word);
  if (launcherAmmo) {
    return (i) => i.weaponType === "grenadelauncher" && i.ammoType === AMMO_IDS[launcherAmmo];
  }
  const weaponType = lookupWord(WEAPON_TYPE_ALIASES, word) ?? word;
  if (WEAPON_TYPES.has(weaponType)) return (i) => i.weaponType === weaponType;
  if ((ITEM_TAGS as readonly string[]).includes(word)) return (i, _, ctx) => tagOf(i, ctx) === word;
  switch (word) {
    case "weapon":
      return (i) => i.itemType === ITEM_TYPE_WEAPON;
    case "armor":
      return (i) => i.itemType === ITEM_TYPE_ARMOR;
    case "masterwork":
    case "masterworked":
      return (i) => i.masterworked;
    case "crafted":
      return (i) => i.crafted;
    case "craftable":
      return (i) => i.craftable === true;
    case "enhanced":
      return (i) => i.enhanced;
    case "deepsight":
      return (i) => i.deepsight;
    case "adept":
      return (i) => i.itemType === ITEM_TYPE_WEAPON && isAdeptWeaponName(i.name);
    case "transferable":
    case "movable":
      return (i) => (i.transferStatus & TRANSFER_NOT_TRANSFERRABLE) === 0;
    case "haspower":
    case "haslight":
      return (i) => i.power !== undefined;
    case "locked":
      return (i) => i.locked;
    case "unlocked":
      return (i) => Boolean(i.instanceId) && !i.locked;
    case "tagged":
      return (i, _, ctx) => tagOf(i, ctx) !== undefined;
    case "notes":
      return (i, _, ctx) => notesOf(i, ctx) !== "";
    case "equipped":
      return (_, p) => p.kind === "character" && p.equipped;
    case "oncurrentchar":
    // DIM's name for it, so a search copied from there works (not suggested).
    case "incurrentchar":
      return (_, p, ctx) => p.kind === "character" && p.characterId === ctx.currentCharacterId;
    case "postmaster":
      return (_, p) => p.kind === "postmaster";
    case "invault":
    case "vault":
      return (_, p) => p.kind === "vault";
    case "dupe":
      return (i, _, ctx) => ctx.dupes.has(i.itemHash);
  }
  return undefined;
}

/** `>=400`, `<5`, `=3`, or a bare number (equal). */
function comparison(text: string): ((n: number | undefined) => boolean) | undefined {
  const m = /^(>=|<=|>|<|=)?(\d+)$/.exec(text);
  if (!m) return undefined;
  const target = Number(m[2]);
  switch (m[1]) {
    case ">=":
      return (n) => n !== undefined && n >= target;
    case "<=":
      return (n) => n !== undefined && n <= target;
    case ">":
      return (n) => n !== undefined && n > target;
    case "<":
      return (n) => n !== undefined && n < target;
    default:
      return (n) => n === target;
  }
}

class SearchError extends Error {}

function filterTerm(key: string, raw: string): { predicate: Predicate; usesPerks?: boolean } {
  const value = normalize(raw);
  const text = raw.toLowerCase();
  if (!value) throw new SearchError(`"${key}:" needs a value`);
  switch (key) {
    case "is":
    case "not": {
      const p = isKeyword(value);
      if (!p) throw new SearchError(`Unknown filter ${key}:${raw}`);
      return { predicate: key === "not" ? (i, pl, c) => !p(i, pl, c) : p };
    }
    case "tag": {
      if (value === "none") return { predicate: (i, _, c) => tagOf(i, c) === undefined };
      if (value === "any") return { predicate: (i, _, c) => tagOf(i, c) !== undefined };
      if (!(ITEM_TAGS as readonly string[]).includes(value)) throw new SearchError(`Unknown tag ${raw}`);
      return { predicate: (i, _, c) => tagOf(i, c) === value };
    }
    case "notes":
      return { predicate: (i, _, c) => notesOf(i, c).includes(text) };
    case "name":
      return { predicate: (i) => nameOf(i).includes(value) };
    case "exactname":
      return { predicate: (i) => nameOf(i) === value };
    case "perk":
    case "perkname":
      return { predicate: (i, _, c) => normalizedAll(c.perks(i)).some((p) => p.includes(value)), usesPerks: true };
    case "exactperk":
      return { predicate: (i, _, c) => normalizedAll(c.perks(i)).some((p) => p === value), usesPerks: true };
    case "origin":
    case "origintrait":
      return { predicate: (i, _, c) => normalizedAll(c.origins(i)).some((p) => p.includes(value)), usesPerks: true };
    case "type":
      return { predicate: (i) => typeOf(i).includes(value) };
    case "element":
    case "damage":
      return { predicate: (i) => i.element === value };
    case "breaker":
    case "champion": {
      const b = lookupWord(BREAKER_NAMES, value);
      if (!b) throw new SearchError(`Unknown champion ${raw} (barrier, overload, unstoppable)`);
      return { predicate: (i) => i.breakerType === b };
    }
    case "class": {
      const c = lookupWord(CLASS_NAMES, value);
      if (c === undefined) throw new SearchError(`Unknown class ${raw}`);
      return { predicate: (i) => i.classType === c };
    }
    case "ammo": {
      const a = lookupWord(AMMO_NAMES, value);
      if (!a) throw new SearchError(`Unknown ammo ${raw} (primary, special, heavy)`);
      return { predicate: (i) => i.ammoType === a };
    }
    case "power":
    case "light": {
      const cmp = comparison(raw);
      if (!cmp) throw new SearchError(`power: needs a number, like power:>=400`);
      return { predicate: (i) => cmp(i.power) };
    }
    case "tier": {
      const cmp = comparison(raw);
      if (!cmp) throw new SearchError(`tier: needs a number, like tier:5`);
      return { predicate: (i) => cmp(i.gearTier) };
    }
    case "stat": {
      const at = raw.lastIndexOf(":");
      const cmp = at > 0 ? comparison(raw.slice(at + 1)) : undefined;
      const name = at > 0 ? normalize(raw.slice(0, at)) : "";
      if (!cmp || !name) throw new SearchError(`stat: looks like stat:total:>=60`);
      return { predicate: (i) => cmp(i.stats?.[name]) };
    }
  }
  throw new SearchError(`Unknown filter ${key}:`);
}

/** Split into words, quoted phrases, parens; `key:"a b"` stays one token. */
function tokenize(query: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quoted = false;
  const flush = () => {
    if (current) tokens.push(current);
    current = "";
  };
  for (const ch of query) {
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && /\s/.test(ch)) flush();
    else if (!quoted && (ch === "(" || ch === ")")) {
      flush();
      tokens.push(ch);
    } else current += ch;
  }
  flush();
  return tokens;
}

/** Parse a query; an empty one parses to `null` (no filtering). */
export function parseSearch(query: string): ParsedSearch | null {
  const tokens = tokenize(query.trim());
  if (tokens.length === 0) return null;
  let pos = 0;
  let usesPerks = false;

  const term = (): Predicate => {
    const token = tokens[pos++]!;
    if (token === "(") {
      const inner = orExpr();
      if (tokens[pos] !== ")") throw new SearchError("Missing )");
      pos++;
      return inner;
    }
    if (token === ")") throw new SearchError("Unexpected )");
    if (token.startsWith("-") && token.length > 1) {
      tokens[--pos] = token.slice(1);
      const inner = term();
      return (i, p, c) => !inner(i, p, c);
    }
    if (token.toLowerCase() === "not" && pos < tokens.length) {
      const inner = term();
      return (i, p, c) => !inner(i, p, c);
    }
    const colon = token.indexOf(":");
    if (colon > 0) {
      const { predicate, usesPerks: perks } = filterTerm(token.slice(0, colon).toLowerCase(), token.slice(colon + 1));
      if (perks) usesPerks = true;
      return predicate;
    }
    if (token.startsWith("#")) {
      const tag = token.toLowerCase();
      return (i, _, c) => notesOf(i, c).includes(tag);
    }
    const word = normalize(token);
    // A descriptive keyword: what it says ("stasis" is is:stasis), or an item named so.
    const keyword = BARE_KEYWORDS.has(word) ? isKeyword(word) : undefined;
    if (keyword) return (i, p, c) => keyword(i, p, c) || nameOf(i).includes(word);
    // Plain text: the name, the type, a perk, or the notes.
    usesPerks = true;
    const text = token.toLowerCase();
    return (i, _, c) =>
      nameOf(i).includes(word) ||
      typeOf(i).includes(word) ||
      normalizedAll(c.perks(i)).some((p) => p.includes(word)) ||
      notesOf(i, c).includes(text);
  };

  const andExpr = (): Predicate => {
    const parts: Predicate[] = [];
    while (pos < tokens.length && tokens[pos] !== ")" && tokens[pos]!.toLowerCase() !== "or") {
      if (tokens[pos]!.toLowerCase() === "and") {
        pos++;
        continue;
      }
      parts.push(term());
    }
    if (parts.length === 0) throw new SearchError("Nothing to search for there");
    return parts.length === 1 ? parts[0]! : (i, p, c) => parts.every((f) => f(i, p, c));
  };

  const orExpr = (): Predicate => {
    const parts = [andExpr()];
    while (tokens[pos]?.toLowerCase() === "or") {
      pos++;
      parts.push(andExpr());
    }
    return parts.length === 1 ? parts[0]! : (i, p, c) => parts.some((f) => f(i, p, c));
  };

  try {
    const predicate = orExpr();
    if (pos < tokens.length) throw new SearchError("Unexpected )");
    return { ok: true, predicate, usesPerks };
  } catch (err) {
    if (err instanceof SearchError) return { ok: false, error: err.message };
    throw err;
  }
}

/** Every item with where it sits. */
export function forEachItem(inv: ManagerInventory, fn: (item: InventoryItem, place: Place) => void) {
  for (const c of inv.characters) {
    for (const item of Object.values(c.equipped)) fn(item, { kind: "character", characterId: c.id, equipped: true });
    for (const list of Object.values(c.inventory)) {
      for (const item of list) fn(item, { kind: "character", characterId: c.id, equipped: false });
    }
    for (const item of c.postmaster) fn(item, { kind: "postmaster", characterId: c.id });
  }
  for (const list of Object.values(inv.vault)) for (const item of list) fn(item, { kind: "vault" });
  for (const list of Object.values(inv.account)) for (const item of list) fn(item, { kind: "account" });
}

/** Item hashes of instanced gear the account holds more than one copy of. */
export function dupeHashes(inv: ManagerInventory): Set<number> {
  const seen = new Set<number>();
  const dupes = new Set<number>();
  forEachItem(inv, (item) => {
    if (!item.instanceId) return;
    if (seen.has(item.itemHash)) dupes.add(item.itemHash);
    else seen.add(item.itemHash);
  });
  return dupes;
}

/** Every copy of a weapon, by name: reissues have hashes of their own but the same name. */
export function weaponCopies(inv: ManagerInventory, name: string): { item: InventoryItem; place: Place }[] {
  const copies: { item: InventoryItem; place: Place }[] = [];
  forEachItem(inv, (item, place) => {
    if (item.itemType === ITEM_TYPE_WEAPON && item.instanceId && item.name === name) copies.push({ item, place });
  });
  return copies;
}

/** Keys of the items `predicate` matches. */
export function matchItems(inv: ManagerInventory, predicate: Predicate, ctx: SearchContext): Set<string> {
  const out = new Set<string>();
  // Characters come most recently played first (build.ts).
  const match: MatchContext = {
    ...ctx,
    currentCharacterId: inv.characters[0]?.id,
    classOf: new Map(inv.characters.map((c) => [c.id, c.classType])),
  };
  forEachItem(inv, (item, place) => {
    if (predicate(item, place, match)) out.add(item.key);
  });
  return out;
}
