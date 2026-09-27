import { describe, expect, test } from "vitest";

import { isRetryableBungieHttpStatus } from "./manifest";

describe("isRetryableBungieHttpStatus", () => {
  test("retries transient Bungie/CDN failures", () => {
    expect(isRetryableBungieHttpStatus(429)).toBe(true);
    expect(isRetryableBungieHttpStatus(502)).toBe(true);
    expect(isRetryableBungieHttpStatus(503)).toBe(true);
    expect(isRetryableBungieHttpStatus(504)).toBe(true);
  });

  test("does not retry permanent client errors", () => {
    expect(isRetryableBungieHttpStatus(401)).toBe(false);
    expect(isRetryableBungieHttpStatus(404)).toBe(false);
  });
});
