import { describe, expect, it } from "vitest";
import type { HttpClient } from "bungie-api-ts/http";
import { resolveDestinyAccount } from "./destiny-account";

function linked(profiles: object[]): HttpClient {
  return (async () => ({ ErrorCode: 1, Response: { profiles, profilesWithErrors: [] } })) as HttpClient;
}

const card = (membershipId: string, membershipType: number, extra: object = {}) => ({
  membershipId,
  membershipType,
  dateLastPlayed: "2020-01-01T00:00:00Z",
  isOverridden: false,
  isCrossSavePrimary: false,
  ...extra,
});

describe("resolveDestinyAccount", () => {
  it("takes the cross-save primary", async () => {
    const http = linked([
      card("1", 2, { isOverridden: true, dateLastPlayed: "2026-10-01T00:00:00Z" }),
      card("3", 3, { isCrossSavePrimary: true }),
    ]);
    expect(await resolveDestinyAccount(http, "bnet")).toEqual({
      membershipId: "3",
      membershipType: 3,
    });
  });

  it("without cross save, takes the most recently played profile", async () => {
    const http = linked([
      card("1", 1, { dateLastPlayed: "2019-05-01T00:00:00Z" }),
      card("3", 3, { dateLastPlayed: "2026-10-01T00:00:00Z" }),
    ]);
    expect((await resolveDestinyAccount(http, "bnet"))?.membershipId).toBe("3");
  });

  it("is undefined when there's no D2 profile", async () => {
    expect(await resolveDestinyAccount(linked([]), "bnet")).toBeUndefined();
  });
});
