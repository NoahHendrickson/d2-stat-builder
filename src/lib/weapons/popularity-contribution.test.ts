import type { DestinyProfileResponse } from "bungie-api-ts/destiny2";
import { describe, expect, it } from "vitest";
import type { CrawlSource, PopularityLookup } from "./perk-popularity";
import { contributionFromProfile, decodeContribution, encodeContribution } from "./popularity-contribution";
import { mergeCopies, snapshotFromCopies, storeDay } from "./popularity-copies";
import { readCollector } from "./popularity-reads";

const item = (itemHash: number, itemInstanceId?: string) => ({ itemHash, itemInstanceId });
const sockets = (...plugs: (number | undefined)[]) => ({ sockets: plugs.map((plugHash) => ({ plugHash })) });

/** A profile: weapons 1 and 2 equipped and in the vault, a piece of armor (3), sockets for all of them. */
function profile({ vault = true, withSockets = true, equipment = true } = {}) {
  return {
    profile: { data: { dateLastPlayed: "2026-10-18T12:00:00Z" } },
    characterEquipment: equipment ? { data: { c: { items: [item(1, "10"), item(3, "30")] } } } : {},
    characterInventories: { data: { c: { items: [item(2, "20"), item(9)] } } },
    profileInventory: vault ? { data: { items: [item(1, "11")] } } : {},
    itemComponents: {
      instances: { data: { 10: { damageType: 1 }, 11: { damageType: 3 }, 20: { damageType: 2 }, 30: { damageType: 0 } } },
      sockets: withSockets ? { data: { 10: sockets(100, undefined, 101), 11: sockets(102), 20: sockets(), 30: sockets(5) } } : undefined,
    },
  } as unknown as DestinyProfileResponse;
}

describe("contributionFromProfile", () => {
  it("keeps every weapon with its plugs by socket, from every bucket, and when they last played", () => {
    expect(contributionFromProfile(profile())).toEqual({
      lastPlayed: "2026-10-18T12:00:00Z",
      contribution: {
        sawAll: true,
        copies: [
          { itemHash: 1, id: BigInt(10), plugs: [100, undefined, 101] },
          { itemHash: 2, id: BigInt(20), plugs: [] },
          { itemHash: 1, id: BigInt(11), plugs: [102] },
        ],
      },
    });
  });

  it("didn't see everything without the vault, the equipment or the sockets", () => {
    expect(contributionFromProfile(profile({ vault: false }))!.contribution.sawAll).toBe(false);
    expect(contributionFromProfile(profile({ equipment: false }))!.contribution.sawAll).toBe(false);
    const read = contributionFromProfile(profile({ withSockets: false }))!.contribution;
    expect(read.sawAll).toBe(false);
    expect(read.copies.map((c) => c.plugs)).toEqual([undefined, undefined, undefined]);
  });

  it("didn't see everything when an item's instance is missing, since it can't tell what that is", () => {
    const read = profile();
    delete (read.itemComponents!.instances!.data as Record<string, unknown>)["30"];
    const { contribution } = contributionFromProfile(read)!;
    expect(contribution.sawAll).toBe(false);
    expect(contribution.copies).toHaveLength(3);
  });

  it("can't tell weapons apart without instances", () => {
    const { itemComponents, ...rest } = profile();
    expect(contributionFromProfile({ ...rest, itemComponents: { ...itemComponents, instances: undefined } } as unknown as DestinyProfileResponse)).toBeUndefined();
  });
});

describe("encodeContribution", () => {
  it("round-trips, empty sockets and missing sockets included", () => {
    const contribution = {
      sawAll: true,
      copies: [
        { itemHash: 4_000_000_000, id: BigInt("6917529000000000001"), plugs: [1, undefined, 4_294_967_295] },
        { itemHash: 2, id: BigInt(3), plugs: undefined },
        { itemHash: 2, id: BigInt(4), plugs: [] },
      ],
    };
    expect(decodeContribution(encodeContribution(contribution))).toEqual(contribution);
    expect(decodeContribution(encodeContribution({ sawAll: false, copies: [] }))).toEqual({ sawAll: false, copies: [] });
  });

  it("refuses a cut-off or unknown one", () => {
    const bytes = encodeContribution({ sawAll: true, copies: [{ itemHash: 1, id: BigInt(1), plugs: [5] }] });
    expect(() => decodeContribution(bytes.subarray(0, bytes.length - 1))).toThrow();
    expect(() => decodeContribution(Uint8Array.of(9, 0, 0, 0, 0, 0))).toThrow("version 9");
  });
});

