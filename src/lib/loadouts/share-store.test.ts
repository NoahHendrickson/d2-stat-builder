// The share store's SQL, run against real Postgres (PGlite, in-process).
import { beforeEach, expect, test } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { MAX_SHARES_PER_DAY, NeonShareStore, ShareLimitError, type Sql } from "./share-store";
import { shareableData } from "./share";
import { shareCodeFor } from "./share-code";
import type { SavedLoadoutData } from "./types";

let db: PGlite;
let store: NeonShareStore;
const sql: Sql = async (strings, ...values) => {
  const text = strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ""), "");
  return (await db.query<Record<string, unknown>>(text, values)).rows;
};

beforeEach(() => {
  db = new PGlite();
  store = new NeonShareStore(sql);
});

const loadout = (name: string): SavedLoadoutData => ({
  version: 1,
  loadout: {
    id: "x",
    name,
    classType: 1,
    equipped: [{ id: "1", hash: 2 }],
    unequipped: [],
    parameters: { mods: [3], assumeArmorMasterwork: 3 },
  },
  modPlacement: { "1": { 0: 5 } },
});
const rowCount = async () => (await sql`SELECT count(*)::int AS n FROM loadout_shares`)[0].n;

test("stores a snapshot without owner fields and reads it back", async () => {
  const code = await store.create("me", loadout("A"));
  expect(code).toMatch(/^[0-9A-Za-z]{10}$/);
  const got = await store.get(code);
  expect(got?.loadout.name).toBe("A");
  expect(got && "modPlacement" in got).toBe(false);
  expect(await store.get("Zzzzzzzzzz")).toBeNull();
});

test("sharing the same loadout again, from any account, reuses its row", async () => {
  const code = await store.create("me", loadout("A"));
  expect(await store.create("me", loadout("A"))).toBe(code);
  expect(await store.create("someone-else", loadout("A"))).toBe(code);
  expect(await store.create("me", loadout("B"))).not.toBe(code);
  expect(await rowCount()).toBe(2);
});

test("a code already holding a different loadout is refused", async () => {
  const code = shareCodeFor(JSON.stringify(shareableData(loadout("A"))));
  await store.get(code); // creates the table
  await sql`INSERT INTO loadout_shares (code, membership_id, data)
    VALUES (${code}, ${"other"}, ${JSON.stringify(shareableData(loadout("Z")))}::jsonb)`;
  await expect(store.create("me", loadout("A"))).rejects.toThrow("collision");
});

test("the daily limit stops new shares but not repeats, and lifts after a day", async () => {
  for (let i = 0; i < MAX_SHARES_PER_DAY; i++) await store.create("capped", loadout(`L${i}`));
  await expect(store.create("capped", loadout("over"))).rejects.toBeInstanceOf(ShareLimitError);
  expect(await store.create("capped", loadout("L5"))).toMatch(/^[0-9A-Za-z]{10}$/);
  expect(await store.create("someone-else", loadout("theirs"))).toMatch(/^[0-9A-Za-z]{10}$/);
  await sql`UPDATE loadout_shares SET created_at = now() - interval '25 hours'`;
  expect(await store.create("capped", loadout("over"))).toMatch(/^[0-9A-Za-z]{10}$/);
  expect(await rowCount()).toBe(MAX_SHARES_PER_DAY + 2);
}, 60_000);
