// The socket half of applying a loadout, end to end: the client's planner and target
// builders (fed the page's possibly stale profile), then the server's live plan,
// inserts, and checks, against a fake Bungie that holds the real sockets and enforces
// armor energy the way Bungie does.
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { HttpClient } from "bungie-api-ts/http";
import { BungieHttpError } from "./http";
import type { PlanPiece, PlanSocket, PlugInfo } from "../loadouts/apply-plan";

const getItem = vi.fn();
const insertSocketPlugFree = vi.fn();
vi.mock("bungie-api-ts/destiny2", () => ({
  getItem: (...args: unknown[]) => getItem(...args),
  insertSocketPlugFree: (...args: unknown[]) => insertSocketPlugFree(...args),
  transferItem: vi.fn(),
  equipItems: vi.fn(),
  getCharacter: vi.fn(),
  pullFromPostmaster: vi.fn(),
}));
const { applyPlugTargets, summarize, NOT_STUCK_MESSAGE, UNCHECKED_MESSAGE } = await import("./apply-plugs-server");
const { ApplyCancelledError } = await import("./equip-server");
const { planLoadoutPlugs } = await import("../loadouts/apply-plan");
const { armorTargets, plugCosts } = await import("../loadouts/apply-targets");

// Hashes are made up; names and costs are the real mods'.
const E_GEN = 1, E_HEAD = 2, E_CLASS = 3;
const MINOR_SUPER = 10, MAJOR_SUPER = 11, SUPER_FONT = 20, POWERFUL_ATTRACTION = 30, CLASS_FONT = 31;
const INFO: Record<number, PlugInfo> = {
  [MINOR_SUPER]: { kind: "general", name: "Minor Super Mod", cost: 1 },
  [MAJOR_SUPER]: { kind: "general", name: "Super Mod", cost: 3 },
  [SUPER_FONT]: { kind: "other", name: "Super Font", cost: 3 },
  [POWERFUL_ATTRACTION]: { kind: "other", name: "Powerful Attraction", cost: 2 },
  [CLASS_FONT]: { kind: "other", name: "Class Font", cost: 3 },
};
const plugInfo = (h: number) => INFO[h];
const cost = (h: number | undefined) => (h === undefined ? 0 : (INFO[h]?.cost ?? 0));

const HELMET = "101";
const CLOAK = "105";
/** Per piece: [general socket, three slot sockets] — the Armor 3.0 layout. */
type Gear = Record<string, { capacity: number; sockets: number[] }>;
const SLOT: Record<string, { empty: number; accepts: number[] }> = {
  [HELMET]: { empty: E_HEAD, accepts: [SUPER_FONT] },
  [CLOAK]: { empty: E_CLASS, accepts: [POWERFUL_ATTRACTION, CLASS_FONT] },
};
const used = (sockets: number[]) => sockets.reduce((n, h) => n + cost(h), 0);
const clone = (g: Gear): Gear => structuredClone(g);

/** What the client planner sees: the page's copy of the profile. */
function planPieces(snapshot: Gear): PlanPiece[] {
  return Object.entries(snapshot).map(([id, p]) => {
    const slot = SLOT[id];
    const sockets: PlanSocket[] = p.sockets.map((current, index) =>
      index === 0
        ? { index, kind: "general", current, empty: E_GEN, accepts: new Set([E_GEN, MINOR_SUPER, MAJOR_SUPER]) }
        : { index, kind: "other", current, empty: slot.empty, accepts: new Set([slot.empty, ...slot.accepts]) },
    );
    return { instanceId: id, name: id, sockets, energy: { capacity: p.capacity, used: used(p.sockets) } };
  });
}

const itemResponse = (p: Gear[string]) => ({
  sockets: { data: { sockets: p.sockets.map((plugHash) => ({ plugHash, isEnabled: true, isVisible: true })) } },
  instance: { data: { energy: { energyCapacity: p.capacity, energyUsed: used(p.sockets) } } },
});

/**
 * Bungie, holding the real sockets. `drop` makes an insert answer success without the
 * plug going in (as many times as its count says); `bareResponses` leaves the item out
 * of insert answers, so only a re-read can tell what stuck.
 */
