import { beforeEach, describe, expect, test, vi } from "vitest";
import type { HttpClient } from "bungie-api-ts/http";
import { BungieHttpError } from "./http";

const transferItem = vi.fn();
const equipItems = vi.fn();
const getCharacter = vi.fn();
vi.mock("bungie-api-ts/destiny2", () => ({
  transferItem: (...args: unknown[]) => transferItem(...args),
  equipItems: (...args: unknown[]) => equipItems(...args),
  getCharacter: (...args: unknown[]) => getCharacter(...args),
  insertSocketPlugFree: vi.fn(),
}));

const { stageAndEquip } = await import("./equip-server");

const http = (() => Promise.resolve({})) as unknown as HttpClient;
const TARGET = "char-A";
const noRoom = () => new BungieHttpError(200, "Bungie POST …: DestinyNoRoomInDestination — no slots", 1642);

const helm = { itemInstanceId: "helm", itemHash: 9, location: "vault" as const };
const spares = {
  helm: [
    { itemInstanceId: "spare-1", itemHash: 1, location: "inventory" as const, characterId: TARGET },
    { itemInstanceId: "spare-2", itemHash: 1, location: "inventory" as const, characterId: TARGET },
  ],
};

beforeEach(() => {
  vi.useFakeTimers();
  transferItem.mockReset();
  equipItems.mockReset();
  getCharacter.mockReset();
  getCharacter.mockResolvedValue({ Response: { inventory: { data: { items: [] } } } });
  equipItems.mockImplementation((_http: unknown, body: { itemIds: string[] }) =>
    Promise.resolve({ Response: { equipResults: body.itemIds.map((id) => ({ itemInstanceId: id, equipStatus: 1 })) } }),
  );
});

async function run(args: Parameters<typeof stageAndEquip>[0]) {
  const p = stageAndEquip(args);
  await vi.runAllTimersAsync();
  return p;
}

const moved = () =>
  transferItem.mock.calls.map((call) => {
    const body = call[1] as { itemId: string; transferToVault: boolean };
    return [body.itemId, body.transferToVault];
  });

describe("stageAndEquip make-room", () => {
  test("vaults a spare and retries when the character's slot is full", async () => {
    transferItem
      .mockRejectedValueOnce(noRoom()) // helm → character: full
      .mockResolvedValueOnce({}) // spare-1 → vault
      .mockResolvedValueOnce({}); // helm → character
    const results = await run({ http, membershipType: 3, membershipId: "m", characterId: TARGET, items: [helm], spares, mode: "move" });
    expect(moved()).toEqual([["helm", false], ["spare-1", true], ["helm", false]]);
    expect(results).toEqual([{ itemInstanceId: "helm", ok: true, vaulted: ["spare-1"] }]);
  });

  test("keeps vaulting spares until the transfer lands, then reports every one", async () => {
    transferItem
      .mockRejectedValueOnce(noRoom())
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(noRoom())
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    const results = await run({ http, membershipType: 3, membershipId: "m", characterId: TARGET, items: [helm], spares });
    expect(moved()).toEqual([["helm", false], ["spare-1", true], ["helm", false], ["spare-2", true], ["helm", false]]);
    expect(results[0]).toEqual({ itemInstanceId: "helm", ok: true, vaulted: ["spare-1", "spare-2"] });
  });

  test("gives a friendly message when the slot is full and no spares were offered", async () => {
    transferItem.mockRejectedValueOnce(noRoom());
    const results = await run({ http, membershipType: 3, membershipId: "m", characterId: TARGET, items: [helm] });
    expect(transferItem).toHaveBeenCalledTimes(1);
    expect(results).toEqual([
      { itemInstanceId: "helm", ok: false, message: "No room on that character — free up inventory space" },
    ]);
  });

  test("a full vault stops the attempt with its own message", async () => {
    transferItem.mockRejectedValueOnce(noRoom()).mockRejectedValueOnce(noRoom());
    const results = await run({ http, membershipType: 3, membershipId: "m", characterId: TARGET, items: [helm], spares });
    expect(moved()).toEqual([["helm", false], ["spare-1", true]]);
    expect(results).toEqual([{ itemInstanceId: "helm", ok: false, message: "Vault is full — free up vault space" }]);
  });

  test("a spare Bungie won't move is skipped for the next one", async () => {
    transferItem
      .mockRejectedValueOnce(noRoom()) // helm → character: full
      .mockRejectedValueOnce(new BungieHttpError(200, "raw", 1660)) // spare-1: not transferable
      .mockResolvedValueOnce({}) // spare-2 → vault
      .mockResolvedValueOnce({}); // helm → character
    const results = await run({ http, membershipType: 3, membershipId: "m", characterId: TARGET, items: [helm], spares, mode: "move" });
    expect(moved()).toEqual([["helm", false], ["spare-1", true], ["spare-2", true], ["helm", false]]);
    expect(results).toEqual([{ itemInstanceId: "helm", ok: true, vaulted: ["spare-2"] }]);
  });

  test("spares that were vaulted are reported even when the piece still fails", async () => {
    transferItem
      .mockRejectedValueOnce(noRoom())
      .mockResolvedValueOnce({}) // spare-1 → vault
      .mockRejectedValueOnce(noRoom())
      .mockResolvedValueOnce({}) // spare-2 → vault
      .mockRejectedValueOnce(noRoom()); // still full, spares exhausted
    const results = await run({ http, membershipType: 3, membershipId: "m", characterId: TARGET, items: [helm], spares });
    expect(results).toEqual([
      {
        itemInstanceId: "helm",
        ok: false,
        message: "No room on that character — free up inventory space",
        vaulted: ["spare-1", "spare-2"],
      },
    ]);
  });

  test("other transfer errors are translated and never trigger a spare", async () => {
    transferItem.mockRejectedValueOnce(new BungieHttpError(200, "raw", 1671));
    const results = await run({ http, membershipType: 3, membershipId: "m", characterId: TARGET, items: [helm], spares });
    expect(transferItem).toHaveBeenCalledTimes(1);
    expect(results[0].message).toBe("Can't move items during an activity — go to orbit or a social space");
  });
});