describe("a signed-in read in the store", () => {
  // Weapon 1 has one column, barrel 100/102; weapon 2 isn't tallied.
  const lookup: PopularityLookup = new Map([[1, [new Map([[100, 100], [102, 102]])]]]);
  const columnsOf = (hash: number) => (hash === 1 ? [{ kind: "Barrel" }] : undefined);
  const run = (generatedAt: string): CrawlSource => ({
    generatedAt,
    from: generatedAt,
    to: generatedAt,
    players: 1,
    rechecked: 0,
    copies: 0,
    vaults: 0,
    sample: { kind: "signed-in" },
    catalog: "0",
  });

  it("is whole, read when it was saved, and drops the copies the player no longer has", () => {
    const savedAt = Date.parse("2026-10-18T13:00:00Z");
    const read = (copies: Parameters<ReturnType<typeof readCollector>["add"]>[1], at: number) => {
      const collected = readCollector(lookup);
      const result = collected.add({ id: BigInt(7), type: 3, played: storeDay(at), readAt: at }, copies, true, true);
      return { result, store: collected.store(at + 3 * 3_600_000, run(new Date(at).toISOString())) };
    };
    const first = read(contributionFromProfile(profile())!.contribution.copies, savedAt);
    expect(first.result).toEqual({ found: 2, whole: true });
    // Read when it was saved, not when the run folded it in; copies seen that day.
    expect(first.store.owners.read[0]).toBe(Math.floor(savedAt / 60_000));
    expect(Array.from(first.store.weapons.get(1)!.seen)).toEqual([storeDay(savedAt), storeDay(savedAt)]);

    // A day later copy 11 is gone (dismantled): the next save drops it.
    const second = read([{ itemHash: 1, id: BigInt(10), plugs: [100] }], savedAt + 86_400_000);
    const merged = mergeCopies(first.store, second.store, columnsOf);
    expect(Array.from(merged.weapons.get(1)!.ids)).toEqual([BigInt(10)]);
  });

  it("doesn't stretch the snapshot's span of reports", () => {
    const at = Date.parse("2026-10-18T13:00:00Z");
    const collected = readCollector(lookup);
    collected.add({ id: BigInt(7), type: 3, played: storeDay(at) }, [{ itemHash: 1, id: BigInt(1), plugs: [100] }], true, true);
    const signedIn = collected.store(at, { ...run("2026-10-18T13:00:00.000Z"), from: "2026-10-05T00:00:00.000Z" });
    const crawled = readCollector(lookup);
    crawled.add({ id: BigInt(8), type: 3, played: storeDay(at) }, [{ itemHash: 1, id: BigInt(2), plugs: [102] }], false, false);
    const crawl = crawled.store(at, {
      ...run("2026-10-18T12:00:00.000Z"),
      from: "2026-10-18T11:30:00Z",
      to: "2026-10-18T11:59:00Z",
      sample: { kind: "recent", minutes: 15 },
    });
    const snapshot = snapshotFromCopies(mergeCopies(crawl, signedIn, columnsOf), columnsOf);
    expect([snapshot.from, snapshot.to, snapshot.weapons["1"]!.copies]).toEqual(["2026-10-18T11:30:00Z", "2026-10-18T11:59:00Z", 2]);
  });

  it("isn't whole when a tallied weapon came without sockets", () => {
    const collected = readCollector(lookup);
    expect(collected.add({ id: BigInt(7), type: 3, played: 1 }, [{ itemHash: 1, id: BigInt(1), plugs: undefined }], true, false)).toEqual({
      found: 0,
      whole: false,
    });
    // Nothing of the tally's and not kept: not recorded.
    expect(collected.players()).toBe(0);
  });
});
