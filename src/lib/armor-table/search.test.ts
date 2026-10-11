import { test, expect } from "vitest";
import {
  filterBySearch,
  looseNameMatch,
  normalizeSearchText,
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
  "Smokejumper Boots",
  "Iron Will Suit",
  // Loose subsequence hits for "no" and "plans" — the old OR search let these in.
  "Nothing Manacles",
  "Sunbracers",
  "Phoenix Cradle",
  "Plate of Transcendence",
];

test("filterBySearch keeps only names that contain every word when any do", () => {
  expect(search(VAULT, "no backup plans")).toEqual(["No Backup Plans", "No Backup Plans"]);
  expect(search(VAULT, "backup plans")).toEqual(["No Backup Plans", "No Backup Plans"]);
  expect(search(VAULT, "plans")).toEqual(["No Backup Plans", "No Backup Plans"]);
  expect(search(VAULT, "No-Backup")).toEqual(["No Backup Plans", "No Backup Plans"]);
});

test("filterBySearch falls back to subsequence for typos and partial typing", () => {
  expect(search(VAULT, "nbkp")).toEqual(["No Backup Plans", "No Backup Plans"]);
  expect(search(VAULT, "frpot")).toEqual(["Ferropotent Helm"]);
});

test("filterBySearch ORs words when no name has them all", () => {
  expect(search(VAULT, "ferro smoke")).toEqual(["Ferropotent Helm", "Smokejumper Boots"]);
  expect(search(VAULT, "ferro zzz")).toEqual(["Ferropotent Helm"]);
});

test("filterBySearch with no words keeps everything; with no hits, nothing", () => {
  expect(search(VAULT, "  ")).toEqual(VAULT);
  expect(search(VAULT, "qqqq")).toEqual([]);
});
