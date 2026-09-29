import { expect, test } from "vitest";
import { BUCKETS } from "./buckets";
import type { InventoryItem, ManagerCharacter, ManagerInventory } from "./build";
import { planSmartMove, type MoveStep } from "./smart-moves";

const item = (key: string, extra: Partial<InventoryItem> = {}): InventoryItem => ({
  key,
  instanceId: key,
  itemHash: 1,
  name: key,
  typeName: "Hand Cannon",
  itemType: 3,
  classType: 3,
  tierType: 5,
  bucketHash: BUCKETS.kinetic,
  quantity: 1,
  power: 400,
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

const full = (prefix: string, extra: Partial<InventoryItem> = {}) =>
  Array.from({ length: 9 }, (_, i) => item(`${prefix}${i}`, { power: 400 + i, ...extra }));

function inv(chars: ManagerCharacter[], vault: InventoryItem[] = [], vaultCapacity = 700): ManagerInventory {
  const byBucket: Record<number, InventoryItem[]> = {};
  for (const v of vault) (byBucket[v.bucketHash] ??= []).push(v);
  return {
    characters: chars,
    vault: byBucket,
    vaultCount: vault.length,
    vaultCapacity,
    account: {},
    accountCapacity: {},
    currencies: [],
  };
}

const summary = (steps: MoveStep[]) =>
  steps.map((s) => `${s.item.key}->${s.to.kind === "vault" ? "vault" : s.to.characterId + (s.to.equipped ? "!" : "")}`);

test("a move that already works is one step", () => {
  const i = inv([character("T", 0), character("H", 1)], [item("gun")]);
  const plan = planSmartMove(i, item("gun"), { kind: "vault" }, { kind: "character", characterId: "H" }, { annotations: {} });
  expect(plan.ok && summary(plan.steps)).toEqual(["gun->H"]);
});

test("a full slot sends its junk to the vault first, then the lowest power", () => {
  const i = inv([character("H", 1, { inventory: { [BUCKETS.kinetic]: full("h") } })], [item("gun")]);
  const plan = planSmartMove(i, item("gun"), { kind: "vault" }, { kind: "character", characterId: "H" }, {
    annotations: { h5: { tag: "junk" } },
  });
  expect(plan.ok && summary(plan.steps)).toEqual(["h5->vault", "gun->H"]);

  const byPower = planSmartMove(i, item("gun"), { kind: "vault" }, { kind: "character", characterId: "H" }, {
    annotations: { h0: { tag: "favorite" } },
  });
  expect(byPower.ok && summary(byPower.steps)).toEqual(["h1->vault", "gun->H"]);
});

test("another class's armor leaves a full slot before anything the character can use", () => {
  const helm = (key: string, classType: number) =>
    item(key, { bucketHash: BUCKETS.helmet, itemType: 2, classType, power: 500 });
  const h = character("H", 1, {
    inventory: { [BUCKETS.helmet]: [...Array.from({ length: 8 }, (_, n) => helm(`mine${n}`, 1)), helm("titan", 0)] },
  });
  const plan = planSmartMove(inv([h], [helm("new", 1)]), helm("new", 1), { kind: "vault" }, { kind: "character", characterId: "H" }, {
    annotations: {},
  });
  expect(plan.ok && summary(plan.steps)).toEqual(["titan->vault", "new->H"]);
});

test("a full vault sends one of its items to a character with room", () => {
  const i = inv(
    [character("T", 0, { inventory: { [BUCKETS.kinetic]: [item("t-gun")] } }), character("H", 1)],
    [item("v-gun", { bucketHash: BUCKETS.energy })],
    1,
  );
  const plan = planSmartMove(i, item("t-gun"), { kind: "character", characterId: "T", equipped: false }, { kind: "vault" }, {
    annotations: {},
  });
  expect(plan.ok && plan.steps.length).toBe(2);
  expect(plan.ok && summary(plan.steps)[1]).toBe("t-gun->vault");
  expect(plan.ok && plan.steps[0]!.item.key).toBe("v-gun");
});

test("moving an equipped item equips the best replacement first", () => {
  const t = character("T", 0, {
    equipped: { [BUCKETS.kinetic]: item("eq") },
    inventory: { [BUCKETS.kinetic]: [item("low", { power: 390 }), item("high", { power: 410 }), item("junk", { power: 450 })] },
  });
  const plan = planSmartMove(inv([t, character("H", 1)]), item("eq"), { kind: "character", characterId: "T", equipped: true }, { kind: "character", characterId: "H" }, {
    annotations: { junk: { tag: "junk" } },
  });
  expect(plan.ok && summary(plan.steps)).toEqual(["high->T!", "eq->H"]);
});

test("equipping an exotic takes the other equipped exotic off", () => {
  const t = character("T", 0, {
    equipped: {
      [BUCKETS.kinetic]: item("ace", { tierType: 6 }),
      [BUCKETS.energy]: item("energy-eq", { bucketHash: BUCKETS.energy }),
    },
    inventory: { [BUCKETS.kinetic]: [item("spare")] },
  });
  const exotic = item("xeno", { bucketHash: BUCKETS.energy, tierType: 6 });
  const plan = planSmartMove(inv([t], [exotic]), exotic, { kind: "vault" }, { kind: "character", characterId: "T", equipped: true }, {
    annotations: {},
  });
  expect(plan.ok && summary(plan.steps)).toEqual(["spare->T!", "xeno->T!"]);
});

test("reports why when nothing can make room", () => {
  const i = inv([character("H", 1, { inventory: { [BUCKETS.kinetic]: full("h", { transferStatus: 2 }) } })], [item("gun")]);
  const plan = planSmartMove(i, item("gun"), { kind: "vault" }, { kind: "character", characterId: "H" }, { annotations: {} });
  expect(plan.ok).toBe(false);
  const classPlan = planSmartMove(
    inv([character("H", 1)], [item("titan-helm", { bucketHash: BUCKETS.helmet, classType: 0 })]),
    item("titan-helm", { bucketHash: BUCKETS.helmet, classType: 0 }),
    { kind: "vault" },
    { kind: "character", characterId: "H", equipped: true },
    { annotations: {} },
  );
  expect(classPlan).toEqual({ ok: false, problem: "Titan gear can't be equipped by a Hunter" });
});
