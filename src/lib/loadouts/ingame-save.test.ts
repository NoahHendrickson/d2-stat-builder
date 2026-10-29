import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { InGameLoadoutsResponse } from "@/lib/bungie/ingame-loadouts";
import { clearInGameSlots, inGameLoadoutsKey } from "./ingame-save";

const signOut = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/auth/sign-out", () => ({ handleSessionExpired: signOut }));

const filled = (index: number) => ({
  index,
  nameHash: 1,
  iconHash: 1,
  colorHash: 1,
  items: [{ itemInstanceId: "6917529" }],
  empty: false,
});
const slots: InGameLoadoutsResponse = {
  slots: [filled(0), filled(1), filled(2)],
  identifiers: { names: [], icons: [], colors: [] },
};

/** Answers each DELETE in turn with the given status (200 = cleared). */
function bungie(...statuses: number[]) {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => {
    const status = statuses.shift() ?? 200;
    return status === 200
      ? Response.json({ ok: true })
      : Response.json(
          { error: status === 401 ? "Not signed in" : "Throttled", reauth: status === 401 },
          { status },
        );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("clearInGameSlots", () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    vi.useFakeTimers();
    queryClient = new QueryClient();
    queryClient.setQueryData(inGameLoadoutsKey("c1"), slots);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    signOut.mockClear();
  });

  const run = async (indexes: number[]) => {
    const onProgress = vi.fn();
    const pending = clearInGameSlots({ characterId: "c1", indexes, queryClient, onProgress });
    await vi.runAllTimersAsync();
    return { result: await pending, onProgress };
  };
  const emptied = () =>
    queryClient
      .getQueryData<InGameLoadoutsResponse>(inGameLoadoutsKey("c1"))!
      .slots.filter((s) => s.empty)
      .map((s) => s.index);

  test("clears each slot in order and marks it empty in the shared query", async () => {
    const fetchMock = bungie(200, 200);
    const { result, onProgress } = await run([0, 2]);
    expect(result).toEqual({ cleared: 2, failure: undefined });
    expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
      { characterId: "c1", loadoutIndex: 0 },
      { characterId: "c1", loadoutIndex: 2 },
    ]);
    expect(onProgress.mock.calls).toEqual([[1], [2]]);
    expect(emptied()).toEqual([0, 2]);
  });

  test("stops at the first failure and leaves the rest untried", async () => {
    const fetchMock = bungie(200, 502);
    const { result } = await run([0, 1, 2]);
    expect(result).toEqual({ cleared: 1, failure: { index: 1, error: "Throttled", reauth: false } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(emptied()).toEqual([0]);
    expect(signOut).not.toHaveBeenCalled();
  });

  test("a dead session signs out", async () => {
    bungie(401);
    const { result } = await run([0, 1]);
    expect(result.failure).toEqual({ index: 0, error: "Not signed in", reauth: true });
    expect(signOut).toHaveBeenCalledWith(queryClient);
  });
});