function fakeBungie(real: Gear, { drop = new Map<string, number>(), bareResponses = false } = {}) {
  getItem.mockImplementation(async (_http: HttpClient, req: { itemInstanceId: string }) => {
    const p = real[req.itemInstanceId];
    if (!p) throw new BungieHttpError(200, "DestinyItemNotFound", 1623);
    return { Response: itemResponse(p), ErrorCode: 1 };
  });
  insertSocketPlugFree.mockImplementation(
    async (_http: HttpClient, req: { itemId: string; plug: { socketIndex: number; plugItemHash: number } }) => {
      const p = real[req.itemId];
      const { socketIndex: i, plugItemHash: h } = req.plug;
      if (p.sockets[i] === h) throw new BungieHttpError(200, "DestinySocketAlreadyHasPlug", 1679);
      if (used(p.sockets) - cost(p.sockets[i]) + cost(h) > p.capacity) {
        throw new BungieHttpError(200, "DestinyFailedPlugInsertionRules", 1676);
      }
      const key = `${req.itemId}:${i}:${h}`;
      const drops = drop.get(key) ?? 0;
      if (drops > 0) drop.set(key, drops - 1);
      else p.sockets[i] = h;
      return { Response: bareResponses ? {} : { item: itemResponse(p) }, ErrorCode: 1 };
    },
  );
}

const http = (() => Promise.resolve({})) as unknown as HttpClient;

/** Plan on the client from `snapshot`, then run the server half against `real`. */
async function apply(
  snapshot: Gear,
  real: Gear,
  mods: number[],
  placements?: Record<string, Record<number, number>>,
  opts: { skip?: Map<string, string> } = {},
) {
  const pieces = planPieces(snapshot);
  const clientPlan = planLoadoutPlugs({ pieces, modHashes: mods, plugInfo, placements });
  const armor = armorTargets(pieces, clientPlan);
  const events: string[] = [];
  const run = applyPlugTargets({
    http,
    membershipType: 3,
    membershipId: "4611686018400000000",
    characterId: "2305843009200000000",
    targets: { items: armor, costs: plugCosts(pieces, armor, plugInfo) },
    skip: opts.skip ?? new Map(),
    onProgress: (e) =>
      events.push(e.phase === "start" ? `start ${e.plug.plugItemHash}` : `${e.result.ok ? "ok" : "fail"} ${e.result.plugItemHash}`),
  });
  await vi.runAllTimersAsync();
  const { plan, outcomes } = await run;
  return {
    clientPlan,
    events,
    plan,
    results: outcomes.map((o) => o.result),
    summary: summarize(armor.length, plan, outcomes),
  };
}

const LOADOUT_MODS = [MINOR_SUPER, SUPER_FONT, SUPER_FONT, SUPER_FONT, POWERFUL_ATTRACTION, CLASS_FONT, CLASS_FONT];
/** What the mod editor saves: every mod pinned to its socket. */
const PINS = {
  [HELMET]: { 0: MINOR_SUPER, 1: SUPER_FONT, 2: SUPER_FONT, 3: SUPER_FONT },
  [CLOAK]: { 1: POWERFUL_ATTRACTION, 2: CLASS_FONT, 3: CLASS_FONT },
};
const APPLIED: Gear = {
  [HELMET]: { capacity: 10, sockets: [MINOR_SUPER, SUPER_FONT, SUPER_FONT, SUPER_FONT] },
  [CLOAK]: { capacity: 8, sockets: [E_GEN, POWERFUL_ATTRACTION, CLASS_FONT, CLASS_FONT] },
};

beforeEach(() => {
  vi.useFakeTimers();
  getItem.mockReset();
  insertSocketPlugFree.mockReset();
});

