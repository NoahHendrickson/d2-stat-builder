// Saved loadouts (/loadouts): search, edit, equip (apply stream), save in-game, delete one,
// delete all. Two Hunter loadouts are seeded from the fixture's equipped armor. See features/loadouts.md.
export const meta = {
  fixture: "full",
  seed: (profile) => {
    const ARMOR = [3448274439, 3551918588, 14239492, 20886954, 1585787867];
    const hunter = Object.values(profile.characters.data).find((c) => c.classType === 1).characterId;
    const armor = profile.characterEquipment.data[hunter].items.filter((i) => ARMOR.includes(i.bucketHash));
    const row = (id, name, t) => ({
      id, createdAt: t, updatedAt: t, version: 1,
      loadout: { id: `dim-${id.slice(0, 8)}`, name, classType: 1, equipped: armor.map((i) => ({ hash: i.itemHash, id: i.itemInstanceId })), unequipped: [], parameters: { mods: [], assumeArmorMasterwork: 3 } },
    });
    return { loadouts: [row("11111111-1111-4111-8111-111111111111", "Raid build", 1760000000000), row("22222222-2222-4222-8222-222222222222", "Dungeon build", 1760000001000)] };
  },
};

const card = (name) => ({ role: "article", name });

export default async function ({ page, app, stub, step, shot, expect, log }) {
  const countLabel = () => page.waitForText(/\b\d+ of \d+ loadouts\b|\b\d+ Loadouts?\b/i);
  const menu = async (loadout, item) => {
    await page.click({ role: "button", name: `Actions for ${loadout}` });
    await page.click({ role: "menuitem", name: item });
  };
  const lastWrite = (method, path) => stub.requests.filter((r) => r.method === method && r.path.startsWith(path)).at(-1);
  const toast = (rx) => page.waitFor(async () => (await app.toasts()).find((t) => rx.test(t)), { timeout: 30000 });

  await step("open the seeded list", async () => {
    await app.open("/loadouts");
    await page.waitFor(card("Raid build"));
    expect(await page.exists(card("Dungeon build")), "both seeded loadouts are listed");
    expect(/2 Loadouts/i.test(await countLabel()), "count reads 2 Loadouts");
    await shot("list");
  });

  await step("lo-search: the search box filters cards", async () => {
    const box = { role: "searchbox", name: /^Search loadouts/ };
    await page.fill(box, "raid");
    await page.waitFor(card("Dungeon build"), { gone: true });
    expect(await page.exists(card("Raid build")), "Raid build still listed");
    const label = await countLabel();
    expect(/1 of 2 loadouts/i.test(label), `count reads "${label}"`);
    await page.fill(box, "");
    await page.waitFor(card("Dungeon build"));
  });

  await step("lo-edit: renaming in the editor saves and re-renders", async () => {
    await menu("Raid build", "Edit");
    const drawer = { role: "dialog", name: "Edit loadout" };
    await page.waitFor(drawer);
    await page.fill({ role: "textbox", name: "Loadout name" }, "Raid build v2", { within: drawer });
    await page.click({ role: "button", name: "Save changes" }, { within: drawer });
    await toast(/Loadout updated/);
    await page.waitFor(card("Raid build v2"));
    const put = lastWrite("PUT", "/api/loadouts/11111111");
    expect(put?.status === 200 && put.body?.loadout?.name === "Raid build v2", `PUT /api/loadouts/:id carried the new name (${put?.body?.loadout?.name})`);
  });

  await step("lo-equip: Equip streams the apply and reports it applied", async () => {
    await page.click({ role: "button", name: "Equip" }, { within: card("Raid build v2") });
    const done = await page.waitFor(async () => {
      const status = await page.findAll({ role: "status", name: /applied|Couldn't apply|Stopped applying/i });
      if (status.length) return page.name(status[0]);
      return (await app.toasts()).find((t) => /applied/i.test(t));
    }, { timeout: 30000 });
    log(`  apply result: ${done}`);
    expect(/applied/i.test(done) && !/partially|couldn't/i.test(done), "the apply finished cleanly");
    const apply = lastWrite("POST", "/api/bungie/apply-loadout");
    expect(apply?.status === 200, "POST /api/bungie/apply-loadout answered 200 (ndjson)");
    const ids = (apply.body.items ?? []).map((i) => i.itemInstanceId);
    log(`  equipped ids: ${ids.join(", ")}`);
    expect(ids.length >= 5, "the request carried the loadout's armor");
    await shot("applied");
  });

  await step("lo-ingame: Save in-game equips then snapshots into slot 1", async () => {
    // Close the apply card first so it doesn't cover the menu.
    if (await page.exists({ role: "button", name: "Dismiss" })) await page.click({ role: "button", name: "Dismiss" });
    await menu("Raid build v2", "Save in-game");
    const dialog = { role: "dialog", name: "Save to in-game loadout" };
    await page.waitFor(dialog);
    await page.click({ role: "radio", name: /^Slot 1\b/ }, { within: dialog });
    await shot("ingame-dialog", { within: dialog });
    await page.click({ role: "button", name: /^Equip and (save|replace)$/ }, { within: dialog });
    await toast(/Saved to in-game loadout 1/);
    const applies = stub.requests.filter((r) => r.method === "POST" && r.path === "/api/bungie/apply-loadout");
    expect(applies.length === 2, `it equipped first (apply-loadout requests so far: ${applies.length})`);
    const snap = lastWrite("POST", "/api/bungie/ingame-loadouts");
    expect(snap?.body?.loadoutIndex === 0, `POST /api/bungie/ingame-loadouts targeted index 0 (${JSON.stringify(snap?.body)})`);
  });

  await step("lo-delete: Delete asks first, then removes one card", async () => {
    await menu("Dungeon build", "Delete");
    const dialog = { role: "alertdialog", name: "Delete loadout?" };
    const confirm = (await page.exists(dialog)) ? dialog : { role: "dialog", name: "Delete loadout?" };
    await page.waitFor(confirm);
    await page.click({ role: "button", name: "Delete" }, { within: confirm });
    await toast(/Loadout deleted/);
    await page.waitFor(card("Dungeon build"), { gone: true });
    expect(lastWrite("DELETE", "/api/loadouts/22222222")?.status === 200, "DELETE /api/loadouts/:id answered 200");
    expect(!stub.store.loadouts.has("22222222-2222-4222-8222-222222222222"), "the stored row is gone");
  });

  await step("lo-bulk: Delete all loadouts empties the list", async () => {
    await page.click({ role: "button", name: "More loadout actions" });
    await page.click({ role: "menuitem", name: "Delete all loadouts" });
    const confirm = (await page.exists({ role: "alertdialog", name: /^Delete all/ })) ? { role: "alertdialog", name: /^Delete all/ } : { role: "dialog", name: /^Delete all/ };
    await page.waitFor(confirm);
    await page.click({ role: "button", name: "Delete all" }, { within: confirm });
    await page.waitForText(/No saved loadouts yet/);
    const del = lastWrite("DELETE", "/api/loadouts");
    expect(del?.path === "/api/loadouts" && del.body?.all === true, "bulk DELETE /api/loadouts sent {all:true}");
    expect(stub.store.loadouts.size === 0, "the store is empty");
    await shot("empty");
  });
}
