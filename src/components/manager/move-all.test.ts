import { beforeEach, expect, test, vi } from "vitest";
import { BUCKETS } from "@/lib/inventory/buckets";
import type { InventoryItem, ManagerInventory } from "@/lib/inventory/build";
import type { ManagerActions } from "./manager-context";
import { moveAll } from "./move-all";

const toasts = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/toast", () => {
  const post = (kind: string) => (title: string) => void toasts.push(`${kind}: ${title}`);
  return {
    toast: {
      success: post("success"),
      error: post("error"),
      warning: post("warning"),
      info: post("info"),
      loading: () => ({ success: post("success"), error: post("error"), warning: post("warning") }),
    },
  };
});

const item = (key: string, bucketHash: number): InventoryItem => ({
  key,
  instanceId: key,
  itemHash: 1,
  name: key,
  typeName: "",
  itemType: 2,
  classType: 1,
  tierType: 5,
  bucketHash,
  quantity: 1,
  locked: false,
  masterworked: false,
  crafted: false,
  enhanced: false,
  deepsight: false,
  transferStatus: 0,
});

const helmet = item("helmet", BUCKETS.helmet);
const subclass = item("spare subclass", BUCKETS.subclass);

const inventory: ManagerInventory = {
  characters: [
    {
      id: "H",
      classType: 1,
      raceType: 0,
      light: 0,
      emblemBackgroundPath: "",
      emblemPath: "",
      dateLastPlayed: "",
      stats: {},
      equipped: {},
      inventory: { [BUCKETS.helmet]: [helmet], [BUCKETS.subclass]: [subclass] },
      postmaster: [],
    },
  ],
  vault: {},
  vaultCount: 0,
  vaultCapacity: 700,
  account: {},
  accountCapacity: {},
  currencies: [],
};

const actions = {
  inventory: () => inventory,
  runSteps: () => Promise.resolve({ ok: true as const }),
} as unknown as ManagerActions;

beforeEach(() => {
  toasts.length = 0;
});

test("Move all leaves out what can never move instead of reporting it as failed", async () => {
  moveAll(actions, [helmet, subclass], { kind: "vault" });
  await new Promise((r) => setTimeout(r, 0));
  expect(toasts).toEqual(["success: Moved 1 item"]);
});

test("Move all of only unmovable items says so", () => {
  moveAll(actions, [subclass], { kind: "vault" });
  expect(toasts).toEqual(["info: None of these can be moved"]);
});