describe("planning from live sockets (NoahHendrickson/d2-conflux-feedback#9)", () => {
  test("a stale profile no longer leaves mods off, a stat mod on the cloak, or a Super Font out", async () => {
    // The page's profile, from before the player changed mods in-game.
    const snapshot: Gear = {
      [HELMET]: { capacity: 10, sockets: [MINOR_SUPER, SUPER_FONT, SUPER_FONT, E_HEAD] },
      [CLOAK]: { capacity: 8, sockets: [E_GEN, E_CLASS, CLASS_FONT, CLASS_FONT] },
    };
    // What the character really has: a Super Mod on the helmet, the minor one on the cloak.
    const real: Gear = {
      [HELMET]: { capacity: 10, sockets: [MAJOR_SUPER, SUPER_FONT, SUPER_FONT, E_HEAD] },
      [CLOAK]: { capacity: 8, sockets: [MINOR_SUPER, E_CLASS, CLASS_FONT, CLASS_FONT] },
    };
    fakeBungie(real);
    const out = await apply(snapshot, real, LOADOUT_MODS, PINS);

    // The client's stale guess thought the helmet's stat mod was already right…
    expect(out.clientPlan.inPlace.map((p) => p.label)).toContain(`Minor Super Mod → ${HELMET}`);
    // …the server, reading live sockets, swaps it and clears the cloak's leftover first.
    expect(out.plan.plugs.map((p) => [p.itemInstanceId, p.socketIndex, p.plugItemHash])).toEqual([
      [HELMET, 0, MINOR_SUPER],
      [CLOAK, 0, E_GEN],
      [HELMET, 3, SUPER_FONT],
      [CLOAK, 1, POWERFUL_ATTRACTION],
    ]);
    expect(out.plan.plugs[1]).toMatchObject({ clear: true, current: MINOR_SUPER });
    expect(out.results.every((r) => r.ok)).toBe(true);
    expect(real).toEqual(APPLIED);
    expect(out.summary).toMatchObject({ sent: 4, inPlace: 4, inserted: 4, retried: 0, failed: 0, readFailed: 0 });
  });

  test("re-applying an applied loadout inserts nothing and reports every mod in place", async () => {
    const real = clone(APPLIED);
    fakeBungie(real);
    const out = await apply(clone(APPLIED), real, LOADOUT_MODS, PINS);
    expect(insertSocketPlugFree).not.toHaveBeenCalled();
    expect(getItem).toHaveBeenCalledTimes(2);
    expect(out.plan.plugs).toEqual([]);
    expect(out.plan.inPlace).toHaveLength(LOADOUT_MODS.length);
    expect(out.results).toEqual([]);
  });

  test("a stale copy that shows nothing to do still gets the live leftovers fixed", async () => {
    // The page thinks the loadout is on; in-game the player has since swapped two mods.
    const real: Gear = {
      [HELMET]: { capacity: 10, sockets: [MAJOR_SUPER, SUPER_FONT, SUPER_FONT, E_HEAD] },
      [CLOAK]: { capacity: 8, sockets: [MINOR_SUPER, POWERFUL_ATTRACTION, CLASS_FONT, CLASS_FONT] },
    };
    fakeBungie(real);
    const out = await apply(clone(APPLIED), real, LOADOUT_MODS, PINS);
    expect(out.clientPlan.plugs).toEqual([]);
    expect(out.results.every((r) => r.ok)).toBe(true);
    expect(real).toEqual(APPLIED);
  });

  test("an item Bungie won't return is planned from the client's copy, without trusting its \"in place\"", async () => {
    const real = clone(APPLIED);
    real[HELMET].sockets[3] = E_HEAD;
    const snapshot = clone(real);
    real[HELMET].sockets[0] = E_GEN; // changed in-game: the copy still shows the stat mod
    fakeBungie(real);
    const reads = getItem.getMockImplementation()!;
    getItem.mockImplementation(async (h: HttpClient, req: { itemInstanceId: string }) => {
      if (req.itemInstanceId === HELMET) throw new BungieHttpError(503, "SystemDisabled", 5);
      return reads(h, req);
    });
    const out = await apply(snapshot, real, LOADOUT_MODS, PINS);
    expect(out.plan.fromSnapshot).toEqual([HELMET]);
    expect(out.summary.readFailed).toBe(1);
    expect(out.plan.inPlace.every((p) => p.itemInstanceId !== HELMET)).toBe(true);
    expect(out.results.every((r) => r.ok)).toBe(true);
    expect(real).toEqual(APPLIED);
  });

  test("a piece whose equip failed is read but not inserted: its mods in place stay in place", async () => {
    const real: Gear = { [HELMET]: { capacity: 10, sockets: [E_GEN, SUPER_FONT, E_HEAD, E_HEAD] }, [CLOAK]: clone(APPLIED)[CLOAK] };
    fakeBungie(real);
    const out = await apply(clone(real), real, LOADOUT_MODS, PINS, { skip: new Map([[HELMET, "Vault is full"]]) });
    expect(insertSocketPlugFree).not.toHaveBeenCalled();
    expect(out.plan.inPlace).toContainEqual({ itemInstanceId: HELMET, socketIndex: 1, plugItemHash: SUPER_FONT });
    expect(out.results).toHaveLength(3);
    expect(out.results.every((r) => !r.ok && r.message === "Skipped — its armor piece wasn't equipped (Vault is full)")).toBe(true);
    expect(out.summary).toMatchObject({ skipped: 3, failed: 0 });
  });

  test("a cancel mid-way still leaves the outcomes so far for the log", async () => {
    const real = clone(APPLIED);
    real[HELMET].sockets = [E_GEN, SUPER_FONT, SUPER_FONT, E_HEAD];
    fakeBungie(real);
    const pieces = planPieces(clone(real));
    const armor = armorTargets(pieces, planLoadoutPlugs({ pieces, modHashes: LOADOUT_MODS, plugInfo, placements: PINS }));
    const outcomes: { result: { ok: boolean } }[] = [];
    let checks = 0;
    const run = applyPlugTargets({
      http,
      membershipType: 3,
      membershipId: "4611686018400000000",
      characterId: "2305843009200000000",
      targets: { items: armor, costs: plugCosts(pieces, armor, plugInfo) },
      skip: new Map(),
      shouldStop: async () => ++checks > 1,
      onOutcome: (o) => outcomes.push(o),
    });
    const settled = run.then(() => undefined, (err: unknown) => err);
    await vi.runAllTimersAsync();
    expect(await settled).toBeInstanceOf(ApplyCancelledError);
    expect(insertSocketPlugFree).toHaveBeenCalledTimes(1);
    expect(outcomes.map((o) => o.result.ok)).toEqual([true]);
  });
});

