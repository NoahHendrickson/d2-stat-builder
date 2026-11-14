import { describe, expect, test } from "vitest";
import { planLoadoutPlugs, type PlanPiece, type PlugInfo } from "./apply-plan";
import {
  armorTargets,
  artifactTarget,
  planFromLive,
  plugCosts,
  type ApplyTargets,
  type LiveItem,
} from "./apply-targets";

const live = (plugs: (number | undefined)[], extra: Partial<LiveItem> = {}): LiveItem => ({
  sockets: plugs.map((plugHash) => ({ plugHash, isEnabled: true, isVisible: true })),
  ...extra,
});
const fromMap = (items: Record<string, LiveItem>) => (id: string) => items[id];
const triple = (t: ReturnType<typeof planFromLive>) => t.plugs.map((p) => [p.itemInstanceId, p.socketIndex, p.plugItemHash]);

describe("planFromLive: armor", () => {
  const TUNING = 50;
  const targets: ApplyTargets = {
    items: [
      {
        kind: "armor",
        itemInstanceId: "1",
        sockets: [
          { index: 0, plug: 10, empty: 1 }, // the loadout's stat mod
          { index: 1, empty: 2 }, // unfilled
          { index: 2, empty: 3 }, // unfilled, holds tuning
        ],
      },
    ],
    costs: { 10: 3, 20: 2 },
  };

  test("clears a leftover that costs energy, keeps a free one, and runs the clear first", () => {
    const plan = planFromLive(targets, fromMap({ "1": live([1, 20, TUNING], { energy: { capacity: 10, used: 4 } }) }));
    expect(triple(plan)).toEqual([
      ["1", 1, 2],
      ["1", 0, 10],
    ]);
    expect(plan.plugs[0]).toMatchObject({ clear: true, current: 20 });
    expect(plan.plugs[1].clear).toBeUndefined();
    expect(plan.overEnergy).toEqual([]);
  });

  test("a target already in its socket is in place, not sent", () => {
    const plan = planFromLive(targets, fromMap({ "1": live([10, 2, TUNING]) }));
    expect(plan.plugs).toEqual([]);
    expect(plan.inPlace).toEqual([{ itemInstanceId: "1", socketIndex: 0, plugItemHash: 10 }]);
  });

  test("flags a piece whose target needs more energy than it has", () => {
    // 6 used outside these sockets (e.g. a raid mod) + 3 for the stat mod > 8.
    const plan = planFromLive(targets, fromMap({ "1": live([1, 2, TUNING], { energy: { capacity: 8, used: 6 } }) }));
    expect(plan.overEnergy).toEqual(["1"]);
  });

  test("without a live read it falls back to the client's copy", () => {
    const withCopy: ApplyTargets = {
      ...targets,
      items: [{ ...targets.items[0], sockets: [{ index: 0, plug: 10, empty: 1, current: 10 }, { index: 1, empty: 2, current: 20 }] }] as ApplyTargets["items"],
    };
    const plan = planFromLive(withCopy, () => undefined);
    expect(plan.fromSnapshot).toEqual(["1"]);
    expect(triple(plan)).toEqual([["1", 1, 2]]);
    expect(plan.inPlace).toHaveLength(1);
  });
});

describe("planFromLive: subclass and artifact", () => {
  test("fragments already on the live subclass stay; the rest fill the free sockets", () => {
    const plan = planFromLive(
      {
        items: [
          {
            kind: "subclass",
            itemInstanceId: "9",
            groups: [{ kind: "fragment", start: 2, count: 3, desired: [70, 71], emptyHash: 99, clearUnused: true, current: {} }],
          },
        ],
        costs: {},
      },
      // Live: 71 is already on (socket 3); socket 2 holds an unwanted 80; socket 4 is locked.
      fromMap({ "9": { sockets: [{}, {}, { plugHash: 80 }, { plugHash: 71 }, { plugHash: 81, isEnabled: false }] } }),
    );
    expect(triple(plan)).toEqual([["9", 2, 70]]);
    expect(plan.inPlace).toEqual([{ itemInstanceId: "9", socketIndex: 3, plugItemHash: 71 }]);
  });

  test("an artifact perk that has to move is freed from its live socket first", () => {
    const plan = planFromLive(
      {
        items: [
          {
            kind: "artifact",
            itemInstanceId: "7",
            sockets: [
              { index: 0, empty: 5, plug: 40 },
              { index: 1, empty: 5, plug: 41 },
            ],
          },
        ],
        costs: {},
      },
      // Live: 41 sits in socket 0, where 40 should go.
      fromMap({ "7": live([41, 5]) }),
    );
    expect(triple(plan)).toEqual([
      ["7", 0, 5],
      ["7", 0, 40],
      ["7", 1, 41],
    ]);
    expect(plan.plugs[0]).toMatchObject({ clear: true, current: 41 });
  });
});

describe("client target builders", () => {
  const info: Record<number, PlugInfo> = {
    10: { kind: "general", name: "Minor Super Mod", cost: 1 },
    11: { kind: "general", name: "Super Mod", cost: 3 },
    12: { kind: "general", name: "Free stat thing", cost: 0 },
  };
  const pieces: PlanPiece[] = [
    {
      instanceId: "1",
      name: "Helmet",
      sockets: [
        { index: 0, kind: "general", current: 1, empty: 1, accepts: new Set([1, 10, 11, 12]) },
        { index: 5, kind: "tuning", current: 60 },
      ],
      energy: { capacity: 10, used: 0 },
    },
    { instanceId: "2", name: "No sockets", sockets: [] },
  ];

  test("armorTargets gives each managed socket the plan's plug, or none", () => {
    const plan = planLoadoutPlugs({ pieces, modHashes: [10], plugInfo: (h) => info[h] });
    expect(armorTargets(pieces, plan)).toEqual([
      {
        kind: "armor",
        itemInstanceId: "1",
        sockets: [
          { index: 0, plug: 10, empty: 1, current: 1 },
          { index: 5, current: 60 },
        ],
      },
    ]);
  });

  test("plugCosts prices every costing plug a socket accepts, so a live surprise is covered", () => {
    const plan = planLoadoutPlugs({ pieces, modHashes: [10], plugInfo: (h) => info[h] });
    expect(plugCosts(pieces, armorTargets(pieces, plan), (h) => info[h])).toEqual({ 10: 1, 11: 3 });
  });

  test("artifactTarget names every perk socket and the perk it should end with", () => {
    expect(
      artifactTarget({
        item: { instanceId: "7", itemHash: 1, equipped: true, perks: { 1: 41 } },
        plugs: [],
        inPlace: [],
        skipped: [],
        sockets: [
          { index: 0, options: [40, 41], emptyHash: 5 },
          { index: 1, options: [40, 41], emptyHash: 5 },
        ],
        target: { 0: 40 },
      }),
    ).toEqual({
      kind: "artifact",
      itemInstanceId: "7",
      sockets: [
        { index: 0, empty: 5, plug: 40 },
        { index: 1, empty: 5, current: 41 },
      ],
    });
    expect(artifactTarget(undefined)).toBeUndefined();
    expect(artifactTarget({ plugs: [], inPlace: [], skipped: ["x"] })).toBeUndefined();
  });
});
