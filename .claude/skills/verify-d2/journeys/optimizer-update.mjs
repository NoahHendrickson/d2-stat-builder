// Optimize on a saved loadout, then "Update loadout" on a build: the optimizer remembers the
// loadout, the build card offers Update instead of Save, and the update keeps the loadout's
// name, notes, weapon and subclass while taking the build's armor. See features/optimizer.md.
const ID = "11111111-1111-4111-8111-111111111111";
const GUNSLINGER = 2240888816;
const KINETIC = 1498876634;
const ARMOR = [3448274439, 3551918588, 14239492, 20886954, 1585787867];

let weaponId;

export const meta = {
  fixture: "full",
  seed: (profile) => {
    const hunter = Object.values(profile.characters.data).find((c) => c.classType === 1).characterId;
    const items = profile.characterEquipment.data[hunter].items;
    const armor = items.filter((i) => ARMOR.includes(i.bucketHash));
    const weapon = items.find((i) => i.bucketHash === KINETIC);
    weaponId = weapon.itemInstanceId;
    return {
      loadouts: [{
        id: ID, createdAt: 1760000000000, updatedAt: 1760000000000, version: 1,
        loadout: {
          id: "dim-11111111", name: "Raid build", notes: "#raid keep these notes", classType: 1,
          equipped: [
            ...armor.map((i) => ({ hash: i.itemHash, id: i.itemInstanceId })),
            { hash: weapon.itemHash, id: weapon.itemInstanceId },
            { hash: GUNSLINGER, id: "12345" },
          ],
          unequipped: [],
          parameters: { mods: [], assumeArmorMasterwork: 3, statConstraints: [{ statHash: 392767087, minStat: 100 }] },
        },
      }],
    };
  },
};

const LINKED = { role: "note", name: /^Linked loadout/ };
const CARD = { role: "button", name: / Health \d+ Melee \d+ Grenade \d+ Super \d+ Class \d+ Weapons \d+/ };

export default async function ({ page, app, stub, step, shot, expect, log }) {
  const settled = async () => {
    await page.waitFor({ role: "progressbar", name: "Search progress" }, { gone: true, timeout: 120000 });
    return page.waitForText(/\b\d[\d,]* \/ [\d,]+\+?|No builds match/, { timeout: 60000 });
  };

  await step("opt-update: Optimize on a loadout opens the optimizer on it", async () => {
    await app.open("/loadouts");
    await page.click({ role: "button", name: "Actions for Raid build" });
    await page.click({ role: "menuitem", name: "Optimize" });
    await page.waitFor(LINKED, { timeout: 60000 });
    expect(/Raid build/.test(await page.text(LINKED)), "the builds column shows it is linked to Raid build");
    expect(await page.exists({ role: "button", name: "Unlink" }, { within: LINKED }), "the strip has Unlink");
    const status = await settled();
    log(`  status: ${status}`);
    expect((await page.count(CARD)) > 0, "build cards are listed");
    await page.hover({ ...CARD, nth: 0 });
    expect(await page.exists({ role: "button", name: "Update loadout", nth: 0 }), "build cards offer Update loadout");
    expect((await page.count({ role: "button", name: "Save as loadout" })) === 0, "no card offers Save as loadout");
    await shot("linked");
  });

  await step("opt-update: the drawer starts from the saved loadout", async () => {
    await page.click({ role: "button", name: "Update loadout", nth: 0 });
    const drawer = { role: "dialog", name: "Update loadout" };
    await page.waitFor(drawer);
    const name = await page.value({ role: "textbox", name: "Loadout name" }, { within: drawer });
    expect(name === "Raid build", `name starts as the loadout's (${name})`);
    const notes = await page.value({ role: "textbox", name: /notes/i }, { within: drawer });
    expect(notes === "#raid keep these notes", `notes start as the loadout's (${notes})`);
    expect(await page.exists({ role: "button", name: "Save as new" }, { within: drawer }), "Save as new is offered");
    await shot("update-drawer", { within: drawer });
    await page.click({ role: "button", name: "Update loadout" }, { within: drawer });
    await page.waitFor(drawer, { gone: true });
    log(`  toast: ${await app.toast(/Loadout updated/)}`);
  });

  await step("opt-update: the PUT keeps the loadout and swaps the armor", async () => {
    expect(!stub.last("POST", "/api/loadouts"), "no new loadout was created");
    const put = stub.last("PUT", `/api/loadouts/${ID}`);
    expect(put?.status === 200, `PUT /api/loadouts/${ID.slice(0, 8)}… answered 200`);
    const { loadout, optimizer } = put.body;
    expect(loadout.name === "Raid build" && loadout.notes === "#raid keep these notes", "name and notes kept");
    expect(loadout.equipped.some((r) => r.id === weaponId), "the kinetic weapon is kept");
    expect(loadout.equipped.some((r) => r.hash === GUNSLINGER), "the Gunslinger subclass is kept");
    const armor = loadout.equipped.filter((r) => r.id !== weaponId && r.hash !== GUNSLINGER);
    log(`  armor ids: ${armor.map((r) => r.id).join(", ")}`);
    expect(armor.length === 5, `five armor refs (${armor.length})`);
    expect(optimizer?.pieceIds?.every((id) => armor.some((r) => r.id === id)), "the armor is the build's");
  });

  await step("opt-update: Loadouts still lists one loadout", async () => {
    await app.nav("/loadouts");
    await page.waitFor({ role: "article", name: "Raid build" });
    const label = await page.waitForText(/\b\d+ Loadouts?\b/i);
    expect(/^1 Loadout\b/i.test(label.trim()) || /\b1 Loadout\b/i.test(label), `count reads ${label}`);
    await shot("loadouts-after");
  });

  await step("opt-update: Unlink goes back to Save as loadout", async () => {
    await app.nav("/");
    await page.waitFor(LINKED);
    await page.click({ role: "button", name: "Unlink" }, { within: LINKED });
    await page.waitFor(LINKED, { gone: true });
    await page.hover({ ...CARD, nth: 0 });
    await page.waitFor({ role: "button", name: "Save as loadout", nth: 0 });
    expect((await page.count({ role: "button", name: "Update loadout" })) === 0, "no card offers Update loadout");
  });
}