describe("checking each insert stayed in", () => {
  const EMPTY_HELMET: Gear = {
    [HELMET]: { capacity: 10, sockets: [E_GEN, SUPER_FONT, SUPER_FONT, E_HEAD] },
    [CLOAK]: clone(APPLIED)[CLOAK],
  };
  const insertsOf = (hash: number) =>
    insertSocketPlugFree.mock.calls.filter((c) => c[1].plug.plugItemHash === hash).length;

  test("an insert that silently doesn't stick is retried once, then lands", async () => {
    const real = clone(EMPTY_HELMET);
    fakeBungie(real, { drop: new Map([[`${HELMET}:3:${SUPER_FONT}`, 1]]) });
    const out = await apply(clone(real), real, LOADOUT_MODS, PINS);
    expect(insertsOf(SUPER_FONT)).toBe(2);
    expect(out.results.every((r) => r.ok)).toBe(true);
    expect(out.summary).toMatchObject({ retried: 1, failed: 0, inserted: 2 });
    expect(real).toEqual(APPLIED);
    // The card never saw it "ok" before it was really in.
    expect(out.events.filter((e) => e.endsWith(` ${SUPER_FONT}`))).toEqual([
      `start ${SUPER_FONT}`,
      `start ${SUPER_FONT}`,
      `ok ${SUPER_FONT}`,
    ]);
  });

  test("one that never sticks gets one retry, then is reported failed with a reason", async () => {
    const real = clone(EMPTY_HELMET);
    fakeBungie(real, { drop: new Map([[`${HELMET}:3:${SUPER_FONT}`, 99]]) });
    const out = await apply(clone(real), real, LOADOUT_MODS, PINS);
    expect(insertsOf(SUPER_FONT)).toBe(2);
    const failed = out.results.filter((r) => !r.ok);
    expect(failed).toEqual([
      { itemInstanceId: HELMET, socketIndex: 3, plugItemHash: SUPER_FONT, ok: false, message: NOT_STUCK_MESSAGE },
    ]);
    expect(out.summary).toMatchObject({ retried: 1, failed: 1, failedHashes: [SUPER_FONT] });
    expect(out.events).not.toContain(`ok ${SUPER_FONT}`);
  });

  test("without the item in Bungie's answer, a re-read does the checking", async () => {
    const real = clone(EMPTY_HELMET);
    fakeBungie(real, { bareResponses: true, drop: new Map([[`${HELMET}:3:${SUPER_FONT}`, 99]]) });
    const out = await apply(clone(real), real, LOADOUT_MODS, PINS);
    // One read to plan, then one after each insert: the stat mod, the font, its retry.
    expect(getItem.mock.calls.filter((c) => c[1].itemInstanceId === HELMET)).toHaveLength(4);
    expect(out.results.find((r) => r.plugItemHash === MINOR_SUPER)?.ok).toBe(true);
    expect(out.results.find((r) => r.plugItemHash === SUPER_FONT)).toMatchObject({ ok: false, message: NOT_STUCK_MESSAGE });
    // Counted once per plug, not per attempt.
    expect(out.summary.checked).toEqual({ response: 0, reread: 2, already: 0, unchecked: 0 });
  });

  test("a clear that doesn't stick is retried before the insert that needs it", async () => {
    // An artifact perk has to move: free it from socket 0, put 40 there, then 41 in socket 1.
    const ARTIFACT = "107";
    const real: Gear = { [ARTIFACT]: { capacity: 99, sockets: [41, 5] } };
    fakeBungie(real, { drop: new Map([[`${ARTIFACT}:0:5`, 1]]) });
    const run = applyPlugTargets({
      http,
      membershipType: 3,
      membershipId: "4611686018400000000",
      characterId: "2305843009200000000",
      targets: {
        items: [{ kind: "artifact", itemInstanceId: ARTIFACT, sockets: [{ index: 0, empty: 5, plug: 40 }, { index: 1, empty: 5, plug: 41 }] }],
        costs: {},
      },
      skip: new Map(),
    });
    await vi.runAllTimersAsync();
    const { outcomes } = await run;
    const out = { results: outcomes.map((o) => o.result) };
    expect(insertSocketPlugFree.mock.calls.map((c) => [c[1].plug.socketIndex, c[1].plug.plugItemHash])).toEqual([
      [0, 5],
      [0, 5],
      [0, 40],
      [1, 41],
    ]);
    expect(out.results.every((r) => r.ok)).toBe(true);
    expect(real[ARTIFACT].sockets).toEqual([40, 41]);
  });

  test("when Bungie can't show an insert, the retry's \"already has it\" confirms it", async () => {
    const real = clone(EMPTY_HELMET);
    fakeBungie(real, { bareResponses: true });
    const reads = getItem.getMockImplementation()!;
    let calls = 0;
    getItem.mockImplementation(async (h: HttpClient, req: { itemInstanceId: string }) => {
      if (calls++ > 1) throw new BungieHttpError(503, "SystemDisabled", 5); // only the planning reads work
      return reads(h, req);
    });
    const out = await apply(clone(real), real, LOADOUT_MODS, PINS);
    expect(out.results.every((r) => r.ok)).toBe(true);
    expect(out.summary).toMatchObject({ retried: 2, checked: { response: 0, reread: 0, already: 2, unchecked: 0 } });
    expect(real).toEqual(APPLIED);
  });

  test("an insert that can't be checked at all is retried once, then failed, not called ok", async () => {
    const real = clone(EMPTY_HELMET);
    fakeBungie(real, { bareResponses: true, drop: new Map([[`${HELMET}:3:${SUPER_FONT}`, 99]]) });
    const reads = getItem.getMockImplementation()!;
    let calls = 0;
    getItem.mockImplementation(async (h: HttpClient, req: { itemInstanceId: string }) => {
      if (calls++ > 1) throw new BungieHttpError(503, "SystemDisabled", 5);
      return reads(h, req);
    });
    const out = await apply(clone(real), real, LOADOUT_MODS, PINS);
    expect(insertsOf(SUPER_FONT)).toBe(2);
    expect(out.results.find((r) => r.plugItemHash === SUPER_FONT)).toMatchObject({ ok: false, message: UNCHECKED_MESSAGE });
    expect(out.summary.checked.unchecked).toBe(1);
  });

  test("a retry that can't go out leaves an unchecked insert unchecked, not failed for the retry's reason", async () => {
    const real = clone(EMPTY_HELMET);
    fakeBungie(real, { bareResponses: true });
    const inserts = insertSocketPlugFree.getMockImplementation()!;
    let fonts = 0;
    insertSocketPlugFree.mockImplementation(async (h: HttpClient, req: { plug: { plugItemHash: number } }) => {
      if (req.plug.plugItemHash === SUPER_FONT && ++fonts === 2) throw new BungieHttpError(200, "DestinyCannotPerformActionAtThisLocation", 1671);
      return inserts(h, req);
    });
    const reads = getItem.getMockImplementation()!;
    let calls = 0;
    getItem.mockImplementation(async (h: HttpClient, req: { itemInstanceId: string }) => {
      if (calls++ > 1) throw new BungieHttpError(503, "SystemDisabled", 5);
      return reads(h, req);
    });
    const out = await apply(clone(real), real, LOADOUT_MODS, PINS);
    expect(out.results.find((r) => r.plugItemHash === SUPER_FONT)).toMatchObject({ ok: false, message: UNCHECKED_MESSAGE });
  });

  test("a real error is reported as is, not retried", async () => {
    const real = clone(EMPTY_HELMET);
    const snapshot = clone(real);
    real[HELMET].capacity = 8; // 1 + 3 + 3 + 3 won't fit
    fakeBungie(real);
    const out = await apply(snapshot, real, LOADOUT_MODS, PINS);
    expect(out.plan.overEnergy).toEqual([HELMET]);
    expect(insertsOf(SUPER_FONT)).toBe(1);
    expect(out.summary).toMatchObject({ retried: 0, failed: 1, codes: { 1676: 1 } });
  });
});
