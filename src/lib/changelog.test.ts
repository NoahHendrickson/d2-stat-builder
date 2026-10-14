import { expect, test } from "vitest";
import { CHANGELOG } from "./changelog";

test("changelog entries are dated YYYY-MM-DD, one per day, newest first, never empty", () => {
  const dates = CHANGELOG.map((e) => e.date);
  for (const d of dates) expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(new Set(dates).size).toBe(dates.length);
  expect([...dates].sort().reverse()).toEqual(dates);
  for (const e of CHANGELOG) expect(e.changes.length).toBeGreaterThan(0);
});
