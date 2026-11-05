import { expect, test } from "vitest";
import { browserPredates, stampFirstSeen } from "./browser-since";
import { memoryStorage } from "./test/memory-storage";

test("a new browser is stamped with its first day, once", () => {
  const storage = memoryStorage();
  stampFirstSeen(storage, "2026-11-05");
  expect(browserPredates("2026-11-05", storage)).toBe(false);
  expect(browserPredates("2026-11-06", storage)).toBe(true);
  // Keys saved later, or later visits, don't move the stamp.
  storage.setItem("stat-builder:selections", "{}");
  stampFirstSeen(storage, "2026-12-01");
  expect(browserPredates("2026-11-05", storage)).toBe(false);
});

test("a browser with the app's keys from before stamps predates every date", () => {
  const storage = memoryStorage({ "stat-builder:changelog-seen": "x" });
  stampFirstSeen(storage, "2026-11-05");
  expect(browserPredates("2000-01-01", storage)).toBe(true);
  // Other keys on the origin don't count as the app's.
  const other = memoryStorage({ theme: "dark" });
  stampFirstSeen(other, "2026-11-05");
  expect(browserPredates("2026-11-05", other)).toBe(false);
});

test("a browser that can't be placed counts as returning", () => {
  expect(browserPredates("2026-11-05", memoryStorage())).toBe(true);
  expect(browserPredates("2026-11-05", memoryStorage({ "stat-builder:first-seen": "junk" }))).toBe(true);
  const blocked = {
    ...memoryStorage(),
    getItem: () => {
      throw new Error("blocked");
    },
  } as Storage;
  expect(browserPredates("2026-11-05", blocked)).toBe(true);
});
