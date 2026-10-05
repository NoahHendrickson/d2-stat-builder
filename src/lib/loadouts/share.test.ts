import { test, expect } from "vitest";
import { buildShareUrl, parseShareParam, SHARE_PARAM, shareParamFromHash } from "./share";
import type { SavedLoadout } from "./types";

const saved: SavedLoadout = {
  id: "abc",
  version: 1,
  createdAt: 1,
  updatedAt: 2,
  loadout: {
    id: "x",
    name: "Shared · build",
    notes: "#pve",
    classType: 1,
    equipped: [{ id: "1", hash: 2 }],
    unequipped: [],
    parameters: { mods: [3], assumeArmorMasterwork: 3 },
  },
};

test("round-trips through a URL without owner fields", () => {
  const url = new URL(buildShareUrl("https://example.com", saved));
  expect(url.pathname).toBe("/loadouts");
  // The payload rides in the fragment, which never reaches a server.
  expect(url.search).toBe("");
  const data = parseShareParam(shareParamFromHash(url.hash))!;
  expect(data.loadout).toEqual(saved.loadout);
  expect("id" in data).toBe(false);
  expect("createdAt" in data).toBe(false);
});

test("old ?import= links still parse", () => {
  const url = new URL("https://example.com/loadouts");
  url.searchParams.set(SHARE_PARAM, JSON.stringify({ version: saved.version, loadout: saved.loadout }));
  expect(parseShareParam(url.searchParams.get(SHARE_PARAM))?.loadout).toEqual(saved.loadout);
  expect(shareParamFromHash("")).toBeNull();
  expect(shareParamFromHash("#other=1")).toBeNull();
});

test("rejects garbage", () => {
  expect(parseShareParam(null)).toBeNull();
  expect(parseShareParam("{not json")).toBeNull();
  expect(parseShareParam(JSON.stringify({ version: 1 }))).toBeNull();
});
