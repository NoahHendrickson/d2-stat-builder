import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

const clearArmoryCache = vi.fn(async () => {});
vi.mock("@/lib/armory/armory-cache", () => ({ clearArmoryCache: () => clearArmoryCache() }));
const { forgetLocalSession, handleSessionExpired, signOut, signOutForReauth } = await import("./sign-out");

const seeded = () => {
  const qc = new QueryClient();
  qc.setQueryData(["session"], { authenticated: true, user: { membershipId: "me" } });
  qc.setQueryData(["profile", "me"], { characters: {} });
  qc.setQueryData(["armory", "me", "v1", 5], { pieces: [], characters: [] });
  qc.setQueryData(["armory-cache", "me"], null);
  qc.setQueryData(["loadouts"], []);
  return qc;
};
const playerKeys = (qc: QueryClient) =>
  qc.getQueryCache().getAll().map((q) => q.queryKey[0]).filter((k) => k !== "session" && k !== "loadouts");

afterEach(() => {
  vi.unstubAllGlobals();
  clearArmoryCache.mockClear();
});

describe("ending a session", () => {
  it("forgetLocalSession drops the persisted armory and every player query, nothing else", async () => {
    const qc = seeded();
    await forgetLocalSession(qc);
    expect(clearArmoryCache).toHaveBeenCalledTimes(1);
    expect(playerKeys(qc)).toEqual([]);
    expect(qc.getQueryData(["session"])).toBeDefined();
    expect(qc.getQueryData(["loadouts"])).toEqual([]);
  });

  it("signOut only forgets local data once the server accepted the logout", async () => {
    const qc = seeded();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
    expect(await signOut(qc)).toBe(false);
    expect(clearArmoryCache).not.toHaveBeenCalled();
    expect(playerKeys(qc).length).toBeGreaterThan(0);

    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true })));
    expect(await signOut(qc)).toBe(true);
    expect(clearArmoryCache).toHaveBeenCalledTimes(1);
    expect(playerKeys(qc)).toEqual([]);
  });

  it("an expired session and a reauth error both forget local data and refresh the session query", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url);
      return { ok: true };
    }));
    for (const end of [handleSessionExpired, signOutForReauth]) {
      const qc = seeded();
      const invalidate = vi.spyOn(qc, "invalidateQueries");
      await end(qc);
      expect(playerKeys(qc)).toEqual([]);
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["session"] });
    }
    // Only the reauth path also ends the server session.
    expect(calls).toEqual(["/api/auth/logout"]);
    expect(clearArmoryCache).toHaveBeenCalledTimes(2);
  });
});
