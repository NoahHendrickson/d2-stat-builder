import { test, expect } from "vitest";
import { formatRelativeTime } from "./relative-time";

const NOW = 1_750_000_000_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

test("under a minute reads as just now (including clock skew)", () => {
  expect(formatRelativeTime(NOW - 30_000, NOW)).toBe("just now");
  expect(formatRelativeTime(NOW + 5_000, NOW)).toBe("just now");
});

test("minutes", () => {
  expect(formatRelativeTime(NOW - 90_000, NOW)).toBe("1 minute ago");
  expect(formatRelativeTime(NOW - 5 * MINUTE, NOW)).toBe("5 minutes ago");
});

test("hours", () => {
  expect(formatRelativeTime(NOW - HOUR, NOW)).toBe("1 hour ago");
  expect(formatRelativeTime(NOW - 3 * HOUR, NOW)).toBe("3 hours ago");
});

test("days use auto phrasing", () => {
  expect(formatRelativeTime(NOW - DAY, NOW)).toBe("yesterday");
  expect(formatRelativeTime(NOW - 3 * DAY, NOW)).toBe("3 days ago");
});
