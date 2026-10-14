// Stat optimizer (/): Set bonuses → Legacy raid sets. The fixture has no Armor 2.0 raid
// armor, so this journey adds some to the Hunter's vault: five Deep Stone Crypt pieces
// (every slot), and Vow of the Disciple and Last Wish arms + legs (the same two slots).
// See features/optimizer.md (opt-raid).

/** Hunter Armor 2.0 raid armor from the live manifest (2026-10), by slot. */
const RAID_ARMOR = [
  [893751566, "Legacy's Oath Mask"],
  [2343515647, "Legacy's Oath Grips"],
  [4001862073, "Legacy's Oath Vest"],
  [1264765761, "Legacy's Oath Strides"],
  [1021060724, "Legacy's Oath Cloak"],
  [1583213254, "Resonant Fury Grips"],
  [1566699968, "Resonant Fury Strides"],
  [1127835600, "Grips of the Great Hunt"],
  [1444894250, "Strides of the Great Hunt"],
];

export const meta = {
  fixture: "full",
  profile: (profile) => {
    const statsData = profile.itemComponents.stats.data;
    // A legacy piece: an instance with power and stats, but no gear tier, tuning plugs or
    // archetype socket. Borrow a real piece's stat hashes for the roll.
    const template = Object.values(statsData)[0].stats;
    const statHashes = Object.keys(template);
    const roll = [14, 8, 22, 10, 18, 6];
    RAID_ARMOR.forEach(([itemHash], i) => {
      const id = `raid${i}`;
      profile.profileInventory.data.items.push({
        itemHash,
        itemInstanceId: id,
        bucketHash: 138197802,
        quantity: 1,
        location: 2,
      });
      profile.itemComponents.instances.data[id] = {
        primaryStat: { value: 300 },
        energy: { energyCapacity: 10, energyUsed: 0 },
      };
      statsData[id] = {
        stats: Object.fromEntries(statHashes.map((h, k) => [h, { value: roll[(k + i) % 6] }])),
      };
      profile.itemComponents.sockets.data[id] = { sockets: [] };
    });
    return profile;
  },
};

const CARD = { role: "button", name: / Health \d+ Melee \d+ Grenade \d+ Super \d+ Class \d+ Weapons \d+/ };
const HEADER = { role: "button", name: /^Legacy raid sets \(\d+\)/ };
const strip = (raid) => ({ role: "tablist", name: `${raid} pieces every build must wear` });
const slots = (raid) => ({ role: "list", name: `${raid} pieces owned` });

