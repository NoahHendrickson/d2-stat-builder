// Farm list (/farm-list, plus the button under the perk grid on /weapons): a seeded entry
// whose drop is in the vault turns obtained on load, a new roll is added, an owned roll
// says so instead of offering to add, craftable weapons get no button, and "Not this one" sends a drop
// back to waiting. Armor comes from Theoretical and Dream builds and drops the same way.
// See features/farm-list.md.
export const meta = {
  fixture: "full",
  // Two Synanceia copies in the vault, with numeric instance ids (the Farm list ignores
  // the fixture's `instN` ones): Relentless Strikes + Surrounded, and Attrition Orbs +
  // Burning Ambition. Sockets: blade, guard, left, right.
  profile: (profile) => {
    const r = profile.Response ?? profile;
    r.responseMintedTimestamp = new Date().toISOString();
    const copy = (id, plugs) => {
      r.profileInventory.data.items.push({ itemHash: SYNANCEIA, itemInstanceId: id, bucketHash: 138197802, quantity: 1, location: 2, state: 0 });
      r.itemComponents.instances.data[id] = { damageType: 3, primaryStat: { statHash: 1480404414, value: 10 }, itemLevel: 1, quality: 0, isEquipped: false, canEquip: true, equipRequiredLevel: 0, unlockHashesRequiredToEquip: [], cannotEquipReason: 0 };
      r.itemComponents.sockets.data[id] = { sockets: plugs.map((plugHash) => ({ plugHash, isEnabled: true, isVisible: true })) };
      r.itemComponents.reusablePlugs.data[id] = { plugs: Object.fromEntries(plugs.map((h, i) => [i, [{ plugItemHash: h, canInsert: true, enabled: true }]])) };
    };
    copy(MATCH_COPY, [HUNGRY_EDGE, BALANCED_GUARD, RELENTLESS, SURROUNDED]);
    copy(OWNED_COPY, [HUNGRY_EDGE, BALANCED_GUARD, ATTRITION, BURNING]);
    // Armor gets numeric ids too, for the same reason.
    const held = [r.profileInventory.data, ...Object.values(r.characterInventories.data), ...Object.values(r.characterEquipment.data)];
    const armorIds = new Set(held.flatMap((inv) => inv.items).filter((i) => ARMOR_BUCKETS.has(i.bucketHash) && /^inst\d+$/.test(i.itemInstanceId ?? "")).map((i) => i.itemInstanceId));
    const out = JSON.parse(JSON.stringify(profile).replace(/"inst(\d+)"/g, (m, n) => (armorIds.has(`inst${n}`) ? `"69175291${n.padStart(8, "0")}"` : m)));
    // Fixture armor has no sockets, so no archetype: make the Hunter's own armor Brawler.
    const o = out.Response ?? out;
    const [hunter] = Object.entries(o.characters.data).find(([, c]) => c.classType === 1);
    for (const item of [...o.characterEquipment.data[hunter].items, ...o.characterInventories.data[hunter].items]) {
      if (!ARMOR_BUCKETS.has(item.bucketHash) || !/^\d+$/.test(item.itemInstanceId ?? "")) continue;
      o.itemComponents.sockets.data[item.itemInstanceId] = { sockets: [{ plugHash: BRAWLER, isEnabled: true, isVisible: true }] };
    }
    return out;
  },
  seed: () => ({
    farmList: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        createdAt: Date.parse("2026-10-20T12:00:00Z"),
        kind: "weapon",
        version: 1,
        weaponHash: SYNANCEIA,
        weaponName: "Synanceia",
        weaponIcon: "/common/destiny2_content/icons/ce20ef1bf74d608b33a31b6863b3bf0b.jpg",
        weaponHashes: [SYNANCEIA],
        traits: [perk("Trait", "Relentless Strikes", RELENTLESS, 4085959009, "ad4bb4c9e36674ca879310b733a6e6a3.png"), perk("Trait", "Surrounded", SURROUNDED, 781192741, "979881b68ca7839267c9aef5aea2b0ce.png")],
        // The copy has Hungry Edge (✓) and no masterwork (✗: it doesn't stop a match). No
        // magazine or origin trait asked for: those columns read Any.
        extras: [
          perk("Blade", "Hungry Edge", HUNGRY_EDGE, 1498024248, "974bb52d2a830e83bb142699b31e567c.png", "barrel"),
          perk("Masterwork", "Impact Masterwork", 3486498337, undefined, "672543a43bddce9886b5daa338fcd39a.jpg", "masterwork"),
        ],
        ignoredInstanceIds: [],
      },
      {
        // The same two perks, but a magazine the copy doesn't have: it has to keep waiting.
        id: "33333333-3333-4333-8333-333333333333",
        createdAt: Date.parse("2026-10-20T13:00:00Z"),
        kind: "weapon",
        version: 1,
        weaponHash: SYNANCEIA,
        weaponName: "Synanceia",
        weaponHashes: [SYNANCEIA],
        traits: [perk("Trait", "Relentless Strikes", RELENTLESS, 4085959009, "ad4bb4c9e36674ca879310b733a6e6a3.png"), perk("Trait", "Surrounded", SURROUNDED, 781192741, "979881b68ca7839267c9aef5aea2b0ce.png")],
        extras: [perk("Guard", "Burst Guard", 3625355092, 3923000764, "d182dd5e1da7a10583dfb9f65ff026bc.png", "magazine")],
        ignoredInstanceIds: [],
      },
      {
        // A new drop that was dismantled before it was kept: it should come off the list.
        id: "55555555-5555-4555-8555-555555555555",
        createdAt: Date.parse("2026-10-22T12:00:00Z"),
        kind: "weapon",
        version: 1,
        weaponHash: SYNANCEIA,
        weaponName: "Synanceia",
        weaponHashes: [SYNANCEIA],
        traits: [perk("Trait", "Attrition Orbs", ATTRITION, undefined, "ad4bb4c9e36674ca879310b733a6e6a3.png"), perk("Trait", "Surrounded", SURROUNDED, undefined, "979881b68ca7839267c9aef5aea2b0ce.png")],
        extras: [],
        ignoredInstanceIds: [],
        obtained: { instanceId: "99", at: Date.parse("2026-10-23T12:00:00Z"), seen: true },
      },
      {
        // The same, but kept with Done: a record stays, and its perks still read blue.
        id: "66666666-6666-4666-8666-666666666666",
        createdAt: Date.parse("2026-10-22T13:00:00Z"),
        kind: "weapon",
        version: 1,
        weaponHash: SYNANCEIA,
        weaponName: "Synanceia",
        weaponHashes: [SYNANCEIA],
        traits: [perk("Trait", "Burning Ambition", BURNING, undefined, "979881b68ca7839267c9aef5aea2b0ce.png"), perk("Trait", "Surrounded", SURROUNDED, undefined, "979881b68ca7839267c9aef5aea2b0ce.png")],
        extras: [],
        ignoredInstanceIds: [],
        obtained: { instanceId: "98", at: Date.parse("2026-10-23T12:00:00Z"), seen: true, doneAt: Date.parse("2026-10-24T12:00:00Z") },
      },
      {
        // A piece from a required set: its card shows that set's Gauntlets, not a stat glyph.
        id: "44444444-4444-4444-8444-444444444444",
        createdAt: Date.parse("2026-10-21T13:00:00Z"),
        kind: "armor",
        version: 1,
        classType: 1,
        slot: "arms",
        archetype: "Grenadier",
        primary: 2,
        secondary: 3,
        rolls: [{ tertiary: 0, tuned: [5] }],
        setHash: 1223381128,
        setName: "AION Renewal",
        ignoredInstanceIds: [],
      },
      {
        // A Hunter's Brawler helmet from TM Custom, whatever its tertiary or tuned stat.
        id: "22222222-2222-4222-8222-222222222222",
        createdAt: Date.parse("2026-10-21T12:00:00Z"),
        kind: "armor",
        version: 1,
        classType: 1,
        slot: "helmet",
        archetype: "Brawler",
        primary: 1,
        secondary: 0,
        rolls: [0, 1, 2, 3, 4, 5].map((tertiary) => ({ tertiary, tuned: null })),
        setHash: 1523985791,
        setName: "TM Custom",
        ignoredInstanceIds: [],
      },
    ],
  }),
};

