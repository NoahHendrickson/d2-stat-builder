import { test, expect } from "vitest";
import {
  buildShareUrl,
  isShareCode,
  SHARE_PARAM,
  shareableData,
  shareSourceFrom,
  shortShareUrl,
} from "./share";
import { shareCodeFor } from "./share-code";
import type { SavedLoadout } from "./types";

const none = new URLSearchParams();

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
  const source = shareSourceFrom(url.hash, none);
  expect(source?.kind).toBe("inline");
  const data = source?.kind === "inline" ? source.data : null;
  expect(data?.loadout).toEqual(saved.loadout);
  expect(data && "id" in data).toBe(false);
  expect(data && "createdAt" in data).toBe(false);
});

test("old ?import= links still parse", () => {
  const search = new URLSearchParams({ [SHARE_PARAM]: JSON.stringify({ version: saved.version, loadout: saved.loadout }) });
  const source = shareSourceFrom("", search);
  expect(source?.kind === "inline" && source.data.loadout).toEqual(saved.loadout);
  expect(shareSourceFrom("", none)).toBeNull();
  expect(shareSourceFrom("#other=1", none)).toBeNull();
});

test("rejects garbage", () => {
  const at = (json: string) => shareSourceFrom(`#${new URLSearchParams({ [SHARE_PARAM]: json })}`, none);
  expect(at("{not json")).toBeNull();
  expect(at(JSON.stringify({ version: 1 }))).toBeNull();
});

test("short links carry a 10-character code in the fragment", () => {
  const url = new URL(shortShareUrl("https://example.com", "Ab3xY9qZ0k"));
  expect(url.toString()).toBe("https://example.com/loadouts#s=Ab3xY9qZ0k");
  expect(shareSourceFrom(url.hash, none)).toEqual({ kind: "code", key: "s=Ab3xY9qZ0k", code: "Ab3xY9qZ0k" });
  expect(shareSourceFrom("#s=short", none)).toBeNull();
  expect(shareSourceFrom("#s=Ab3xY9qZ0k%2F", none)).toBeNull();
});

test("a short code wins over an inline loadout, and the fragment over the query", () => {
  const inline = JSON.stringify(shareableData(saved));
  const older = new URLSearchParams({ [SHARE_PARAM]: JSON.stringify(shareableData({ ...saved, loadout: { ...saved.loadout, name: "Older" } })) });
  expect(shareSourceFrom(`#s=Ab3xY9qZ0k&${new URLSearchParams({ [SHARE_PARAM]: inline })}`, older)?.kind).toBe("code");
  const source = shareSourceFrom(`#${new URLSearchParams({ [SHARE_PARAM]: inline })}`, older);
  expect(source?.kind === "inline" && source.data.loadout.name).toBe(saved.loadout.name);
});

test("share codes are stable per loadout and differ between loadouts", () => {
  const json = JSON.stringify(shareableData(saved));
  const code = shareCodeFor(json);
  expect(isShareCode(code)).toBe(true);
  expect(shareCodeFor(json)).toBe(code);
  const renamed = { ...saved, loadout: { ...saved.loadout, name: "Other" } };
  expect(shareCodeFor(JSON.stringify(shareableData(renamed)))).not.toBe(code);
});

test("shares drop the owner's mod placement", () => {
  const data = shareableData({ ...saved, modPlacement: { "1": { 0: 5 } } });
  expect("modPlacement" in data).toBe(false);
});
