import { test, expect } from "vitest";
import {
  filterBySearch,
  looseNameMatch,
  normalizeSearchText,
  searchMatcher,
  tokenizeSearchQuery,
} from "./search";

const search = (names: string[], query: string) =>
  filterBySearch(names, normalizeSearchText, tokenizeSearchQuery(query));

test("tokenizeSearchQuery splits on whitespace and normalizes tokens", () => {
  expect(tokenizeSearchQuery("  Ferro   Smoke ")).toEqual(["ferro", "smoke"]);
  expect(tokenizeSearchQuery("Smoke-Jumper")).toEqual(["smokejumper"]);
  // Punctuation-only tokens vanish instead of matching everything.
  expect(tokenizeSearchQuery("-- ferro")).toEqual(["ferro"]);
  expect(tokenizeSearchQuery("")).toEqual([]);
});

test("looseNameMatch matches substrings ignoring case and punctuation", () => {
  expect(looseNameMatch("ferro", "Ferropotent Helm")).toBe(true);
  expect(looseNameMatch("smokejumper", "Smoke-Jumper Boots")).toBe(true);
});

test("looseNameMatch matches ordered subsequence for partial typing", () => {
  expect(looseNameMatch("frpot", "Ferropotent")).toBe(true);
  expect(looseNameMatch("ferro", "Smokejumper")).toBe(false);
});

const VAULT = [
  "No Backup Plans",
  "No Backup Plans",
  "Ferropotent Helm",
  "Smoke Jumper Boots",
  "Aeon Safe",
  "Mask of the Quiet One",
  // "no" spans a word gap here ("crow-n o-f") or sits inside a word.
  "Crown of Tempests",
  "Wishful Ignorance",
  "Nothing Manacles",
  // Loose subsequence hits for "plans" — the old OR search let these in.
  "Plate of Transcendence",
  "Sunbracers",
];
const NBP = ["No Backup Plans", "No Backup Plans"];

test("filterBySearch keeps only names that contain every word when any do", () => {
  expect(search(VAULT, "no backup plans")).toEqual(NBP);
  expect(search(VAULT, "backup plans")).toEqual(NBP);
  expect(search(VAULT, "plans")).toEqual(NBP);
  expect(search(VAULT, "No-Backup")).toEqual(NBP);
});

test("filterBySearch survives a typo in one word of several", () => {
  expect(search(VAULT, "no bakcup plans")).toEqual(NBP);
  expect(search(VAULT, "no backup plnas")).toEqual(NBP);
  expect(search(VAULT, "no backup plansx")).toEqual(NBP);
});

test("filterBySearch only loosely matches words no name contains", () => {
  expect(search(VAULT, "nbkp")).toEqual(NBP);
  expect(search(VAULT, "frpot")).toEqual(["Ferropotent Helm"]);
  // "aeon" is spelled right, so it doesn't loosely match "Mask of the Quiet One".
  expect(search(VAULT, "aeon sfe")).toEqual(["Aeon Safe"]);
});

test("filterBySearch ORs words when no name has them all", () => {
  expect(search(VAULT, "ferro smoke")).toEqual(["Ferropotent Helm", "Smoke Jumper Boots"]);
  expect(search(VAULT, "ferro smokjmpr")).toEqual(["Ferropotent Helm", "Smoke Jumper Boots"]);
  expect(search(VAULT, "ferro zzz")).toEqual(["Ferropotent Helm"]);
});

test("filterBySearch with no words keeps everything; with no hits, nothing", () => {
  expect(search(VAULT, "  ")).toEqual(VAULT);
  expect(search(VAULT, "-")).toEqual(VAULT);
  expect(search(VAULT, "qqqq")).toEqual([]);
});

test("searchMatcher scoped to the whole list lets other filters only narrow", () => {
  const matches = searchMatcher(VAULT, normalizeSearchText, tokenizeSearchQuery("no backup plans"));
  // Another filter already dropped No Backup Plans: nothing left matches.
  expect(VAULT.filter((n) => !n.startsWith("No Backup") && matches(n))).toEqual([]);
  expect(VAULT.filter(matches)).toEqual(NBP);
});