export default async function ({ page, app, stub, step, shot, expect, log }) {
  const settled = async () => {
    await page.waitFor({ role: "progressbar", name: "Search progress" }, { gone: true, timeout: 120000 });
    return page.waitForText(/\b\d[\d,]* \/ [\d,]+\+?|No builds match/, { timeout: 60000 });
  };
  /** Whether a count tab is disabled (base-ui marks it with data-disabled / aria-disabled). */
  const disabled = async (raid, n) => {
    const tab = { role: "tab", name: n === 0 ? "Not required" : `At least ${n}` };
    const within = { within: strip(raid) };
    return (
      (await page.attr(tab, "data-disabled", within)) !== null ||
      (await page.attr(tab, "aria-disabled", within)) === "true"
    );
  };
  const pick = (raid, n) =>
    page.click({ role: "tab", name: n === 0 ? "Not required" : `At least ${n}` }, { within: strip(raid) });
  /**
   * Per card: how many pieces of `raid` it wears, read from its "<raid> raid armor" pill.
   * Cards are the expandable buttons with stat icons (their names come from the icons' alt).
   */
  const raidPieces = (raid) =>
    page.evalJs(`(() => {
      const cards = [...document.querySelectorAll("button[aria-expanded]")].filter((b) => b.querySelector("[alt=Health]"));
      return JSON.stringify(cards.slice(0, 20).map((c) => {
        const pill = c.querySelector('[title=${JSON.stringify(`${raid} raid armor`)}]');
        return pill ? Number(/(\\d+)pc/.exec(pill.textContent)?.[1] ?? 0) : 0;
      }));
    })()`).then(JSON.parse);

  await step("opt-raid: owned legacy raids are listed with their slots", async () => {
    await app.open("/");
    await settled();
    const header = await page.name(HEADER);
    log(`  header: ${header}`);
    expect(/\(3\)/.test(header), "three legacy raids are listed (Last Wish, Deep Stone Crypt, Vow)");
    await page.click(HEADER);
    await page.waitFor(strip("Deep Stone Crypt"));
    for (const raid of ["Last Wish", "Deep Stone Crypt", "Vow of the Disciple"]) {
      expect(await page.exists(strip(raid)), `${raid} has a count strip`);
    }
    expect(
      await page.exists({ role: "listitem", name: "Arms: Resonant Fury Grips" }, { within: slots("Vow of the Disciple") }),
      "Vow shows its owned arms piece by name",
    );
    expect(
      await page.exists({ role: "listitem", name: "Helmet: not owned" }, { within: slots("Vow of the Disciple") }),
      "Vow shows its missing helmet as not owned",
    );
    expect(await disabled("Vow of the Disciple", 3), "Vow can't ask for 3 (it covers 2 slots)");
    expect(!(await disabled("Deep Stone Crypt", 5)), "Deep Stone Crypt can ask for 5");
    await shot("raids-listed");
  });

  await step("opt-raid: requiring Deep Stone Crypt 3 puts 3 of its pieces in every build", async () => {
    await pick("Deep Stone Crypt", 3);
    expect((await page.attr({ role: "tab", name: "At least 3" }, "aria-selected", { within: strip("Deep Stone Crypt") })) === "true", "3 is selected");
    // The search reruns after a debounce: wait for its end state, then check it held.
    await page.waitFor(async () => {
      const p = await raidPieces("Deep Stone Crypt");
      return p.length > 0 && p.every((n) => n >= 3);
    }, { timeout: 60000 });
    await settled();
    const pieces = await raidPieces("Deep Stone Crypt");
    log(`  Deep Stone Crypt pieces on the first ${pieces.length} cards: ${pieces.join(", ")}`);
    expect(pieces.length > 0 && pieces.every((n) => n >= 3), "every listed build wears at least 3 Deep Stone Crypt pieces");
    expect(/1 required/.test(await page.name(HEADER)), "the header says 1 required");
    await shot("dsc-3");
  });

  await step("opt-raid: counts whose raids share slots are disabled", async () => {
    await pick("Deep Stone Crypt", 0);
    await pick("Vow of the Disciple", 2);
    // Vow 2 takes arms + legs, the only slots Last Wish's pieces cover: 2 + 1 is under
    // five pieces, but can't be worn.
    await page.waitFor(async () => disabled("Last Wish", 1));
    expect(await disabled("Last Wish", 1), "Last Wish 1 is disabled beside Vow 2 (same arms + legs)");
    expect(!(await disabled("Deep Stone Crypt", 3)), "Deep Stone Crypt 3 still fits (helmet, chest, class item)");
    expect(await disabled("Deep Stone Crypt", 4), "Deep Stone Crypt 4 doesn't (only 3 slots left)");
    await shot("shared-slots");
  });

  await step("opt-raid: the pick is saved with a loadout's builder state", async () => {
    await settled();
    await page.hover({ ...CARD, nth: 0 });
    await page.click({ role: "button", name: "Save as loadout", nth: 0 });
    const drawer = { role: "dialog", name: "Save loadout" };
    await page.waitFor(drawer);
    await page.fill({ role: "textbox", name: "Loadout name" }, "raid build", { within: drawer });
    await page.click({ role: "button", name: "Save" }, { within: drawer });
    await page.waitFor(drawer, { gone: true });
    await app.toast(/Loadout saved/);
    const post = stub.last("POST", "/api/loadouts");
    log(`  builder.raidReqs: ${JSON.stringify(post?.body?.builder?.raidReqs)}`);
    expect(post?.status === 201, "POST /api/loadouts answered 201");
    expect(post.body?.builder?.raidReqs?.vow === 2, "the saved builder state requires Vow 2");
  });

  await step("opt-raid: Theoretical Builds hides the block", async () => {
    await page.click({ role: "tab", name: "Theoretical Builds" });
    await page.waitFor(HEADER, { gone: true });
    expect(!(await page.exists(HEADER)), "no Legacy raid sets on Theoretical Builds");
    await page.click({ role: "tab", name: "Builds" });
    await page.waitFor(HEADER);
    expect(/1 required/.test(await page.name(HEADER)), "back on Builds, Vow is still required");
  });
}
