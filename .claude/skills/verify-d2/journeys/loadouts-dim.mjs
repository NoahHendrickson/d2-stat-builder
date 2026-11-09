// Saved loadouts (/loadouts): Import DIM loadout. A pasted link opens the review drawer and
// saves a copy. Same seed as loadouts.mjs. See features/loadouts.md (lo-dim-import).
import { meta as loadoutsMeta } from "./loadouts.mjs";
export const meta = loadoutsMeta;

export default async function ({ page, app, stub, step, shot, expect }) {
  const paste = { role: "dialog", name: "Import DIM loadout" };
  const drawer = { role: "dialog", name: "Review DIM loadout" };
  const field = { role: "textbox", name: "DIM loadout link" };
  const go = async (link) => {
    await page.fill(field, link, { within: paste });
    await page.click({ role: "button", name: "Continue" }, { within: paste });
  };
  const openDialog = async () => {
    await page.click({ role: "button", name: "More loadout actions" });
    await page.click({ role: "menuitem", name: "Import DIM loadout" });
    await page.waitFor(paste);
  };

  await step("lo-dim-import: the menu item sits below Import in-game loadout", async () => {
    await app.open("/loadouts");
    await page.waitFor({ role: "article", name: "Raid build" });
    await page.click({ role: "button", name: "More loadout actions" });
    await page.waitFor({ role: "menuitem", name: "Import DIM loadout" });
    const items = JSON.parse(await page.evalJs(`JSON.stringify([...document.querySelectorAll('[role=menuitem]')].map((e) => e.textContent.trim()))`));
    expect(items.indexOf("Import DIM loadout") === items.indexOf("Import in-game loadout") + 1, `menu order (${items.join(", ")})`);
    await shot("menu");
    await page.press("Escape");
  });

  await step("lo-dim-import: a bad or unknown link says so and saves nothing", async () => {
    await openDialog();
    await go("https://example.com/nope");
    await page.waitForText(/doesn't look like a DIM loadout link/, { within: paste });
    await go("https://dim.gg/zzzzzzz/gone");
    await page.waitForText(/That DIM link doesn't exist/, { within: paste });
    await shot("bad-link", { within: paste });
    expect(!stub.last("POST", "/api/loadouts"), "nothing was saved");
  });

  await step("lo-dim-import: a dim.gg link opens the review drawer and saves a copy", async () => {
    await go("https://dim.gg/abc2345/from-dim");
    await page.waitFor(drawer);
    expect((await page.value({ role: "textbox", name: "Loadout name" }, { within: drawer })) === "From DIM", "the name came across");
    expect(!stub.last("POST", "/api/loadouts"), "nothing is saved before Import");
    await shot("review", { within: drawer });
    await page.click({ role: "button", name: "Import" }, { within: drawer });
    await app.toast(/Loadout imported/);
    await page.waitFor({ role: "article", name: "From DIM" });
    const body = stub.last("POST", "/api/loadouts")?.body;
    expect(body?.loadout?.parameters?.assumeArmorMasterwork === 3, "the missing masterwork setting was filled in");
    expect(body?.loadout?.unequipped?.length === 0, "unequipped items are left out");
  });

  await step("lo-dim-import: DIM's own full link works too", async () => {
    await openDialog();
    const loadout = { name: "Inline DIM", classType: 1, equipped: [{ hash: 30472172 }] };
    await go(`https://app.destinyitemmanager.com/loadouts?loadout=${encodeURIComponent(JSON.stringify(loadout))}`);
    await page.waitFor(drawer);
    expect((await page.value({ role: "textbox", name: "Loadout name" }, { within: drawer })) === "Inline DIM", "the name came across");
    await page.click({ role: "button", name: "Import" }, { within: drawer });
    await page.waitFor({ role: "article", name: "Inline DIM" });
    expect(stub.requests.filter((r) => r.path.startsWith("/api/dim-share/abc2345")).length === 1, "no server lookup for a full link");
  });
}
