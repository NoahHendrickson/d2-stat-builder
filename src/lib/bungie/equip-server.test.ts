import { beforeEach, describe, expect, test, vi } from "vitest";
import type { HttpClient } from "bungie-api-ts/http";
import { BungieHttpError } from "./http";

const transferItem = vi.fn();
const equipItems = vi.fn();
vi.mock("bungie-api-ts/destiny2", () => ({
  transferItem: (...args: unknown[]) => transferItem(...args),
  equipItems: (...args: unknown[]) => equipItems(...args),
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
    const results = await run({ http, membershipType: 3, characterId: TARGET, items: [helm], spares, mode: "move" });
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
    const results = await run({ http, membershipType: 3, characterId: TARGET, items: [helm], spares });
    expect(moved()).toEqual([["helm", false], ["spare-1", true], ["helm", false], ["spare-2", true], ["helm", false]]);
    expect(results[0]).toEqual({ itemInstanceId: "helm", ok: true, vaulted: ["spare-1", "spare-2"] });
  });

  test("gives a friendly message when the slot is full and no spares were offered", async () => {
    transferItem.mockRejectedValueOnce(noRoom());
    const results = await run({ http, membershipType: 3, characterId: TARGET, items: [helm] });
    expect(transferItem).toHaveBeenCalledTimes(1);
    expect(results).toEqual([
      { itemInstanceId: "helm", ok: false, message: "No room on that character — free up inventory space" },
    ]);
  });

  test("a full vault stops the attempt with its own message", async () => {
    transferItem.mockRejectedValueOnce(noRoom()).mockRejectedValueOnce(noRoom());
    const results = await run({ http, membershipType: 3, characterId: TARGET, items: [helm], spares });
    expect(moved()).toEqual([["helm", false], ["spare-1", true]]);
    expect(results).toEqual([{ itemInstanceId: "helm", ok: false, message: "Vault is full — free up vault space" }]);
  });

  test("other transfer errors are translated and never trigger a spare", async () => {
    transferItem.mockRejectedValueOnce(new BungieHttpError(200, "raw", 1671));
    const results = await run({ http, membershipType: 3, characterId: TARGET, items: [helm], spares });
    expect(transferItem).toHaveBeenCalledTimes(1);
    expect(results[0].message).toBe("Can't move items during an activity — go to orbit or a social space");
  });
});
