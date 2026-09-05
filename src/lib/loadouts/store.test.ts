import { test, expect } from "vitest";
import { MemoryLoadoutStore } from "./store";
import type { SavedLoadoutData } from "./types";

const data = (name: string): SavedLoadoutData => ({
  version: 1,
  loadout: {
    id: "stat-builder",
    name,
    classType: 1,
    equipped: [],
    unequipped: [],
    parameters: { mods: [], assumeArmorMasterwork: 3 },
  },
});

test("rows are scoped to their owner", async () => {
  let t = 0;
  const store = new MemoryLoadoutStore(() => ++t);
  const a = await store.create("owner-a", data("A"));
  await store.create("owner-b", data("B"));

  expect((await store.list("owner-a")).map((l) => l.loadout.name)).toEqual(["A"]);
  expect(await store.get("owner-b", a.id)).toBeNull();
  expect(await store.update("owner-b", a.id, data("hijack"))).toBeNull();
  expect(await store.delete("owner-b", a.id)).toBe(false);
  expect((await store.get("owner-a", a.id))?.loadout.name).toBe("A");
});

test("update keeps createdAt, bumps updatedAt; list is newest-first", async () => {
  let t = 0;
  const store = new MemoryLoadoutStore(() => ++t);
  const first = await store.create("o", data("first"));
  const second = await store.create("o", data("second"));
  expect((await store.list("o")).map((l) => l.loadout.name)).toEqual(["second", "first"]);

  const updated = await store.update("o", first.id, data("first v2"));
  expect(updated?.createdAt).toBe(first.createdAt);
  expect(updated!.updatedAt).toBeGreaterThan(second.updatedAt);
  expect((await store.list("o")).map((l) => l.loadout.name)).toEqual(["first v2", "second"]);
});

test("create honors a caller-supplied id and delete removes it", async () => {
  const store = new MemoryLoadoutStore();
  const row = await store.create("o", data("x"), "fixed-id");
  expect(row.id).toBe("fixed-id");
  expect(await store.delete("o", "fixed-id")).toBe(true);
  expect(await store.list("o")).toEqual([]);
});
