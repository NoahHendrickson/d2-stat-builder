import { beforeEach, describe, expect, test, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import type { Armory } from "../armory/fetch";
import type { Manifest } from "../manifest/load";
import type { ActivitySet } from "./activity-sets";
import type { SavedLoadout } from "./types";

const applySavedLoadout = vi.fn();
vi.mock("./apply-client", () => ({
  applySavedLoadout: (...args: unknown[]) => applySavedLoadout(...args),
}));
vi.mock("./ingame-save", () => ({
  fetchInGameLoadouts: async () => ({
    slots: [0, 1].map((index) => ({ index, nameHash: 1, iconHash: 2, colorHash: 3, items: [{}], empty: false })),
    identifiers: { names: [{ hash: 1, name: "A" }], icons: [{ hash: 2, path: "" }], colors: [{ hash: 3, path: "" }] },
  }),
  fullyApplied: () => true,
  snapshotInGame: async () => ({ ok: true }),
  waitBetweenLoadoutActions: async () => {},
  InGameLoadoutsError: class extends Error {},
}));
vi.mock("./resolve", () => ({ resolveLoadout: () => ({ actionable: true, armor: [], weapons: [] }) }));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/auth/sign-out", () => ({ handleSessionExpired: vi.fn() }));

const { runActivitySet } = await import("./activity-set-run");

const CHAR = "c1";
const lagging = {
  characters: [{ id: CHAR, subclassItems: [] }],
  pieces: [{ instanceId: "boots", itemHash: 1, slot: "legs", location: "vault" }],
  weapons: [],
} as unknown as Armory;
const set: ActivitySet = {
  id: "s",
  name: "Raid",
  characterId: CHAR,
  classType: 0,
  slots: [
    { index: 0, loadoutId: "a" },
    { index: 1, loadoutId: "b" },
  ],
};
const loadouts = ["a", "b"].map((id) => ({ id, loadout: { name: id } })) as unknown as SavedLoadout[];

describe("runActivitySet", () => {
  beforeEach(() => {
    applySavedLoadout.mockReset();
    applySavedLoadout.mockResolvedValue({
      plan: {},
      equip: [{ itemInstanceId: "boots", ok: true }],
      plugs: [],
    });
  });

  test("plans each loadout from where the last one left the gear, not a lagging profile", async () => {
    const refreshArmory = vi.fn(async () => ({ data: lagging, mintedAt: Date.now(), isSuccess: true, error: null }));
    await runActivitySet({
      set,
      loadouts,
      armory: lagging,
      refreshArmory: refreshArmory as never,
      manifest: {} as Manifest,
      queryClient: {} as QueryClient,
    });
    const where = (call: number) =>
      (applySavedLoadout.mock.calls[call][0] as { armory: Armory["pieces"] }).armory[0];
    expect(where(0)).toMatchObject({ location: "vault" });
    expect(where(1)).toMatchObject({ location: "equipped", characterId: CHAR });
  });

  test("starts from a fresh profile rather than the page's copy", async () => {
    const live = { ...lagging, pieces: [{ ...lagging.pieces[0], location: "inventory", characterId: CHAR }] };
    const refreshArmory = vi.fn(async () => ({ data: live, mintedAt: Date.now(), isSuccess: true, error: null }));
    await runActivitySet({
      set: { ...set, slots: [set.slots[0]] },
      loadouts,
      armory: lagging,
      refreshArmory: refreshArmory as never,
      manifest: {} as Manifest,
      queryClient: {} as QueryClient,
    });
    expect((applySavedLoadout.mock.calls[0][0] as { armory: Armory["pieces"] }).armory[0]).toMatchObject({
      location: "inventory",
    });
  });
});
