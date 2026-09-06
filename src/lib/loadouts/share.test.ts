import { test, expect } from "vitest";
import { buildShareUrl, parseShareParam, SHARE_PARAM } from "./share";
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
  expect(url.pathname).toBe("/");
  const data = parseShareParam(url.searchParams.get(SHARE_PARAM))!;
  expect(data.loadout).toEqual(saved.loadout);
  expect("id" in data).toBe(false);
  expect("createdAt" in data).toBe(false);
});

test("rejects garbage", () => {
  expect(parseShareParam(null)).toBeNull();
  expect(parseShareParam("{not json")).toBeNull();
  expect(parseShareParam(JSON.stringify({ version: 1 }))).toBeNull();
});
