// Items (/manager): search, item popover + lock, character rows, and a move from the vault.
// See features/manager.md.
export const meta = { fixture: "full" };

const VAULT_TILE = { css: '[aria-label="Vault"] [role=button][draggable]' };

export default async function ({ page, app, stub, step, shot, expect, log }) {
  // Item names go into toast patterns verbatim.
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  await step("open the inventory", async () => {
    await app.open("/manager");
    expect(await page.exists({ role: "region", name: /^Characters/ }), "characters and vault region is shown");
    const plates = await page.findAll({ role: "button", name: /^(Hunter|Titan|Warlock) options$/ });
    expect(plates.length === 3, `one row per fixture character (${plates.length})`);
    expect((await page.count(VAULT_TILE)) > 0, "vault tiles are mounted");
    await shot("inventory");
  });

  await step("mgr-layout: the first visit points at the layout setting, which switches to legacy", async () => {
    // The intro opens the settings menu by itself on a first visit (fresh storage).
    const rows = { role: "menuitemradio", name: /^Character rows/ };
    const legacy = { role: "menuitemradio", name: /^Legacy columns/ };
    await page.waitFor(legacy);
    expect((await page.attr(rows, "aria-checked")) === "true", "new visitors start on character rows");
    await shot("layout-intro");
    // Picking a layout closes the menu (and counts the intro as seen).
    await page.click(legacy);
    await page.waitFor(legacy, { gone: true });
    await page.waitFor({ role: "region", name: "Characters and vault" });
    // About 1310 px here: under legacy's 1580 px for every column, so one character at a
    // time under tabs, the vault aligned beside it.
    expect(await page.exists({ role: "tablist", name: "Characters" }), "legacy shows character tabs");
    await shot("layout-legacy");
    // Resetting sort and grouping leaves the layout alone.
    await page.click({ role: "button", name: "Sort and group" });
    await page.click({ role: "button", name: "Reset to defaults" });
    await page.press("Escape");
    expect(await page.exists({ role: "region", name: "Characters and vault" }), "Reset to defaults keeps legacy columns");
    // Seen once, it stays closed; the gear brings the setting back.
    await app.open("/manager");
    await page.waitFor({ role: "region", name: "Characters and vault" });
    expect(!(await page.exists(legacy)), "the intro doesn't open again");
    await page.click({ role: "button", name: "Items settings" });
    await page.click(rows);
    await page.waitFor(rows, { gone: true });
    await page.waitFor({ role: "region", name: "Characters" });
  });

  await step("mgr-sort: drag a sort key to reorder it; groupings fit the kind", async () => {
    const order = async () =>
      JSON.parse(await page.evalJs(`JSON.stringify([...document.querySelectorAll("[data-sort-grip]")].map((b) => b.dataset.sortGrip))`));
    const middle = async (key) => {
      const r = JSON.parse(await page.evalJs(`JSON.stringify(document.querySelector('[data-sort-grip="${key}"]').closest("li").getBoundingClientRect())`));
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    };
    const mouse = (type, x, y, extra = {}) =>
      page.s("Input.dispatchMouseEvent", { type, x, y, button: "left", pointerType: "mouse", ...extra });
    await page.click({ role: "button", name: "Sort and group" });
    await page.waitFor({ role: "button", name: "Reset to defaults" });
    expect((await order()).join() === "rarity,power,name", "the default sort is rarity, power, name");
    // Drag Name's box (by its label, not the grip) up onto Rarity's.
    const from = await middle("name");
    const to = await middle("rarity");
    await mouse("mouseMoved", from.x, from.y, { button: "none" });
    await mouse("mousePressed", from.x, from.y, { clickCount: 1, buttons: 1 });
    for (let i = 1; i <= 8; i++) await mouse("mouseMoved", from.x, from.y + ((to.y - from.y) * i) / 8, { buttons: 1 });
    await shot("sort-dragging");
    await mouse("mouseReleased", from.x, to.y, { clickCount: 1 });
    await page.waitFor(async () => (await order())[0] === "name");
    expect((await order()).join() === "name,rarity,power", "Name dragged to the top");
    // The pressed box's grip has focus, so the arrow keys carry on.
    await page.click({ role: "button", name: /^Reorder Power/ });
    await page.press("ArrowUp");
    await page.waitFor(async () => (await order()).join() === "name,power,rarity");
    const armorGroup = { role: "radiogroup", name: "Group vault armor by" };
    const armor = await Promise.all((await page.findAll({ role: "radio" }, { within: armorGroup })).map((o) => page.name(o)));
    expect(armor.join() === "None,Class,Rarity,Gear tier", `armor groupings: ${armor.join(", ")}`);
    await page.click({ role: "radio", name: "Rarity" }, { within: armorGroup });
    expect((await page.attr({ role: "radio", name: "Rarity" }, "aria-checked", { within: armorGroup })) === "true", "picking Rarity checks it");
    await shot("sort-menu");
    await page.click({ role: "button", name: "Reset to defaults" });
    await page.waitFor(async () => (await order()).join() === "rarity,power,name");
    await page.press("Escape");
  });

  await step("mgr-search: a keyword search narrows the items", async () => {
    await page.fill({ role: "combobox", name: "Search items" }, "is:handcannon");
    const count = await page.waitFor(async () => {
      const b = await page.findAll({ role: "button", name: /^\d[\d,]* items?$/ });
      return b.length ? page.name(b[0]) : null;
    });
    const n = Number(count.replace(/\D/g, ""));
    log(`  is:handcannon → ${count}`);
    expect(n > 0 && n < 456, "some but not all weapons match");
    await shot("search");
    await page.click({ role: "button", name: "Clear search" });
    await page.waitFor({ role: "button", name: /^\d[\d,]* items?$/ }, { gone: true });
  });

  let item;
  await step("mgr-lock: the popover's Lock toggles and is sent to Bungie", async () => {
    const tile = { ...VAULT_TILE, nth: 0 };
    item = (await page.name(tile)).split(",")[0];
    await page.click(tile);
    const lock = { role: "button", name: /^(Lock|Unlock)$/ };
    await page.waitFor(lock);
    const before = await page.attr(lock, "aria-pressed");
    await page.click(lock);
    await page.waitFor(async () => (await page.attr(lock, "aria-pressed")) !== before);
    const want = before !== "true";
    await app.toast(new RegExp(`${want ? "Locked" : "Unlocked"} ${esc(item)}`));
    const req = stub.last("POST", "/api/bungie/lock");
    expect(req?.body?.locked === want, `POST /api/bungie/lock sent locked:${want} for ${item}`);
    await shot("locked");
    await page.press("Escape");
  });

  await step("mgr-move: a touch user pulls a vault item to a character", async () => {
    // Move buttons only render for touch (pointer: coarse); a mouse user drags instead.
    expect(await page.emulatePointer("coarse"), "the page now matches (pointer: coarse)");
    const tile = { ...VAULT_TILE, nth: 1 };
    await page.waitFor(tile);
    item = (await page.name(tile)).split(",")[0];
    await page.click(tile);
    const move = { role: "button", name: /^(Pull|Send|Equip on)\b.*\b(Hunter|Titan|Warlock)$/ };
    await page.waitFor(move);
    const label = await page.name({ ...move, nth: 0 });
    log(`  ${item}: ${label}`);
    await page.click({ ...move, nth: 0 });
    await app.toast(new RegExp(`^(Moved|Equipped) ${esc(item)}`));
    const req = stub.last("POST", "/api/bungie/move");
    expect(req?.body?.from?.kind === "vault" && req.body.to?.kind === "character", `POST /api/bungie/move vault → character (${JSON.stringify({ from: req?.body?.from, to: req?.body?.to })})`);
    await shot("moved");
    await page.emulatePointer("fine");
  });
}
