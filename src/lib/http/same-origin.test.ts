import { describe, expect, it } from "vitest";
import { isSameOrigin } from "./same-origin";

const req = (headers: Record<string, string>) =>
  new Request("https://canary.noahjh.com/api/loadouts", { method: "POST", headers });

describe("isSameOrigin", () => {
  it("trusts Sec-Fetch-Site when the browser sends it", () => {
    expect(isSameOrigin(req({ "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(isSameOrigin(req({ "sec-fetch-site": "same-site" }))).toBe(false);
    expect(isSameOrigin(req({ "sec-fetch-site": "cross-site" }))).toBe(false);
  });

  it("falls back to Origin against Host", () => {
    expect(isSameOrigin(req({ origin: "https://canary.noahjh.com", host: "canary.noahjh.com" }))).toBe(true);
    expect(isSameOrigin(req({ origin: "https://evil.noahjh.com", host: "canary.noahjh.com" }))).toBe(false);
    expect(isSameOrigin(req({ origin: "null", host: "canary.noahjh.com" }))).toBe(false);
  });

  it("lets requests with neither header through", () => {
    expect(isSameOrigin(req({}))).toBe(true);
  });
});
