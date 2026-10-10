// Autocomplete for the manager's search box: the term under the caret is completed
// from the query language (keys, is: keywords, tags, …) and from what the account
// holds (weapon types, perk and item names, stat names).
import { IS_KEYWORDS, KEY_VALUES, SEARCH_KEYS, normalize } from "./search";

/** The account's open-ended values, read only when a suggestion needs them. */
export interface SearchVocab {
  types(): readonly string[];
  perks(): readonly string[];
  origins(): readonly string[];
  names(): readonly string[];
  stats(): readonly string[];
}

export interface Suggestion {
  /** The whole term to put in place of the one being typed. */
  text: string;
  /** What kind of term it is, shown beside it ("Perk", "Filter", …). */
  hint: string;
}

export interface Suggestions {
  /** The span of the query the picked suggestion replaces. */
  start: number;
  end: number;
  items: Suggestion[];
}

const LIMIT = 8;
const KEY_HINT = "Filter";
const OPEN_KEYS: Record<string, { hint: string; values: (v: SearchVocab) => readonly string[] }> = {
  perk: { hint: "Perk", values: (v) => v.perks() },
  perkname: { hint: "Perk", values: (v) => v.perks() },
  exactperk: { hint: "Perk", values: (v) => v.perks() },
  origin: { hint: "Origin trait", values: (v) => v.origins() },
  origintrait: { hint: "Origin trait", values: (v) => v.origins() },
  name: { hint: "Item", values: (v) => v.names() },
  exactname: { hint: "Item", values: (v) => v.names() },
  type: { hint: "Type", values: (v) => v.types() },
};
/** Words the parser reads as operators, never completed. */
const OPERATORS = new Set(["and", "or", "not"]);

/** The term the caret sits at the end of, quote-aware, as [start, end). */
function termAt(query: string, caret: number): [number, number] | undefined {
  let start = -1;
  let quoted = false;
  for (let i = 0; i <= query.length; i++) {
    const ch = query[i];
    const breaks = i === query.length || (!quoted && (/\s/.test(ch!) || ch === "(" || ch === ")"));
    if (breaks) {
      if (start >= 0 && i === caret) return [start, i];
      start = -1;
      if (i >= caret) return undefined;
      continue;
    }
    if (start < 0) start = i;
    if (ch === '"') quoted = !quoted;
  }
  return undefined;
}

/** -1: is it, 0: starts with it, 1: a word starts with it, 2: contains it; undefined: no match. */
function rank(candidate: string, typed: string): number | undefined {
  if (!typed) return 0;
  const c = normalize(candidate);
  if (c === typed) return -1;
  if (c.startsWith(typed)) return 0;
  if (candidate.toLowerCase().split(/[\s\-–:'.]+/).some((w) => normalize(w).startsWith(typed))) return 1;
  return c.includes(typed) ? 2 : undefined;
}

/** Best matches first, keeping the list's own order within a rank. */
function matching(values: readonly string[], typed: string, worst: number): string[] {
  const ranked: { value: string; r: number; i: number }[] = [];
  values.forEach((value, i) => {
    const r = rank(value, typed);
    if (r !== undefined && r <= worst) ranked.push({ value, r, i });
  });
  return ranked.sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.value);
}

/** `kill clip` → `"kill clip"`; single words stay bare. */
const quote = (value: string) => (/^[a-z0-9-]+$/i.test(value) ? value : `"${value}"`);

/** Sorted, de-duplicated, for open-ended vocabularies. */
export function vocabList(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

/** Suggestions for the term the caret ends, or undefined when there's nothing to offer. */
export function suggestSearch(query: string, caret: number, vocab: SearchVocab): Suggestions | undefined {
  const span = termAt(query, caret);
  if (!span) return undefined;
  const [start, end] = span;
  const term = query.slice(start, end);
  const neg = term.startsWith("-") ? "-" : "";
  const body = term.slice(neg.length);
  if (!body || OPERATORS.has(body.toLowerCase())) return undefined;

  const items: Suggestion[] = [];
  const add = (text: string, hint: string) => {
    if (items.length < LIMIT && !items.some((s) => s.text === text)) items.push({ text: neg + text, hint });
  };

  const colon = body.indexOf(":");
  if (colon > 0) {
    const key = body.slice(0, colon).toLowerCase();
    const rawValue = body.slice(colon + 1).replaceAll('"', "");
    const typed = normalize(rawValue);
    const fixed = KEY_VALUES[key];
    if (fixed) {
      for (const v of matching(fixed, typed, 2)) add(`${key}:${v}`, KEY_HINT);
    } else if (OPEN_KEYS[key]) {
      if (!typed) return undefined;
      const { hint, values } = OPEN_KEYS[key];
      for (const v of matching(values(vocab), typed, 2)) add(`${key}:${quote(v)}`, hint);
    } else if (key === "stat" && !rawValue.includes(":")) {
      for (const v of matching(["total", ...vocab.stats()], typed, 1)) add(`stat:${v}:`, "Stat");
    }
  } else {
    const typed = normalize(body);
    if (!typed) return undefined;
    for (const k of matching(SEARCH_KEYS, typed, 0)) add(`${k}:`, KEY_HINT);
    for (const v of matching(IS_KEYWORDS, typed, 1)) add(`is:${v}`, KEY_HINT);
    if (typed.length >= 2) {
      for (const v of matching(vocab.types(), typed, 1)) add(`type:${quote(v)}`, "Type");
      for (const v of matching(vocab.perks(), typed, 1)) add(`perk:${quote(v)}`, "Perk");
      for (const v of matching(vocab.names(), typed, 1)) add(`name:${quote(v)}`, "Item");
    }
  }
  // Only the term already typed out in full: nothing to complete.
  if (items.length === 1 && items[0]!.text.toLowerCase() === term.toLowerCase()) return undefined;
  return items.length ? { start, end, items } : undefined;
}

/**
 * Put a suggestion in place of the term it completes. A finished term gets a space
 * after it (unless one is there); a key (`perk:`) leaves the caret right after it.
 */
export function applySuggestion(
  query: string,
  { start, end }: Pick<Suggestions, "start" | "end">,
  text: string,
): { query: string; caret: number } {
  const open = text.endsWith(":");
  const rest = query.slice(end);
  const gap = open || rest.startsWith(" ") ? "" : " ";
  const next = query.slice(0, start) + text + gap + rest;
  return { query: next, caret: start + text.length + (open ? 0 : 1) };
}
