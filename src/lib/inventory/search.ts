// The manager's item search, a DIM-style query language:
//   plain words        name, perk, or notes contain it ("fatebringer", "kill clip")
//   #word              notes contain the hashtag
//   is:/not:<keyword>  weapon, armor, exotic, crafted, craftable, locked, junk, dupe, heavy, …
//   tag:<tag>          favorite, keep, junk, infuse, archive, none
//   power:>=400        also >, <, <=, =; the same for tier: and stat:<name>:
//   stat:total:>=60    armor stat total; any live stat by name (stat:range:>50)
//   perk: origin: name: notes: type: element: breaker: class: ammo:
// Terms are ANDed; "or" between terms ORs them; "-term" negates; ( ) group.
import type { Annotations, ItemTag } from "./annotations";
import { ITEM_TAGS } from "./annotations";
import { BUCKETS } from "./buckets";
import type { InventoryItem, ManagerInventory } from "./build";
import type { Place } from "./moves";

export interface SearchContext {
  annotations: Annotations;
  /** Lower-case perk names on the item (plugged and rolled options). */
  perks(item: InventoryItem): readonly string[];
  /** Lower-case origin trait names on a weapon. */
  origins(item: InventoryItem): readonly string[];
  /** Item hashes the account owns more than one of. */
  dupes: ReadonlySet<number>;
}

type Predicate = (item: InventoryItem, place: Place, ctx: SearchContext) => boolean;

export type ParsedSearch =
  | { ok: true; predicate: Predicate; usesPerks: boolean }
  | { ok: false; error: string };

const ITEM_TYPE_ARMOR = 2;
const ITEM_TYPE_WEAPON = 3;
const TIER_NAMES: Record<string, number> = { exotic: 6, legendary: 5, rare: 4, uncommon: 3, common: 2 };
const CLASS_NAMES: Record<string, number> = { titan: 0, hunter: 1, warlock: 2 };
const AMMO_NAMES: Record<string, number> = { primary: 1, special: 2, heavy: 3 };
const BREAKER_NAMES: Record<string, number> = {
  barrier: 1,
  antibarrier: 1,
  shieldpiercing: 1,
  overload: 2,
  disruption: 2,
  unstoppable: 3,
  stagger: 3,
};
const ELEMENTS = new Set(["kinetic", "arc", "solar", "void", "stasis", "strand", "prismatic"]);
const SLOT_NAMES: Record<string, number> = {
  kineticslot: BUCKETS.kinetic,
  energyslot: BUCKETS.energy,
  powerslot: BUCKETS.power,
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
};

/** Strip case, spaces, and punctuation so "Hand Cannon" and "handcannon" meet. */
export const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9#]+/g, "");

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
  "locked",
  "unlocked",
  "tagged",
  ...ITEM_TAGS,
  "notes",
  "equipped",
  "postmaster",
  "invault",
  "dupe",
  ...Object.keys(CLASS_NAMES),
  ...Object.keys(AMMO_NAMES),
  ...ELEMENTS,
  "barrier",
  "overload",
  "unstoppable",
  ...Object.keys(SLOT_NAMES),
];

/** Every `key:` the parser takes (aliases aside), in the order suggestions list them. */
export const SEARCH_KEYS: readonly string[] = [
  "is",
  "not",
  "tag",
  "perk",
  "origin",
  "name",
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

const tagOf = (item: InventoryItem, ctx: SearchContext): ItemTag | undefined =>
  item.instanceId ? ctx.annotations[item.instanceId]?.tag : undefined;
const notesOf = (item: InventoryItem, ctx: SearchContext): string =>
  (item.instanceId ? ctx.annotations[item.instanceId]?.notes : undefined)?.toLowerCase() ?? "";

function isKeyword(word: string): Predicate | undefined {
  if (word in TIER_NAMES) return (i) => i.tierType === TIER_NAMES[word];
  if (word in CLASS_NAMES) return (i) => i.classType === CLASS_NAMES[word];
  if (word in AMMO_NAMES) return (i) => i.ammoType === AMMO_NAMES[word];
  if (word in BREAKER_NAMES) return (i) => i.breakerType === BREAKER_NAMES[word];
  if (word in SLOT_NAMES) return (i) => i.bucketHash === SLOT_NAMES[word];
  if (ELEMENTS.has(word)) return (i) => i.element === word;
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
      return { predicate: (i) => normalize(i.name).includes(value) };
    case "perk":
    case "perkname":
      return { predicate: (i, _, c) => c.perks(i).some((p) => normalize(p).includes(value)), usesPerks: true };
    case "origin":
    case "origintrait":
      return { predicate: (i, _, c) => c.origins(i).some((p) => normalize(p).includes(value)), usesPerks: true };
    case "type":
      return { predicate: (i) => normalize(i.typeName).includes(value) };
    case "element":
    case "damage":
      return { predicate: (i) => i.element === value };
    case "breaker":
    case "champion": {
      const b = BREAKER_NAMES[value];
      if (!b) throw new SearchError(`Unknown champion ${raw} (barrier, overload, unstoppable)`);
      return { predicate: (i) => i.breakerType === b };
    }
    case "class": {
      const c = CLASS_NAMES[value];
      if (c === undefined) throw new SearchError(`Unknown class ${raw}`);
      return { predicate: (i) => i.classType === c };
    }
    case "ammo": {
      const a = AMMO_NAMES[value];
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
    // Plain text: the name, a perk, or the notes.
    usesPerks = true;
    const word = normalize(token);
    const text = token.toLowerCase();
    return (i, _, c) =>
      normalize(i.name).includes(word) ||
      c.perks(i).some((p) => normalize(p).includes(word)) ||
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
  forEachItem(inv, (item, place) => {
    if (predicate(item, place, ctx)) out.add(item.key);
  });
  return out;
}
