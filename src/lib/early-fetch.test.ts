import { afterEach, describe, expect, it, vi } from "vitest";
import { EARLY_FETCH_SCRIPT, takeEarlyResponse } from "./early-fetch";

afterEach(() => vi.unstubAllGlobals());

describe("takeEarlyResponse", () => {
  it("returns undefined without a window or without a pending early request", async () => {
    expect(await takeEarlyResponse("session")).toBeUndefined();
    vi.stubGlobal("window", {});
    expect(await takeEarlyResponse("session")).toBeUndefined();
  });

  it("hands each early response out exactly once", async () => {
    const res = { ok: true } as Response;
    vi.stubGlobal("window", { __d2Early: { session: Promise.resolve(res) } });
    expect(await takeEarlyResponse("session")).toBe(res);
    expect(await takeEarlyResponse("session")).toBeUndefined();
  });

  it("maps a null profile (signed out) and a failed early request to undefined", async () => {
    vi.stubGlobal("window", {
      __d2Early: { profile: Promise.resolve(null), session: Promise.reject(new Error("net")) },
    });
    expect(await takeEarlyResponse("profile")).toBeUndefined();
    expect(await takeEarlyResponse("session")).toBeUndefined();
  });

  it("bootstrap script starts the session fetch and chains the profile fetch on it", async () => {
    const calls: string[] = [];
    const sessionBody = { authenticated: true };
    const fetch = vi.fn(async (url: string) => {
      calls.push(url);
      return { ok: true, clone: () => ({ json: async () => sessionBody }) };
    });
    const win: Record<string, unknown> = { fetch };
    new Function("window", "fetch", EARLY_FETCH_SCRIPT)(win, fetch);
    const early = win.__d2Early as { session: Promise<unknown>; profile: Promise<unknown> };
    await early.profile;
    expect(calls).toEqual(["/api/auth/session", "/api/bungie/profile"]);

    calls.length = 0;
    sessionBody.authenticated = false;
    new Function("window", "fetch", EARLY_FETCH_SCRIPT)(win, fetch);
    expect(await (win.__d2Early as { profile: Promise<unknown> }).profile).toBeNull();
    expect(calls).toEqual(["/api/auth/session"]);
  });
});
