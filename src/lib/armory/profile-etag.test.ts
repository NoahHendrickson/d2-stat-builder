import { describe, expect, it } from "vitest";
import { etagMatches, profileEtag } from "./profile-etag";

describe("profileEtag", () => {
  it("joins both minted timestamps", () => {
    expect(
      profileEtag({
        responseMintedTimestamp: "2026-10-02T15:00:10Z",
        secondaryComponentsMintedTimestamp: "2026-10-02T15:00:12Z",
      }),
    ).toBe('"2026-10-02T15:00:10Z|2026-10-02T15:00:12Z"');
  });

  it("has no tag when either stamp is missing", () => {
    expect(profileEtag(undefined)).toBeUndefined();
    expect(profileEtag({})).toBeUndefined();
    expect(profileEtag({ responseMintedTimestamp: "2026-10-02T15:00:10Z" })).toBeUndefined();
  });
});

describe("etagMatches", () => {
  const etag = '"a|b"';

  it("matches the exact tag, in a list, and as a weak validator", () => {
    expect(etagMatches('"a|b"', etag)).toBe(true);
    expect(etagMatches('"x|y", "a|b"', etag)).toBe(true);
    expect(etagMatches('W/"a|b"', etag)).toBe(true);
    expect(etagMatches("*", etag)).toBe(true);
  });

  it("does not match other tags or no header", () => {
    expect(etagMatches(null, etag)).toBe(false);
    expect(etagMatches("", etag)).toBe(false);
    expect(etagMatches('"a|c"', etag)).toBe(false);
  });
});
