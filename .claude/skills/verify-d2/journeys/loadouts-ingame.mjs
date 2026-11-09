// Loadouts > In-game tab: the character's slots, building an activity set on the page, and
// saving the current slots as a set. Seed matches loadouts.mjs. See features/loadouts.md.
import { meta as loadoutsMeta } from "./loadouts.mjs";

export const meta = loadoutsMeta;

export default async function ({ page, app, stub, step, shot, expect }) {
  const lastSets = () => stub.last("PUT", "/api/settings/activitySets")?.body?.value;

  await step("lo-ingame-tab: the In-game tab shows the character's slots", async () => {
    await app.open("/loadouts");
    await page.click({ role: "tab", name: "In-game" });
    await page.waitFor({ role: "radio", name: "Slot 2, Dungeon" });
    expect(await page.exists({ role: "radio", name: "Slot 1, Empty" }), "empty slots are in the grid too");
    expect(
      (await page.evalJs("location.search")) === "?view=in-game",
      "the tab is in the URL",
    );
    await shot("in-game-now");

    await page.click({ role: "radio", name: "Slot 2, Dungeon" });
    const detail = { role: "article", name: "Slot 2, Dungeon" };
    await page.waitFor(detail);
    for (const name of ["Edit", "Replace", "Copy to Conflux", "Delete Dungeon from the game"]) {
      expect(await page.exists({ role: "button", name }, { within: detail }), `the slot offers ${name}`);
    }
    await shot("slot-detail");

    await page.evalJs("location.reload()");
    await page.waitFor({ role: "radio", name: "Slot 2, Dungeon" });
    expect(await page.attr({ role: "tab", name: "In-game" }, "aria-selected") === "true", "a reload stays on the tab");
  });

  await step("lo-set-build: a set is built on the page and syncs", async () => {
    await page.click({ role: "button", name: "New activity set" });
    const save = { role: "button", name: "Save set" };
    await page.waitFor(save);
    const saveDisabled = async () => (await page.attr(save, "disabled")) !== null;
    await page.waitForText(/Name this set to save it/);
    const nameField = { role: "textbox", name: "Set name" };
    expect(
      (await page.evalJs("document.activeElement?.getAttribute('aria-label')")) === "Set name",
      "a new set puts the cursor in its name",
    );
    expect((await page.attr(nameField, "aria-invalid")) === null, "the name isn't red before Save is tried");
    await page.click(save);
    await page.waitFor(async () => (await page.attr(nameField, "aria-invalid")) === "true");
    expect(!lastSets(), "an unnamed set isn't saved");
    await shot("name-missing");
    expect(await page.attr({ role: "radio", name: /^Slot 1, Empty/i }, "aria-checked") === "true", "a new set opens on slot 1");
    expect((await page.count({ role: "radio" })) === 10, "only the open set shows a grid");
    expect(
      await page.evalJs(`!document.querySelector('[role=radio][aria-label^="Slot 2, Dungeon: not assigned"] img')`),
      "a slot the set leaves alone is empty, even with gear there in-game",
    );
    await page.fill(nameField, "Raid");
    await page.waitForText(/Add a loadout to save it/);
    expect((await page.attr(nameField, "aria-invalid")) === null, "typing a name clears the red");
    expect(await saveDisabled(), "a named set still needs a loadout");
    await page.click({ role: "radio", name: /^Slot 1, Empty/i });
    expect(
      (await page.attr({ role: "button", name: /^Copy what's in this slot/ }, "disabled")) !== null,
      "a slot that's empty in-game has nothing to copy",
    );
    await page.click({ role: "button", name: /^Assign a loadout from Conflux/ });
    await page.click({ role: "option", name: "Raid build" });
    await page.waitFor({ role: "radio", name: /^Slot 1, Empty: Raid build/i });
    await page.waitFor({ role: "article", name: "Raid build" });
    expect(
      await page.evalJs(`!!document.querySelector('[role=radio][aria-label^="Slot 1, Empty: Raid build"] img')`),
      "an assigned slot gets an emblem, even if it's empty in-game",
    );
    expect(!lastSets(), "nothing is stored before Save");
    expect(!(await saveDisabled()), "a named set with a loadout can be saved");
    const apply = { role: "button", name: "Apply in-game" };
    expect(!(await page.exists(apply)), "no Apply while unsaved");
    await shot("set-unsaved");

    await page.click({ role: "button", name: "In the game now" });
    const ask = { role: "dialog", name: "Discard unsaved changes?" };
    await page.waitFor(ask);
    await page.press("Escape");
    await page.waitFor(ask, { gone: true });
    expect(await page.exists(save), "cancelling keeps the draft");
    expect(await page.exists({ css: ".d2-attention" }), "staying points at Save");

    await page.click({ role: "link", name: "Stat optimizer" });
    await page.waitFor(ask);
    await page.press("Escape");
    await page.waitFor(ask, { gone: true });
    expect((await page.evalJs("location.pathname")) === "/loadouts", "a sidebar link waits for an answer");

    await page.click({ role: "tab", name: "Conflux" });
    await page.waitFor(ask);
    await page.press("Escape");
    await page.waitFor(ask, { gone: true });
    expect((await page.attr({ role: "tab", name: "In-game" }, "aria-selected")) === "true", "the tabs wait for an answer");
    expect(
      await page.evalJs("(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; })()"),
      "the browser warns before a reload",
    );

    await page.click(save);
    await app.toast(/Raid saved/);
    await page.waitFor(() => lastSets()?.[0]?.slots?.length === 1);
    expect(lastSets()[0].name === "Raid", `the synced set is named Raid (${lastSets()[0].name})`);
    expect(lastSets()[0].slots[0].index === 0, "slot 1 is assigned");
    await page.waitFor(apply);
    expect(!(await page.exists(save)), "Save gives way to Apply in-game");
    await shot("set-built");

    await page.click({ role: "button", name: "Rename Raid" });
    await page.fill(nameField, "Raid night");
    await page.press("Enter");
    await page.waitFor(() => lastSets()?.[0]?.name === "Raid night");
    await page.waitFor({ role: "button", name: "Rename Raid night" });
    expect(!(await page.exists(save)), "renaming saves at once");

    await page.click({ role: "button", name: "Edit" });
    await page.waitFor({ role: "dialog", name: "Edit loadout" });
    await page.press("Escape");
    await page.waitFor({ role: "dialog", name: "Edit loadout" }, { gone: true });
  });

  await step("lo-set-labels: a set picks each slot's name, icon and color", async () => {
    await page.click({ role: "button", name: "Customize slot 1" });
    const dialog = { role: "dialog", name: "Customize slot 1" };
    await page.waitFor(dialog);
    await page.click({ role: "combobox", name: "Name" }, { within: dialog });
    await page.click({ role: "option", name: "Dungeon" });
    await page.click({ role: "radio", name: "Icon 2" }, { within: dialog });
    await page.click({ role: "radio", name: "Color 2" }, { within: dialog });
    await shot("set-slot-customize", { within: dialog });
    await page.click({ role: "button", name: "Save" }, { within: dialog });
    await page.waitFor(dialog, { gone: true });
    await page.waitForText(/Slot 1, Dungeon/);
    const save = { role: "button", name: "Save changes" };
    await page.waitFor(save);
    expect(!lastSets()[0].slots[0].labels, "nothing is stored before Save");
    await page.click(save);
    await app.toast(/saved/);
    await page.waitFor(() => lastSets()[0].slots[0].labels?.iconHash === 202);
    expect(
      JSON.stringify(lastSets()[0].slots[0].labels) === JSON.stringify({ nameHash: 102, iconHash: 202, colorHash: 302 }),
      `the set stored the labels (${JSON.stringify(lastSets()[0].slots[0].labels)})`,
    );
    await shot("set-slot-customized");

    await page.click({ role: "button", name: "Apply in-game" });
    const confirm = { role: "dialog", name: /^Apply .* to the game\?$/ };
    await page.waitFor(confirm);
    await page.click({ role: "button", name: "Apply in-game" }, { within: confirm });
    await page.waitFor(() => stub.last("POST", "/api/bungie/ingame-loadouts"), { timeout: 30000 });
    const snapshot = stub.last("POST", "/api/bungie/ingame-loadouts").body;
    expect(
      snapshot.loadoutIndex === 0 && snapshot.nameHash === 102 && snapshot.iconHash === 202 && snapshot.colorHash === 302,
      `applying saved the slot with those labels (${JSON.stringify(snapshot)})`,
    );
  });

  await step("lo-set-from-slots: Save as set copies the filled slots", async () => {
    await page.click({ role: "button", name: "In the game now" });
    await page.click({ role: "button", name: "Save as set" });
    expect(!(await page.exists({ role: "dialog", name: "Save these slots as a set" })), "no dialog: the new set opens straight away");
    await page.waitFor({ role: "radio", name: /^Slot 3, Crucible: Crucible/i });
    expect(stub.requests.filter((r) => r.method === "POST" && r.path === "/api/loadouts").length === 0, "nothing is stored before Save");

    await page.hover({ role: "radio", name: /^Slot 3, Crucible: Crucible/i });
    await page.click({ role: "button", name: "Exclude slot 3" });
    await page.waitFor({ role: "radio", name: /^Slot 3, Crucible: not assigned/i });
    await shot("set-from-slots-trimmed");
    await page.hover({ role: "radio", name: /^Slot 3, Crucible: not assigned/i });
    await page.click({ role: "button", name: "Include slot 3" });
    await page.waitFor({ role: "radio", name: /^Slot 3, Crucible: Crucible/i });

    await page.fill({ role: "textbox", name: "Set name" }, "Trials");
    await page.click({ role: "button", name: "Save set" });
    await app.toast(/Trials saved/);
    const posts = stub.requests.filter((r) => r.method === "POST" && r.path === "/api/loadouts");
    expect(posts.length === 1 && posts[0].body?.loadouts?.length === 2, `one all-or-nothing POST for the filled slots (${posts.length})`);
    expect(
      posts[0].body.loadouts.every((l) => l.setOnly === true),
      "the copies are private to the set",
    );
    await page.waitFor(() => lastSets().some((s) => s.name === "Trials"));
    expect(
      lastSets().find((s) => s.name === "Trials").slots.find((s) => s.index === 1)?.labels?.nameHash === 102,
      "a copied slot keeps its name, icon and color",
    );
    await page.waitFor({ role: "radio", name: /^Slot 2, Dungeon: Dungeon/i });
    await shot("set-from-slots");

    await page.click({ role: "radio", name: /^Slot 2, Dungeon: Dungeon/i });
    await page.click({ role: "button", name: "Remove slot 2 from the set" });
    await page.waitFor({ role: "radio", name: /^Slot 2, Dungeon: not assigned/i });
    expect(stub.store.loadouts.size === 4, "removing a slot changes nothing until Save");
    await page.click({ role: "button", name: "Save changes" });
    await app.toast(/Trials saved/);
    await page.waitFor(() => stub.store.loadouts.size === 3);
    expect(stub.last("DELETE", "/api/loadouts")?.status === 200, "a removed copy is deleted on Save");
    await page.click({ role: "button", name: "Delete Trials" });
    await page.click({ role: "button", name: "Delete" }, { within: { role: "dialog", name: "Delete activity set?" } });
    await app.toast(/Activity set deleted/);
    await page.waitFor(() => stub.store.loadouts.size === 2);
  });

  await step("lo-ingame-customize: a slot's name, icon and color change without touching its gear", async () => {
    const equips = () => stub.writes().filter((w) => w.path === "/api/bungie/apply-loadout").length;
    const equipsBefore = equips();
    await page.click({ role: "button", name: "In the game now" });
    await page.click({ role: "radio", name: "Slot 3, Crucible" });
    await page.click({ role: "button", name: "Customize Crucible" });
    const dialog = { role: "dialog", name: "Customize slot 3" };
    await page.waitFor(dialog);
    await page.click({ role: "combobox", name: "Name" }, { within: dialog });
    await page.click({ role: "option", name: "Raid" });
    await page.click({ role: "radio", name: "Icon 1" }, { within: dialog });
    await page.click({ role: "radio", name: "Color 1" }, { within: dialog });
    await shot("customize-dialog", { within: dialog });
    await page.click({ role: "button", name: "Save" }, { within: dialog });
    await app.toast(/Slot 3 updated/);
    await page.waitFor({ role: "radio", name: "Slot 3, Raid" });
    const sent = stub.last("PATCH", "/api/bungie/ingame-loadouts");
    expect(
      sent?.status === 200 && sent.body.loadoutIndex === 2 && sent.body.nameHash === 101 && sent.body.iconHash === 201 && sent.body.colorHash === 301,
      `PATCH carried the new labels (${JSON.stringify(sent?.body)})`,
    );
    expect(equips() === equipsBefore, "nothing was equipped");
    expect(stub.store.ingameSlots[2].items.length > 0, "the slot's gear stayed");
    await shot("customized");
  });

  await step("lo-set-slot-edit: an edit goes to the Conflux loadout or only to the slot", async () => {
    await page.click({ role: "button", name: "Raid night" });
    await page.click({ role: "radio", name: /^Slot 1, .*: Raid build/i });
    const article = { role: "article", name: "Raid build" };
    await page.waitFor(article);
    const drawer = { role: "dialog", name: "Edit loadout" };
    const puts = () => stub.requests.filter((r) => r.method === "PUT" && r.path.startsWith("/api/loadouts/")).length;
    const putsBefore = puts();

    await page.click({ role: "button", name: "Edit" }, { within: article });
    await page.waitFor(drawer);
    await shot("set-slot-edit", { within: drawer });
    await page.fill({ role: "textbox", name: "Loadout name" }, "Raid build 2", { within: drawer });
    await page.click({ role: "button", name: "Save to Conflux only" }, { within: drawer });
    await page.waitFor(drawer, { gone: true });
    expect(puts() === putsBefore + 1, "Conflux only updates the Conflux loadout");
    expect(stub.last("PUT", "/api/loadouts/").body.loadout.name === "Raid build 2", "with the edit");
    expect(await page.exists(article), "the slot keeps what it had");
    expect(await page.exists({ role: "button", name: "Save changes" }), "as a change to the set");
    await page.click({ role: "button", name: "Discard" });
    const renamed = { role: "article", name: "Raid build 2" };
    await page.waitFor(renamed);

    await page.click({ role: "button", name: "Edit" }, { within: renamed });
    await page.waitFor(drawer);
    await page.fill({ role: "textbox", name: "Loadout name" }, "Raid build", { within: drawer });
    await page.click({ role: "button", name: "Save to slot and Conflux" }, { within: drawer });
    await page.waitFor(drawer, { gone: true });
    await page.waitFor(article);
    expect(puts() === putsBefore + 2, "both updates the Conflux loadout");
    expect(!(await page.exists({ role: "button", name: "Save changes" })), "and the slot, which points at it, needs no save");

    await page.click({ role: "button", name: "Edit" }, { within: article });
    await page.waitFor(drawer);
    await page.fill({ role: "textbox", name: "Loadout name" }, "Raid private", { within: drawer });
    await page.click({ role: "button", name: "Save to slot" }, { within: drawer });
    await page.waitFor(drawer, { gone: true });
    const copy = { role: "article", name: "Raid private" };
    await page.waitFor(copy);
    expect(puts() === putsBefore + 2, "the Conflux loadout wasn't touched");
    expect([...stub.store.loadouts.values()].some((l) => l.loadout.name === "Raid build"), "Raid build keeps its name");
    await page.click({ role: "button", name: "Save changes" });
    await app.toast(/saved/);
    const post = stub.last("POST", "/api/loadouts");
    expect(post.body.loadouts?.[0]?.loadout?.name === "Raid private" && post.body.loadouts[0].setOnly === true, "the copy is private to the set");
    await page.waitFor(() => stub.store.loadouts.get(lastSets()[0].slots[0].loadoutId)?.setOnly === true);
    expect(stub.store.loadouts.get(lastSets()[0].slots[0].loadoutId).loadout.name === "Raid private", "the saved set points at the copy");

    await page.click({ role: "button", name: "Edit" }, { within: copy });
    await page.waitFor(drawer);
    expect(!(await page.exists({ role: "button", name: "Save to Conflux only" }, { within: drawer })), "a private copy has nowhere else to go");
    await page.fill({ role: "textbox", name: "Loadout name" }, "Raid private 2", { within: drawer });
    const putsBeforeCopyEdit = puts();
    await page.click({ role: "button", name: "Save changes" }, { within: drawer });
    await page.waitFor(drawer, { gone: true });
    await page.waitFor({ role: "article", name: "Raid private 2" });
    expect(puts() === putsBeforeCopyEdit, "editing a stored copy waits for the set's Save");
    await page.click({ role: "button", name: "Discard" });
    await page.waitFor(copy);
  });

  await step("lo-set-peek: Peek shows what the game holds in the set's slots", async () => {
    const peek = { role: "checkbox", name: "Preview the slot in-game" };
    const peeked = () => page.evalJs(`document.querySelectorAll('[data-slot-peek]').length`);
    await page.click({ role: "radio", name: /^Slot 2, Dungeon: not assigned/i });
    await page.waitFor(peek);
    expect((await page.attr(peek, "aria-checked")) === "false", "Peek starts off");
    expect((await peeked()) === 0, "slots outside the set start empty");
    await page.click(peek);
    await page.waitFor(async () => (await peeked()) > 0);
    expect((await peeked()) === 2, "both filled in-game slots outside the set show");
    expect(!stub.writes().length || !(await page.exists({ role: "radio", name: /^Slot 2, Dungeon: Dungeon/i })), "the switch doesn't copy the slot");
    const inGame = { css: `section[aria-label="This slot's current loadout"]` };
    await page.waitFor(inGame);
    expect(await page.exists({ role: "button", name: /^Copy what's in this slot/ }), "the gear shows under the Copy card");
    await shot("peek-on");
    await page.click({ role: "button", name: /^Copy what's in this slot/ });
    await page.waitFor({ role: "radio", name: /^Slot 2, Dungeon: Dungeon/i });
    await page.waitFor(inGame, { gone: true });
    expect((await peeked()) === 1, "a slot in the set shows only its own emblem and loadout");
    await page.click({ role: "button", name: "Discard" });
    await page.waitFor({ role: "radio", name: /^Slot 2, Dungeon: not assigned/i });
    await page.waitFor(peek);
    await page.click(peek);
    await page.waitFor(inGame, { gone: true });
    expect((await peeked()) === 0, "turning it off hides them again");
  });

  await step("the Conflux tab still lists the loadouts", async () => {
    await page.click({ role: "tab", name: "Conflux" });
    await page.waitFor({ role: "article", name: "Raid build" });
    expect((await page.evalJs("location.search")) === "", "the tab left the URL");
    expect(/\b2 Loadouts\b/i.test(await page.waitForText(/\b\d+ Loadouts?\b/i)), "copies stay out of the list");
    await shot("conflux");
  });

  await step("lo-ingame-edit: an edited slot saves to the slot, Conflux, or both", async () => {
    await page.click({ role: "tab", name: "In-game" });
    await page.click({ role: "button", name: "In the game now" });
    await page.click({ role: "radio", name: /^Slot 2, / });
    const article = { role: "article", name: /^Slot 2, / };
    await page.waitFor(article);
    const edit = { role: "button", name: "Edit" };
    const drawer = { role: "dialog", name: "Edit slot 2" };
    const posts = () => stub.requests.filter((r) => r.method === "POST" && r.path === "/api/loadouts").length;
    const snapshots = () => stub.requests.filter((r) => r.method === "POST" && r.path === "/api/bungie/ingame-loadouts").length;
    const ready = () => page.waitFor(async () => (await page.attr(edit, "disabled")) === null, { timeout: 30000 });
    const postsBefore = posts();
    const snapshotsBefore = snapshots();

    await page.click(edit, { within: article });
    await page.waitFor(drawer);
    for (const name of ["Cancel", "Save to Conflux only", "Save to slot and Conflux", "Save to slot"]) {
      expect(await page.exists({ role: "button", name }, { within: drawer }), `the drawer offers ${name}`);
    }
    await shot("slot-edit-buttons", { within: drawer });
    await page.click({ role: "button", name: "Save to slot" }, { within: drawer });
    await page.waitFor(drawer, { gone: true });
    await page.waitFor(() => snapshots() === snapshotsBefore + 1, { timeout: 30000 });
    expect(posts() === postsBefore, "Save to slot leaves Conflux alone");

    await ready();
    await page.click(edit, { within: article });
    await page.waitFor(drawer);
    await page.click({ role: "button", name: "Save to slot and Conflux" }, { within: drawer });
    await app.toast(/Loadout saved to Conflux/);
    await page.waitFor(() => snapshots() === snapshotsBefore + 2, { timeout: 30000 });
    expect(posts() === postsBefore + 1, "both saves the loadout to Conflux");
    expect(stub.last("POST", "/api/bungie/ingame-loadouts").body.loadoutIndex === 1, "and updates slot 2");

    await ready();
    const before = posts();
    await page.click({ role: "button", name: "Copy to Conflux" }, { within: article });
    const copyDrawer = { role: "dialog", name: "Copy to Conflux" };
    await page.waitFor(copyDrawer);
    expect(posts() === before, "copying waits for the drawer's Save");
    await shot("copy-to-conflux", { within: copyDrawer });
    await page.fill({ role: "textbox", name: "Loadout name" }, "Named copy", { within: copyDrawer });
    await page.click({ role: "button", name: "Save to Conflux" }, { within: copyDrawer });
    await page.waitFor(copyDrawer, { gone: true });
    await page.waitFor(() => posts() === before + 1);
    expect(stub.last("POST", "/api/loadouts").body.loadout.name === "Named copy", "the copy has the typed name");
    expect(stub.last("POST", "/api/loadouts").body.setOnly !== true, "and is a normal Conflux loadout");
    expect(snapshots() === snapshotsBefore + 2, "copying doesn't touch the slot");
  });
}

