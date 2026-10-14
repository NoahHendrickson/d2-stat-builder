// Items (/manager): search, item popover + lock, character tabs, and a move from the vault.
// See features/manager.md.
export const meta = { fixture: "full" };

const VAULT_TILE = { css: '[aria-label="Vault"] [role=button][draggable]' };

export default async function ({ page, app, stub, step, shot, expect, log }) {
  // Item names go into toast patterns verbatim.
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  await step("open the inventory", async () => {
    await app.open("/manager");
    expect(await page.exists({ role: "region", name: /^Characters/ }), "characters and vault region is shown");
    const tabs = await page.findAll({ role: "tab" }, { within: { role: "tablist", name: "Characters" } });
    expect(tabs.length === 3, `one tab per fixture character (${tabs.length})`);
    expect((await page.count(VAULT_TILE)) > 0, "vault tiles are mounted");
    await shot("inventory");
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

  await step("mgr-tabs: character tabs switch the column", async () => {
    await page.click({ role: "tab", name: "Titan" });
    await page.waitFor({ role: "button", name: "Titan options" });
    expect((await page.attr({ role: "tab", name: "Titan" }, "aria-selected")) === "true", "Titan tab selected");
    await page.click({ role: "tab", name: "Hunter" });
    await page.waitFor({ role: "button", name: "Hunter options" });
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
