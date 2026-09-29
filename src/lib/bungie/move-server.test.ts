import { beforeEach, expect, test, vi } from "vitest";
import type { HttpClient } from "bungie-api-ts/http";
import { BungieHttpError } from "./http";
import type { MoveRequest } from "./move-plan";

const transferItem = vi.fn();
const equipItem = vi.fn();
const pullFromPostmaster = vi.fn();
vi.mock("bungie-api-ts/destiny2", () => ({
  transferItem: (...args: unknown[]) => transferItem(...args),
  equipItem: (...args: unknown[]) => equipItem(...args),
  pullFromPostmaster: (...args: unknown[]) => pullFromPostmaster(...args),
  equipItems: vi.fn(),
  getCharacter: vi.fn(),
  insertSocketPlugFree: vi.fn(),
}));

const { runMove } = await import("./move-server");

const http = (() => Promise.resolve({})) as unknown as HttpClient;
const bungieError = (code: number, throttleSeconds?: number) =>
  new BungieHttpError(200, `Bungie error ${code}`, code, undefined, undefined, throttleSeconds);

const acrossCharacters: MoveRequest = {
  itemId: "123",
  itemHash: 7,
  stackSize: 1,
  from: { kind: "character", characterId: "1" },
  to: { kind: "character", characterId: "2", equip: true },
};

beforeEach(() => {
  vi.useFakeTimers();
  for (const fn of [transferItem, equipItem, pullFromPostmaster]) {
    fn.mockReset();
    fn.mockResolvedValue({ Response: 0 });
  }
});

async function run(request: MoveRequest) {
  const p = runMove({ http, membershipType: 3, request });
  await vi.runAllTimersAsync();
  return p;
}

test("a full move reports where the item landed", async () => {
  const result = await run(acrossCharacters);
  expect(result).toEqual({ ok: true, landed: { kind: "character", characterId: "2", equipped: true } });
  expect(transferItem.mock.calls.map((c) => c[1].transferToVault)).toEqual([true, false]);
  expect(equipItem).toHaveBeenCalledOnce();
});

test("a failure partway through says where the item was left", async () => {
  transferItem
    .mockResolvedValueOnce({ Response: 0 })
    .mockRejectedValueOnce(bungieError(1642)); // target character full
  const result = await run(acrossCharacters);
  expect(result).toEqual({
    ok: false,
    error: "No room on that character — free up inventory space",
    landed: { kind: "vault" },
  });
  expect(equipItem).not.toHaveBeenCalled();
});

test("a throttled call waits and retries", async () => {
  transferItem.mockRejectedValueOnce(bungieError(1672, 1));
  const result = await run({ ...acrossCharacters, to: { kind: "vault" } });
  expect(result.ok).toBe(true);
  expect(transferItem).toHaveBeenCalledTimes(2);
});

test("persistent throttling gives up with a clear message", async () => {
  transferItem.mockRejectedValue(bungieError(37, 1));
  const result = await run({ ...acrossCharacters, to: { kind: "vault" } });
  expect(result).toMatchObject({ ok: false, landed: null });
  expect(transferItem).toHaveBeenCalledTimes(3);
});

test("a 401 is re-thrown for the route to clear the session", async () => {
  transferItem.mockRejectedValue(new BungieHttpError(401, "unauthorized"));
  const p = runMove({ http, membershipType: 3, request: { ...acrossCharacters, to: { kind: "vault" } } });
  const settled = p.catch((err: unknown) => err);
  await vi.runAllTimersAsync();
  expect(await settled).toBeInstanceOf(BungieHttpError);
});

test("equipped items are refused without calling Bungie", async () => {
  const result = await run({
    ...acrossCharacters,
    from: { kind: "character", characterId: "1", equipped: true },
  });
  expect(result).toMatchObject({ ok: false, landed: null });
  expect(transferItem).not.toHaveBeenCalled();
});
