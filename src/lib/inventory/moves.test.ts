import { expect, test } from "vitest";
import { BUCKETS } from "./buckets";
import type { InventoryItem, ManagerCharacter, ManagerInventory } from "./build";
import { OP_TTL_MS, applyMoves, locate, moveOptions, moveProblem, settledOps, type MoveOp } from "./moves";

const item = (key: string, extra: Partial<InventoryItem> = {}): InventoryItem => ({
  key,
  instanceId: key,
  itemHash: 1,
  name: key,
  typeName: "",
  itemType: 3,
  classType: 3,
  tierType: 5,
  bucketHash: BUCKETS.kinetic,
  quantity: 1,
  locked: false,
  masterworked: false,
  crafted: false,
  enhanced: false,
  deepsight: false,
  transferStatus: 0,
  ...extra,
});

const character = (id: string, classType: number, extra: Partial<ManagerCharacter> = {}): ManagerCharacter => ({
  id,
  classType,
  light: 0,
  emblemBackgroundPath: "",
  emblemPath: "",
  dateLastPlayed: "",
  stats: {},
  equipped: {},
  inventory: {},
  postmaster: [],
  ...extra,
});

function inventory(): ManagerInventory {
  return {
    characters: [
      character("T", 0, {
        equipped: { [BUCKETS.kinetic]: item("t-eq") },
        inventory: { [BUCKETS.kinetic]: [item("t-1")] },
        postmaster: [item("pm-gun"), item("pm-mats", { instanceId: undefined, bucketHash: BUCKETS.consumables, quantity: 5 })],
      }),
      character("H", 1, {
        equipped: { [BUCKETS.kinetic]: item("h-eq") },
        inventory: { [BUCKETS.kinetic]: Array.from({ length: 9 }, (_, i) => item(`h-${i}`)) },
      }),
    ],
    vault: {
      [BUCKETS.kinetic]: [item("v-gun")],
      [BUCKETS.helmet]: [item("v-hunter-helm", { bucketHash: BUCKETS.helmet, classType: 1 })],
    },
    vaultCount: 2,
    vaultCapacity: 700,
    account: {},
    accountCapacity: {},
    currencies: [],
  };
}

const op = (itemKey: string, to: MoveOp["to"], extra: Partial<MoveOp> = {}): MoveOp => ({
  id: 1,
  itemKey,
  to,
  status: "pending",
  at: 0,
  ...extra,
});

test("moving to the vault and back updates both sides", () => {
  const inv = applyMoves(inventory(), [op("t-1", { kind: "vault" })]);
  expect(locate(inv, "t-1")?.place).toEqual({ kind: "vault" });
  expect(inv.characters[0].inventory[BUCKETS.kinetic]).toEqual([]);
  expect(inv.vaultCount).toBe(3);

  const back = applyMoves(inv, [op("t-1", { kind: "character", characterId: "T" })]);
  expect(locate(back, "t-1")?.place).toEqual({ kind: "character", characterId: "T", equipped: false });
  expect(back.vaultCount).toBe(2);
});

test("equipping swaps the old equipped item into the inventory", () => {
  const inv = applyMoves(inventory(), [op("v-gun", { kind: "character", characterId: "T", equipped: true })]);
  const titan = inv.characters[0];
  expect(titan.equipped[BUCKETS.kinetic].key).toBe("v-gun");
  expect(titan.inventory[BUCKETS.kinetic].map((i) => i.key).sort()).toEqual(["t-1", "t-eq"]);
});

test("applying leaves the input untouched and is a no-op once reflected", () => {
  const base = inventory();
  applyMoves(base, [op("t-1", { kind: "vault" })]);
  expect(locate(base, "t-1")?.place.kind).toBe("character");
  const once = applyMoves(base, [op("t-1", { kind: "vault" })]);
  const twice = applyMoves(once, [op("t-1", { kind: "vault" })]);
  expect(twice.vaultCount).toBe(once.vaultCount);
});

test("pulled stacks land in the account inventory", () => {
  const inv = applyMoves(inventory(), [op("pm-mats", { kind: "character", characterId: "T" })]);
  expect(inv.characters[0].postmaster.map((i) => i.key)).toEqual(["pm-gun"]);
  expect(inv.account[BUCKETS.consumables].map((i) => i.key)).toEqual(["pm-mats"]);
});

test("moveProblem catches what the manager can see", () => {
  const inv = inventory();
  const at = (key: string) => locate(inv, key)!;
  const problem = (key: string, to: MoveOp["to"]) => moveProblem(inv, at(key).item, at(key).place, to);

  expect(problem("t-1", { kind: "vault" })).toBeNull();
  expect(problem("t-eq", { kind: "vault" })).toMatch(/Equipped/);
  expect(problem("t-1", { kind: "character", characterId: "H" })).toMatch(/No room on your Hunter/);
  expect(problem("v-hunter-helm", { kind: "character", characterId: "T" })).toBeNull();
  expect(problem("v-hunter-helm", { kind: "character", characterId: "T", equipped: true })).toMatch(/Hunter gear/);
  expect(problem("pm-mats", { kind: "vault" })).toMatch(/Pull it/);
  expect(problem("pm-mats", { kind: "character", characterId: "T" })).toBeNull();
  expect(problem("t-1", { kind: "character", characterId: "T", equipped: false })).toBe("Already there");

  const full = { ...inv, vaultCount: 700 };
  expect(moveProblem(full, at("t-1").item, at("t-1").place, { kind: "vault" })).toBe("Vault is full");
});

test("settledOps drops done ops the profile reflects, or that are too old", () => {
  const base = inventory();
  const ops = [
    op("t-1", { kind: "vault" }, { id: 1, status: "done", at: 1000 }), // not reflected yet
    op("v-gun", { kind: "vault" }, { id: 2, status: "done", at: 1000 }), // reflected
    op("gone", { kind: "vault" }, { id: 3, status: "done", at: 1000 }), // item vanished
    op("t-1", { kind: "vault" }, { id: 4, status: "pending", at: 0 }), // still running
  ];
  expect([...settledOps(base, ops, 2000)].sort()).toEqual([2, 3]);
  expect(settledOps(base, ops, 1000 + OP_TTL_MS + 1).has(1)).toBe(true);
});

test("moveOptions lists pulls, sends, and equips with reasons for the blocked ones", () => {
  const inv = inventory();
  const at = (key: string) => locate(inv, key)!;
  const labels = (key: string) =>
    moveOptions(inv, at(key).item, at(key).place).map((o) => (o.problem ? `${o.label} (blocked)` : o.label));

  expect(labels("t-1")).toEqual([
    "Equip on Titan",
    "Equip on Hunter (blocked)",
    "Send to Hunter (blocked)",
    "Send to vault",
  ]);
  expect(labels("pm-mats")).toEqual(["Pull to Titan"]);
  expect(labels("pm-gun")).toEqual([
    "Pull to Titan",
    "Equip on Titan",
    "Equip on Hunter (blocked)",
    "Send to Hunter (blocked)",
    "Send to vault",
  ]);
  // Equipped: offered everywhere (smart moves equip a replacement); the plain check blocks.
  expect(labels("t-eq")).toEqual([
    "Equip on Hunter (blocked)",
    "Send to Hunter (blocked)",
    "Send to vault (blocked)",
  ]);
});
