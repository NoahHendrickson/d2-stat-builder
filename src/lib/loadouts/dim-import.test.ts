import { afterEach, describe, expect, test, vi } from "vitest";
import { ARMOR_BUCKETS } from "../armory/stats";
import type { Manifest } from "../manifest/load";
import {
  DimImportError,
  parseDimLink,
  resolveDimLink as resolveLink,
  savedDataFromDimLoadout as fromDim,
} from "./dim-import";

const GHOST = 777;
const ARMOR_BUCKET = Number(Object.keys(ARMOR_BUCKETS)[0]);
const manifest = {
  def: (_table: string, hash: number) =>
    hash === GHOST ? { inventory: { bucketTypeHash: 4023194814 } } : { inventory: { bucketTypeHash: ARMOR_BUCKET } },
} as unknown as Manifest;
const savedDataFromDimLoadout = (raw: unknown) => fromDim(raw, manifest);
const resolveDimLink = (text: string) => resolveLink(text, manifest);

const inlineLink = (loadout: unknown, base = "https://app.destinyitemmanager.com/loadouts") =>
  `${base}?loadout=${encodeURIComponent(JSON.stringify(loadout))}`;

describe("parseDimLink", () => {
  test("reads a short link, with or without the scheme or a name", () => {
    expect(parseDimLink("https://dim.gg/abc2345/My-Build")).toEqual({ kind: "share", id: "abc2345" });
    expect(parseDimLink("  dim.gg/ABC2345 ")).toEqual({ kind: "share", id: "abc2345" });
  });

  test("reads DIM's own link, on any of its hosts and account paths", () => {
    const loadout = { name: "A" };
    expect(parseDimLink(inlineLink(loadout))).toEqual({ kind: "inline", loadout });
    expect(
      parseDimLink(inlineLink(loadout, "https://beta.destinyitemmanager.com/4611686018/d2/loadouts")),
    ).toEqual({ kind: "inline", loadout });
  });

  test("refuses anything else", () => {
    for (const text of [
      "",
      "not a link",
      "https://example.com/abc2345",
      "https://notdestinyitemmanager.com/loadouts?loadout=%7B%7D",
      "https://dim.gg/",
      "https://dim.gg/a/b",
      "https://app.destinyitemmanager.com/inventory?loadout=%7B%7D",
      "https://app.destinyitemmanager.com/loadouts?loadout=%7Bbroken",
    ]) {
      expect(parseDimLink(text)).toBeNull();
    }
  });
});

describe("savedDataFromDimLoadout", () => {
  test("fills in what DIM can leave out", () => {
    const data = savedDataFromDimLoadout({ name: "Raid", equipped: [{ hash: 5, id: "9" }] })!;
    expect(data.loadout).toMatchObject({
      name: "Raid",
      classType: 3,
      equipped: [{ hash: 5, id: "9" }],
      unequipped: [],
      parameters: { mods: [], assumeArmorMasterwork: 3 },
    });
  });

  test("keeps subclass overrides and build parameters, and drops what isn't used", () => {
    const data = savedDataFromDimLoadout({
      name: "Raid",
      classType: 1,
      notes: "hi",
      createdAt: 1,
      equipped: [{ hash: 5, id: "0", amount: 1, socketOverrides: { 0: 11, 1: "x" } }],
      unequipped: [{ hash: 7 }],
      parameters: {
        mods: [1, "x", 2],
        exoticArmorHash: 44,
        assumeArmorMasterwork: 1,
        modsByBucket: { 1: [2] },
        statConstraints: [{ statHash: 3, minTier: 5 }, { statHash: 4, minStat: 70 }, { statHash: 6, ignored: true }],
        setBonuses: { 8: 2, 9: 3 },
        artifactUnlocks: { unlockedItemHashes: [1, 2], seasonNumber: 28 },
      },
    })!;
    expect(data.loadout).toMatchObject({
      classType: 1,
      notes: "hi",
      equipped: [{ hash: 5, socketOverrides: { 0: 11 } }],
      unequipped: [],
      parameters: {
        mods: [1, 2],
        exoticArmorHash: 44,
        assumeArmorMasterwork: 1,
        statConstraints: [{ statHash: 3, minStat: 50 }, { statHash: 4, minStat: 70 }],
        setBonuses: { 8: 2 },
        artifactUnlocks: { unlockedItemHashes: [1, 2], seasonNumber: 28 },
      },
    });
    expect(data.loadout.equipped[0].id).toBeUndefined();
  });

  test("a loadout longer than this app holds is cut down, not refused", () => {
    const data = savedDataFromDimLoadout({
      name: "x".repeat(300),
      equipped: Array.from({ length: 30 }, (_, hash) => ({ hash })),
      parameters: { mods: Array.from({ length: 90 }, (_, i) => i) },
    })!;
    expect(data.loadout.equipped).toHaveLength(12);
    expect(data.loadout.parameters.mods).toHaveLength(40);
    expect(data.loadout.name).toHaveLength(120);
  });

  test("an unnamed loadout gets a name, and an empty one is refused", () => {
    expect(savedDataFromDimLoadout({ equipped: [{ hash: 5 }] })!.loadout.name).toBe("DIM loadout");
    expect(savedDataFromDimLoadout({ name: "Empty", equipped: [] })).toBeNull();
    expect(savedDataFromDimLoadout("junk")).toBeNull();
  });
});

test("leaves out gear that isn't part of a build, before the item limit", () => {
  const armor = Array.from({ length: 12 }, (_, i) => ({ hash: i + 1 }));
  const data = savedDataFromDimLoadout({ name: "Raid", equipped: [{ hash: GHOST }, ...armor] })!;
  expect(data.loadout.equipped.map((ref) => ref.hash)).toEqual(armor.map((ref) => ref.hash));
});

describe("resolveDimLink", () => {
  afterEach(() => vi.unstubAllGlobals());
  const answer = (response: Response) => {
    const mock = vi.fn(async (_url: string) => response);
    vi.stubGlobal("fetch", mock);
    return mock;
  };

  test("asks the server about a short link", async () => {
    const mock = answer(Response.json({ loadout: { name: "Raid", equipped: [{ hash: 5 }] } }));
    const data = await resolveDimLink("https://dim.gg/abc2345/raid");
    expect(mock.mock.calls[0][0]).toBe("/api/dim-share/abc2345");
    expect(data.loadout.name).toBe("Raid");
  });

  test("reads a full link without any request", async () => {
    const mock = answer(Response.json({}));
    await resolveDimLink(inlineLink({ name: "Raid", equipped: [{ hash: 5 }] }));
    expect(mock).not.toHaveBeenCalled();
  });

  test.each([
    ["not a link", new Response(null, { status: 200 }), /doesn't look like/],
    ["dim.gg/abc2345", new Response(null, { status: 404 }), /doesn't exist/],
    ["dim.gg/abc2345", new Response(null, { status: 502 }), /Couldn't reach/],
    ["dim.gg/abc2345", Response.json({ loadout: {} }), /can't be read/],
  ])("says why %s failed", async (text, response, message) => {
    answer(response);
    const failure = await resolveDimLink(text).catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(DimImportError);
    expect((failure as Error).message).toMatch(message);
  });
});