describe("stageAndEquip make-room from the live inventory", () => {
  const HELMET_BUCKET = 3448274439;
  const slottedHelm = { ...helm, slot: "helmet" as const };
  const live = (id: string, extra: { bucketHash?: number; state?: number; transferStatus?: number } = {}) => ({
    itemHash: 1,
    itemInstanceId: id,
    bucketHash: HELMET_BUCKET,
    state: 0,
    transferStatus: 0,
    ...extra,
  });
  const liveInventory = (...items: ReturnType<typeof live>[]) =>
    getCharacter.mockResolvedValue({ Response: { inventory: { data: { items } } } });

  test("vaults a piece the client didn't know about when no spares were offered", async () => {
    liveInventory(live("arms", { bucketHash: 3551918588 }), live("new-drop"));
    transferItem
      .mockRejectedValueOnce(noRoom()) // helm → character: full
      .mockResolvedValueOnce({}) // new-drop → vault
      .mockResolvedValueOnce({}); // helm → character
    const results = await run({ http, membershipType: 3, membershipId: "m", characterId: TARGET, items: [slottedHelm], mode: "move" });
    expect(getCharacter.mock.calls[0][1]).toMatchObject({ destinyMembershipId: "m", characterId: TARGET, components: [201] });
    expect(moved()).toEqual([["helm", false], ["new-drop", true], ["helm", false]]);
    expect(results).toEqual([{ itemInstanceId: "helm", ok: true, vaulted: ["new-drop"] }]);
  });

  test("falls back after the client's spares, skipping ones already tried", async () => {
    liveInventory(live("spare-1"), live("spare-2"), live("new-drop"));
    transferItem
      .mockRejectedValueOnce(noRoom())
      .mockRejectedValueOnce(new BungieHttpError(200, "raw", 1623)) // spare-1: gone
      .mockRejectedValueOnce(new BungieHttpError(200, "raw", 1623)) // spare-2: gone
      .mockResolvedValueOnce({}) // new-drop → vault
      .mockResolvedValueOnce({}); // helm → character
    const results = await run({ http, membershipType: 3, membershipId: "m", characterId: TARGET, items: [slottedHelm], spares, mode: "move" });
    expect(moved()).toEqual([["helm", false], ["spare-1", true], ["spare-2", true], ["new-drop", true], ["helm", false]]);
    expect(results).toEqual([{ itemInstanceId: "helm", ok: true, vaulted: ["new-drop"] }]);
  });

  test("vaults locked pieces only when nothing unlocked is left", async () => {
    liveInventory(live("locked", { state: 1 }), live("untransferable", { transferStatus: 2 }), live("unlocked"));
    transferItem
      .mockRejectedValueOnce(noRoom())
      .mockResolvedValueOnce({}) // unlocked → vault
      .mockRejectedValueOnce(noRoom()) // still full
      .mockResolvedValueOnce({}) // locked → vault
      .mockResolvedValueOnce({}); // helm → character
    const results = await run({ http, membershipType: 3, membershipId: "m", characterId: TARGET, items: [slottedHelm], mode: "move" });
    expect(moved()).toEqual([["helm", false], ["unlocked", true], ["helm", false], ["locked", true], ["helm", false]]);
    expect(results[0]).toEqual({ itemInstanceId: "helm", ok: true, vaulted: ["unlocked", "locked"] });
  });

  test("items without a slot and full vaults never read the live inventory", async () => {
    transferItem.mockRejectedValueOnce(noRoom());
    await run({ http, membershipType: 3, membershipId: "m", characterId: TARGET, items: [helm] });
    transferItem.mockReset();
    transferItem.mockRejectedValueOnce(noRoom()).mockRejectedValueOnce(noRoom()); // spare-1 → vault: full
    const results = await run({ http, membershipType: 3, membershipId: "m", characterId: TARGET, items: [slottedHelm], spares: { helm: [spares.helm[0]] } });
    expect(getCharacter).not.toHaveBeenCalled();
    expect(results[0].message).toBe("Vault is full — free up vault space");
  });

  test("a failed live read keeps the friendly full-character message", async () => {
    getCharacter.mockRejectedValue(new BungieHttpError(500, "boom"));
    transferItem.mockRejectedValueOnce(noRoom());
    const results = await run({ http, membershipType: 3, membershipId: "m", characterId: TARGET, items: [slottedHelm] });
    expect(results).toEqual([
      { itemInstanceId: "helm", ok: false, message: "No room on that character — free up inventory space" },
    ]);
  });

  test("a failed live read isn't kept — the next slot reads again", async () => {
    const legs = { itemInstanceId: "legs", itemHash: 8, location: "vault" as const, slot: "legs" as const };
    getCharacter
      .mockRejectedValueOnce(new BungieHttpError(500, "boom"))
      .mockResolvedValueOnce({ Response: { inventory: { data: { items: [live("new-legs", { bucketHash: 20886954 })] } } } });
    transferItem
      .mockRejectedValueOnce(noRoom()) // helm → character: full, live read fails
      .mockRejectedValueOnce(noRoom()) // legs → character: full, live read succeeds
      .mockResolvedValueOnce({}) // new-legs → vault
      .mockResolvedValueOnce({}); // legs → character
    const results = await run({ http, membershipType: 3, membershipId: "m", characterId: TARGET, items: [slottedHelm, legs], mode: "move" });
    expect(getCharacter).toHaveBeenCalledTimes(2);
    expect(moved()).toEqual([["helm", false], ["legs", false], ["new-legs", true], ["legs", false]]);
    expect(results).toEqual([
      { itemInstanceId: "legs", ok: true, vaulted: ["new-legs"] },
      { itemInstanceId: "helm", ok: false, message: "No room on that character — free up inventory space" },
    ]);
  });

  test("one live read serves every slot", async () => {
    const legs = { itemInstanceId: "legs", itemHash: 8, location: "vault" as const, slot: "legs" as const };
    liveInventory(live("new-helm"), live("new-legs", { bucketHash: 20886954 }));
    transferItem
      .mockRejectedValueOnce(noRoom())
      .mockResolvedValueOnce({}) // new-helm → vault
      .mockResolvedValueOnce({}) // helm → character
      .mockRejectedValueOnce(noRoom())
      .mockResolvedValueOnce({}) // new-legs → vault
      .mockResolvedValueOnce({}); // legs → character
    const results = await run({ http, membershipType: 3, membershipId: "m", characterId: TARGET, items: [slottedHelm, legs], mode: "move" });
    expect(getCharacter).toHaveBeenCalledTimes(1);
    expect(moved()).toEqual([
      ["helm", false], ["new-helm", true], ["helm", false],
      ["legs", false], ["new-legs", true], ["legs", false],
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  test("the per-item cap spans the client's spares and the live ones", async () => {
    liveInventory(live("live-1"), live("live-2"));
    const cantMove = () => new BungieHttpError(200, "raw", 1660);
    transferItem
      .mockRejectedValueOnce(noRoom())
      .mockRejectedValueOnce(cantMove()) // spare-1
      .mockRejectedValueOnce(cantMove()) // spare-2
      .mockRejectedValueOnce(cantMove()); // live-1 — the third try; live-2 is never attempted
    const results = await run({ http, membershipType: 3, membershipId: "m", characterId: TARGET, items: [slottedHelm], spares });
    expect(moved()).toEqual([["helm", false], ["spare-1", true], ["spare-2", true], ["live-1", true]]);
    expect(results[0]).toEqual({ itemInstanceId: "helm", ok: false, message: "Couldn't make room: That item can't be transferred" });
  });
});