const ARMOR_BUCKETS = new Set([3448274439, 3551918588, 14239492, 20886954, 1585787867]);
const BRAWLER = 3349393475;
const SYNANCEIA = 2765451288;
const MATCH_COPY = "6917529000000000001";
const OWNED_COPY = "6917529000000000002";
const HUNGRY_EDGE = 436053704;
const BALANCED_GUARD = 52780822;
const RELENTLESS = 1749209109;
const SURROUNDED = 3708227201;
const ATTRITION = 243981275;
const BURNING = 2890807135;
function perk(kind, name, hash, enhanced, icon, slot) {
  return { kind, name, icon: `/common/destiny2_content/icons/${icon}`, ...(slot ? { slot } : {}), hashes: enhanced ? [hash, enhanced] : [hash] };
}

const LIST = { role: "list", name: "Weapons" };
const DETAILS = { role: "complementary", name: "Weapon details" };
const PERKS = { role: "region", name: "Perks" };

export default async function ({ page, app, stub, step, shot, expect, log }) {
  const open = async (name) => {
    await page.fill({ role: "combobox", name: "Search weapons" }, name);
    await page.click({ role: "button", name: `View ${name} perks`, nth: 0 }, { within: LIST });
    await page.waitFor({ role: "heading", name }, { within: DETAILS });
    await page.waitFor(PERKS, { within: DETAILS });
  };
  // Click a perk tile in the grid and wait for it to read pressed (or not).
  const press = async (name, pressed) => {
    const [tile] = await page.findAll({ role: "button", name }, { within: PERKS });
    if (!tile) throw new Error(`no perk tile "${name}"`);
    await page.click(tile);
    await page.waitFor(async () => (await page.attr(tile, "aria-pressed")) === String(pressed), { timeout: 5000 });
  };
  const pick = (name) => press(name, true);
  const unpick = (name) => press(name, false);

  await step("entry-drop: a waiting entry with a matching copy in the vault turns obtained on load", async () => {
    // The toast lasts 5 s and the catalog can take longer in dev: watch for it from the
    // navigation on, then wait for the page.
    await page.goto(app.url + "/weapons");
    const toast = await app.toast(/Farm list: Synanceia dropped/);
    await page.waitFor({ css: '[aria-label="Weapons"] [role=listitem]' }, { timeout: 120000 });
    log(`  toast: ${JSON.stringify(toast)}`);
    const patch = stub.last("PATCH", "/api/farm-list/11111111");
    expect(patch?.body?.obtained === MATCH_COPY, "PATCH carried the matching copy's instance id");
    const armor = await app.toast(/Farm list: Brawler Helmet dropped/);
    log(`  toast: ${JSON.stringify(armor)}`);
    await page.waitFor(() => /^\d+$/.test(stub.last("PATCH", "/api/farm-list/22222222")?.body?.obtained ?? ""));
    expect(true, "the armor drop PATCHed its numeric instance id");
    await page.waitFor({ role: "link", name: "Farm list (2 new)" });
    expect(!stub.last("PATCH", "/api/farm-list/33333333"), "the entry asking for a magazine the copy lacks keeps waiting");
    await page.waitFor(() => stub.last("DELETE", "/api/farm-list/55555555") !== undefined);
    expect(stub.store.entries.has("66666666-6666-4666-8666-666666666666"), "a kept record survives its copy being dismantled");
    expect(!stub.last("DELETE", "/api/farm-list/66666666"), "and is never deleted");
    await shot("drop-toast");
  });

  await step("entry-add: an existing entry shows as on the list; a new pair is added", async () => {
    await open("Synanceia");
    expect(!(await page.exists({ role: "button", name: /Farm list/i }, { within: PERKS })), "no button before both traits are picked");
    await pick("Relentless Strikes");
    await pick("Surrounded");
    await page.waitFor({ role: "button", name: "Add to Farm list" }, { within: PERKS });
    await pick("Hungry Edge");
    await page.waitFor({ role: "button", name: "On your Farm list" }, { within: PERKS });
    await unpick("Hungry Edge");
    await unpick("Relentless Strikes");
    await pick("Proximity Power");
    const posts = stub.requests.filter((r) => r.method === "POST" && r.path === "/api/farm-list").length;
    await page.click({ role: "button", name: "Add to Farm list" }, { within: PERKS });
    await page.waitFor({ role: "button", name: "On your Farm list" }, { within: PERKS });
    const post = stub.last("POST", "/api/farm-list");
    expect(stub.requests.filter((r) => r.method === "POST" && r.path === "/api/farm-list").length === posts + 1, "one POST");
    expect(post.body.traits.map((t) => t.name).join("+") === "Proximity Power+Surrounded", "POST carried both traits");
    expect(post.body.ignoredInstanceIds.length === 0, "nothing ignored: no copy owned");
    await shot("added", { within: DETAILS });
  });

  await step("entry-owned: an owned roll says so in place of the add button", async () => {
    await unpick("Proximity Power");
    await unpick("Surrounded");
    await pick("Attrition Orbs");
    await pick("Burning Ambition");
    await page.click({ role: "button", name: "Add to Farm list" }, { within: PERKS });
    await page.waitForText(/You already have this roll\./, { within: PERKS });
    await shot("owned", { within: DETAILS });
    expect(!(await page.exists({ role: "button", name: /Add/i }, { within: PERKS })), "no way to add a roll already owned");
  });

  await step("entry-strict: a picked magazine the copy doesn't have is a new roll, with no owned prompt", async () => {
    await pick("Burst Guard");
    await page.waitFor({ role: "button", name: "Add to Farm list" }, { within: PERKS });
    await page.click({ role: "button", name: "Add to Farm list" }, { within: PERKS });
    await page.waitFor({ role: "button", name: "On your Farm list" }, { within: PERKS });
    const post = stub.last("POST", "/api/farm-list");
    expect(post.body.extras.some((e) => e.name === "Burst Guard"), "the magazine went with it");
    expect(post.body.ignoredInstanceIds.length === 0, "the copy with both perks but another magazine wasn't treated as owned");
  });

  await step("entry-craftable: a craftable weapon has no Farm list button", async () => {
    await open("Fatebringer");
    await pick("Explosive Payload");
    await pick("Adrenaline Junkie");
    expect(!(await page.exists({ role: "button", name: /Farm list/i }, { within: PERKS })), "no button on Fatebringer");
  });

  await step("entry-page: a table row per entry, obtained first, each perk column marked; Not this one sends it back", async () => {
    // app.nav looks for the plain name; with a drop unseen the link reads "Farm list (1 new)".
    await page.click({ role: "link", name: "Farm list (2 new)" }, { within: { role: "navigation", name: "Main" } });
    await page.waitFor({ css: 'section[aria-label="Armor"]' });
    const OBTAINED = 'section[aria-label="Weapons"] [data-group="dropped"]';
    const WAITING = 'section[aria-label="Weapons"] [data-group="waiting"]';
    const cell = (column) => ({ css: `${OBTAINED} [data-column="${column}"]` });
    await page.waitForText(/Dropped .* in your Vault/, { within: { css: OBTAINED } });
    // The barrel column waits on the manifest to name what the copy rolled.
    await page.waitFor({ role: "image", name: "Matches" }, { within: cell("barrel") });
    for (const column of ["left", "right"])
      expect(await page.exists({ role: "image", name: "Matches" }, { within: cell(column) }), `${column} perk matches`);
    const magazine = await page.text(cell("magazine"));
    expect(/Balanced Guard/.test(magazine) && !(await page.exists({ role: "image", name: "Matches" }, { within: cell("magazine") })), "no magazine asked for: just what the copy rolled");
    expect(await page.exists({ role: "image", name: "Doesn't match" }, { within: cell("masterwork") }), "Impact Masterwork doesn't match");
    expect(!(await page.exists(cell("origin"))), "no origin trait asked for or rolled: no field for it");
    expect((await page.findAll({ css: `${WAITING} [data-entry]` })).length === 3, "three waiting entries");
    expect(stub.last("PATCH", "/api/farm-list")?.body?.seen === true, "opening the page marked drops seen");
    await page.waitFor({ role: "link", name: "Farm list" });
    const record = { css: '[data-entry="66666666-6666-4666-8666-666666666666"]' };
    expect((await page.count({ role: "image", name: "Matches" }, { within: record })) === 2, "a record with its copy gone still shows its perks in blue");
    await shot("page");
    await page.click({ role: "button", name: "Not this one" }, { within: { css: OBTAINED } });
    await page.waitFor({ css: OBTAINED }, { gone: true });
    expect(stub.last("PATCH", "/api/farm-list/11111111")?.body?.reject === true, "PATCH sent reject");
    expect(stub.store.entries.get("11111111-1111-4111-8111-111111111111").ignoredInstanceIds.join() === MATCH_COPY, "the copy is ignored now");
    expect((await page.findAll({ css: `${WAITING} [data-entry]` })).length === 4, "four waiting entries");
    await shot("rejected");
  });

  const armorPosts = () => stub.requests.filter((r) => r.method === "POST" && r.path === "/api/farm-list" && r.body?.kind === "armor");
  const ADD_ROW = { role: "button", name: /^Add .* to your Farm list$/ };

  // Clicks an add button and returns what it POSTed.
  const addArmor = async (target, within) => {
    const before = armorPosts().length;
    await page.click(target, within ? { within } : undefined);
    await page.waitFor(() => armorPosts().length > before);
    return { body: armorPosts().at(-1).body };
  };

  await step("armor-theory: only a piece of a required set can be added", async () => {
    await app.nav("/");
    await page.click({ role: "tab", name: "Theoretical Builds" });
    await page.fill({ role: "spinbutton", name: "Health target value" }, "100");
    await page.press("Enter");
    await page.waitForText(/What to farm/i, { timeout: 60000 });
    expect(!(await page.exists({ ...ADD_ROW, nth: 0 })), "no set picked: nothing to add");
    await page.click({ role: "checkbox", name: /^Require /, nth: 0 });
    await page.waitFor({ ...ADD_ROW, nth: 0 }, { timeout: 60000 });
    await shot("theory-rows");
    const first = await addArmor({ ...ADD_ROW, nth: 0 });
    expect(first.body.ignoredInstanceIds.length === 0, "nothing ignored when added");
    expect(typeof first.body.setHash === "number", "it names its set");
    expect(typeof first.body.slot === "string", "and its slot");
    const OFF = { role: "button", name: /^Remove .* from your Farm list$/ };
    await page.waitFor({ ...OFF, nth: 0 });
    const second = await addArmor({ ...ADD_ROW, nth: 0 });
    expect(second.body.setHash === first.body.setHash, "the other piece is from the same set");
    await shot("theory-added");
  });

  await step("armor-dream: a replacement outside a required set has no button; one inside goes on the list", async () => {
    await page.click({ role: "tab", name: "Builds" });
    const dialog = { role: "dialog", name: "Dream build" };
    const search = { role: "progressbar", name: "Dream build search" };
    const idle = () => page.waitFor(async () => (await page.attr(search, "aria-busy", { within: dialog })) === "false", { timeout: 60000 });
    const ADD = { role: "button", name: "Add to Farm list", nth: 0 };
    const set = async (name, value) => {
      await page.fill({ role: "spinbutton", name: `${name} target value` }, String(value), { within: dialog });
      await page.press("Enter");
    };
    const raise = async (found) => {
      const health = Number(await page.value({ role: "spinbutton", name: "Health target value" }, { within: dialog }));
      await set("Melee", 40);
      for (const up of [30, 40, 50, 60]) {
        await set("Health", health + up);
        await page.waitForText(/\d+ new pieces?|Out of reach/, { within: dialog, timeout: 30000 });
        await idle();
        if (await found()) return true;
      }
      return false;
    };
    await page.click({ role: "button", name: "Dream build", nth: 0 });
    await page.waitFor(dialog);
    await idle();
    await raise(() => page.exists({ role: "button", name: /→/, nth: 0 }, { within: dialog }));
    await page.waitForText(/Replace/i, { within: dialog });
    expect(!(await page.exists(ADD, { within: dialog })), "no set required: a replacement can't be added");
    await page.click({ role: "button", name: "Close dialog" }, { within: dialog });
    await page.waitFor(dialog, { gone: true });

    // Require the first set the Hunter can make, and look through the ways there.
    const SET = { role: "checkbox", name: /^Require / };
    for (let nth = 0; nth < (await page.count(SET)); nth++) {
      if ((await page.attr({ ...SET, nth }, "aria-disabled")) === "true") continue;
      await page.click({ ...SET, nth });
      break;
    }
    await page.waitFor({ role: "button", name: "Dream build", nth: 0 }, { timeout: 60000 });
    await page.click({ role: "button", name: "Dream build", nth: 0 });
    await page.waitFor(dialog);
    await idle();
    const inSet = async () => {
      if (await page.exists(ADD, { within: dialog })) return true;
      const ways = { role: "button", name: /→/ };
      for (let nth = 0; nth < (await page.count(ways, { within: dialog })); nth++) {
        await page.click({ ...ways, nth }, { within: dialog });
        if (await page.exists(ADD, { within: dialog })) return true;
      }
      return false;
    };
    expect(await raise(inSet), "a replacement inside the set offers Add to Farm list");
    const { body } = await addArmor(ADD, dialog);
    await page.waitFor({ role: "button", name: "On your Farm list", nth: 0 }, { within: dialog });
    log(`  posted: ${JSON.stringify({ slot: body.slot, archetype: body.archetype, setHash: body.setHash, rolls: body.rolls })}`);
    expect(typeof body.setHash === "number" && typeof body.slot === "string", "it names its slot and set");
    await shot("dream-added", { within: dialog });
    await page.click({ role: "button", name: "Close dialog" }, { within: dialog });
    await page.waitFor(dialog, { gone: true });
  });

  await step("armor-page: the added pieces show in the Armor table", async () => {
    await page.click({ role: "link", name: "Farm list" }, { within: { role: "navigation", name: "Main" } });
    const ROWS = { css: 'section[aria-label="Armor"] [data-group="waiting"] [data-entry]' };
    await page.waitFor(ROWS, { nth: 3, timeout: 15000 });
    expect((await page.count(ROWS)) === 4, "four waiting armor rows");
    expect(await page.exists({ css: 'section[aria-label="Weapons"]' }), "the Weapons table is still there");
    expect(/Any/i.test(await page.text({ css: 'section[aria-label="Armor"]' })), "something reads Any (a roll that takes any tuning)");
    const setCard = '[data-entry="44444444-4444-4444-8444-444444444444"] img[src*="e9593ee50c0adc61bfc1491cf65c6b9b"]';
    await page.waitFor({ css: setCard }, { timeout: 15000 });
    expect(await page.exists({ css: setCard }), "a required set's card shows that set's piece for the slot");
    const obtainedRow = { css: 'section[aria-label="Armor"] [data-group="dropped"]' };
    const dropped = await page.text(obtainedRow);
    log(`  obtained: ${dropped.replace(/\s+/g, " ")}`);
    expect(/Dropped \w+ \d+/.test(dropped) && !/on your Hunter|in your Vault/.test(dropped), "the seeded armor drop shows its date, not the copy's name or place");
    await shot("page-armor");
    await page.click({ role: "button", name: "Remove", nth: 0 }, { within: { css: 'section[aria-label="Armor"]' } });
    await page.waitFor(async () => (await page.count(ROWS)) === 3);
    expect(stub.last("DELETE", "/api/farm-list/") !== undefined, "Remove sent a DELETE");
  });

  await step("armor-done: Done keeps a drop as a record, and the header filter narrows the list", async () => {
    const ARMOR = { css: 'section[aria-label="Armor"]' };
    const group = (name) => ({ css: `section[aria-label="Armor"] [data-group="${name}"]` });
    await page.click({ role: "button", name: "Done" }, { within: ARMOR });
    await page.waitFor(group("obtained"));
    expect(stub.last("PATCH", "/api/farm-list/22222222")?.body?.done === true, "PATCH sent done");
    expect(!(await page.exists(group("dropped"))), "it left the new drops");
    expect(/Dropped \w+ \d+/.test(await page.text(group("obtained"))), "the record still says when it dropped");
    expect(stub.store.entries.has("22222222-2222-4222-8222-222222222222"), "the entry was kept");
    expect(!(await page.exists({ role: "button", name: "Not this one" }, { within: group("obtained") })), "a record can only be removed");
    await shot("armor-kept");
    const STRIP = { role: "button", name: /^Waiting/i };
    const cards = { css: 'section[aria-label="Armor"] [data-group="waiting"] [data-entry]' };
    expect((await page.attr(STRIP, "aria-expanded", { within: ARMOR })) === "true", "a group starts open");
    await page.click(STRIP, { within: ARMOR });
    await page.waitFor(cards, { gone: true });
    expect((await page.attr(STRIP, "aria-expanded", { within: ARMOR })) === "false", "its strip closes it");
    await shot("armor-collapsed");
    await page.click(STRIP, { within: ARMOR });
    await page.waitFor({ ...cards, nth: 0 });
    await page.click({ role: "tab", name: "Waiting" }, { within: ARMOR });
    await page.waitFor(group("obtained"), { gone: true });
    expect(await page.exists(group("waiting")), "Waiting shows what's left to farm");
    await page.click({ role: "tab", name: "Obtained" }, { within: ARMOR });
    await page.waitFor(group("waiting"), { gone: true });
    expect(await page.exists(group("obtained")), "Obtained shows the record");
    await shot("armor-filtered");
    log(await page.evalJs(`[...document.querySelectorAll("section[aria-label=Armor] [data-entry]")].map(r => r.innerText.replace(/\\s+/g, " ")).join(" // ")`));
  });
}
